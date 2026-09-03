"""Name-audit worker tests (SDD 2026-08-14 leaderboard standardization, task 8).

A fake ``HenrikClient`` (canned ``HenrikAccount`` responses per PUUID: drift,
unchanged, not-found, or raising) and a fake repo (``list_all`` returning
in-memory ``LeaderboardPlayer`` rows, ``update_name_tag`` recording every call
and returning True/False, ``rollback`` counting invocations) prove: drift
detection + correction with the NEW name/tag, unchanged players skipped,
``HenrikNotFoundError`` skipped, per-player failure isolation (one bad player —
fetch OR DB write — is counted ``errors`` and the loop continues), the
``{total, updated, skipped, errors}`` stats, and that ``get_account_by_puuid``
is called with the right puuid. ``name_audit_delay=0`` throughout so tests
never sleep.
"""

from __future__ import annotations

from app.db.models import LeaderboardPlayer
from app.integrations.henrik.exceptions import HenrikError, HenrikNotFoundError
from app.integrations.henrik.models import HenrikAccount
from workers.name_audit import audit_names

ACCOUNT_FOR_PUUID = {
    "p1": ("NewName", "NEW"),
    "p2": ("SameName", "TAG"),
    "p3": ("Drifty", "D3"),
    "p4": ("Quiet", "Q4"),
    "p5": ("Gone", "G5"),
}


def _row(puuid: str, name: str = "OldName", tag: str = "OLD") -> LeaderboardPlayer:
    """A minimal in-memory ``leaderboard_players`` row (no DB involved)."""
    return LeaderboardPlayer(
        puuid=puuid,
        name=name,
        tag=tag,
        region="ap",
        discord_username=f"user-{puuid}",
    )


class FakeHenrikClient:
    """Canned account-by-puuid responses; optional per-PUUID drift/not-found/raises."""

    def __init__(
        self,
        *,
        drift_for: set[str] | None = None,
        not_found_for: set[str] | None = None,
        fail_for: set[str] | None = None,
    ) -> None:
        self.drift_for = drift_for or set()
        self.not_found_for = not_found_for or set()
        self.fail_for = fail_for or set()
        self.calls: list[str] = []

    async def get_account_by_puuid(self, puuid: str) -> HenrikAccount:
        self.calls.append(puuid)
        if puuid in self.not_found_for:
            raise HenrikNotFoundError(f"account {puuid} not found", sub_code=22)
        if puuid in self.fail_for:
            raise RuntimeError(f"henrik boom for {puuid}")
        # Default account identity equals the row's stored identity; drift_for
        # PUUIDs get a different name/tag from what the row holds.
        name, tag = ACCOUNT_FOR_PUUID[puuid]
        return HenrikAccount(puuid=puuid, name=name, tag=tag)


class FakeRepo:
    """Stub repo: returns its rows and records every ``update_name_tag`` call."""

    def __init__(
        self,
        players: list[LeaderboardPlayer] | None = None,
        *,
        update_result: bool = True,
        fail_update_for: set[str] | None = None,
    ) -> None:
        self.players = players or []
        self.updates: list[tuple[str, str, str]] = []
        self.update_result = update_result
        self.fail_update_for = fail_update_for or set()
        self.rollbacks = 0

    async def list_all(self) -> list[LeaderboardPlayer]:
        return list(self.players)

    async def update_name_tag(self, puuid: str, name: str, tag: str) -> bool:
        self.updates.append((puuid, name, tag))
        if puuid in self.fail_update_for:
            raise RuntimeError(f"db boom on commit for {puuid}")
        return self.update_result

    async def rollback(self) -> None:
        self.rollbacks += 1


# ------------------------------------------------------------------ drift path

async def test_drift_is_detected_and_corrected_with_new_name_tag():
    # p1's stored identity is OldName#OLD; the API returns NewName#NEW -> update.
    client = FakeHenrikClient(drift_for={"p1"})
    repo = FakeRepo(players=[_row("p1")])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 1, "updated": 1, "skipped": 0, "errors": 0}
    assert client.calls == ["p1"]
    assert repo.updates == [("p1", "NewName", "NEW")]


async def test_unchanged_player_is_skipped():
    # p2's stored identity SameName#TAG matches the API -> skipped, no update.
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p2", name="SameName", tag="TAG")])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 1, "updated": 0, "skipped": 1, "errors": 0}
    assert client.calls == ["p2"]
    assert repo.updates == []


# ---------------------------------------------------------------- skip / error

async def test_not_found_player_is_skipped():
    client = FakeHenrikClient(not_found_for={"p3"})
    repo = FakeRepo(players=[_row("p3", name="Drifty", tag="D3")])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 1, "updated": 0, "skipped": 1, "errors": 0}
    assert client.calls == ["p3"]
    assert repo.updates == []


async def test_raising_client_counts_error_and_loop_continues():
    # p4 raises (HenrikError); p5 has drift -> p5 must still be corrected.
    client = FakeHenrikClient(fail_for={"p4"}, drift_for={"p5"})
    repo = FakeRepo(players=[_row("p4", name="Quiet", tag="Q4"), _row("p5", name="Drifty", tag="D3")])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 2, "updated": 1, "skipped": 0, "errors": 1}
    assert client.calls == ["p4", "p5"]
    assert repo.updates == [("p5", "Gone", "G5")]


async def test_henrik_error_from_client_counts_as_error():
    class BoomError(HenrikError):
        pass

    client = FakeHenrikClient()
    client.get_account_by_puuid = _raising(BoomError("henrik outage"))  # type: ignore[method-assign]
    repo = FakeRepo(players=[_row("p4", name="Quiet", tag="Q4")])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 1, "updated": 0, "skipped": 0, "errors": 1}
    assert repo.updates == []


async def test_failed_db_write_counts_as_error_and_loop_continues():
    # p1's drift write raises (mid-run connection drop on commit); the failure
    # is isolated + rolled back and p5's correction is still applied — earlier
    # corrections survive because update_name_tag commits per player.
    client = FakeHenrikClient(drift_for={"p1", "p5"})
    repo = FakeRepo(
        players=[_row("p1"), _row("p5", name="Drifty", tag="D3")],
        fail_update_for={"p1"},
    )

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 2, "updated": 1, "skipped": 0, "errors": 1}
    assert client.calls == ["p1", "p5"]
    assert repo.updates == [("p1", "NewName", "NEW"), ("p5", "Gone", "G5")]
    assert repo.rollbacks == 1


async def test_rollback_expiring_loaded_rows_does_not_abort_later_players():
    """A rollback must not cause lazy ORM access on later audit rows."""

    class ExpiringRow:
        def __init__(self, puuid: str, name: str, tag: str) -> None:
            self._values = (puuid, name, tag)
            self.expired = False

        def _read(self, index: int) -> str:
            if self.expired:
                raise RuntimeError("simulated async ORM lazy load after rollback")
            return self._values[index]

        @property
        def puuid(self) -> str:
            return self._read(0)

        @property
        def name(self) -> str:
            return self._read(1)

        @property
        def tag(self) -> str:
            return self._read(2)

    rows = [ExpiringRow("p4", "Quiet", "Q4"), ExpiringRow("p5", "Drifty", "D3")]

    class ExpiringRepo(FakeRepo):
        async def list_all(self):
            return rows

        async def rollback(self) -> None:
            await super().rollback()
            for row in rows:
                row.expired = True

    client = FakeHenrikClient(fail_for={"p4"}, drift_for={"p5"})
    repo = ExpiringRepo()

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 2, "updated": 1, "skipped": 0, "errors": 1}
    assert client.calls == ["p4", "p5"]
    assert repo.updates == [("p5", "Gone", "G5")]
    assert repo.rollbacks == 1


def _raising(exc: Exception):
    async def _inner(_puuid: str) -> HenrikAccount:
        raise exc

    return _inner


async def test_missing_row_on_update_counts_as_error():
    # The API has a NEW identity for p1, but the row vanished before the
    # update -> update_name_tag returns False -> errors, not updated.
    client = FakeHenrikClient(drift_for={"p1"})
    repo = FakeRepo(players=[_row("p1")], update_result=False)

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 1, "updated": 0, "skipped": 0, "errors": 1}
    assert client.calls == ["p1"]
    assert repo.updates == [("p1", "NewName", "NEW")]


async def test_empty_list_is_noop():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[])

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 0, "updated": 0, "skipped": 0, "errors": 0}
    assert client.calls == []
    assert repo.updates == []


async def test_mixed_run_produces_correct_stats():
    # p1 drift (updated), p2 unchanged (skipped), p3 not found (skipped),
    # p4 boom (errors), p5 drift (updated).
    client = FakeHenrikClient(
        drift_for={"p1", "p5"}, not_found_for={"p3"}, fail_for={"p4"}
    )
    repo = FakeRepo(
        players=[
            _row("p1"),
            _row("p2", name="SameName", tag="TAG"),
            _row("p3", name="Drifty", tag="D3"),
            _row("p4", name="Quiet", tag="Q4"),
            _row("p5", name="Drifty", tag="D3"),
        ]
    )

    stats = await audit_names(client, repo, name_audit_delay=0)

    assert stats == {"total": 5, "updated": 2, "skipped": 2, "errors": 1}
    assert client.calls == ["p1", "p2", "p3", "p4", "p5"]
    assert repo.updates == [("p1", "NewName", "NEW"), ("p5", "Gone", "G5")]
