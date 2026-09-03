"""Discord-bot worker tests (SDD 2026-08-14 leaderboard standardization, task 9).

The PURE module-level functions are tested directly — no Discord connection is
ever made (R37's "thin Discord interaction" lives in ``DiscordBotRunner`` and is
deliberately not exercised here). ``sync_discord_identity`` (the bot-1
write-back decision) is tested with a fake repo asserting
``update_discord_identity`` is called with the member's current
discord_id/username only when the stored identity drifted.
"""

from __future__ import annotations

from workers.discord_bot import (
    ALPHA_RANKS,
    OMEGA_RANKS,
    RANK_NAMES_MAPPER,
    build_nickname,
    extract_rank_tier,
    map_rank_nickname,
    rank_role_names,
    sync_discord_identity,
)


class _Player:
    """Minimal duck-typed leaderboard row (discord_id/discord_username/puuid)."""

    def __init__(self, puuid: str, discord_id: str, discord_username: str) -> None:
        self.puuid = puuid
        self.discord_id = discord_id
        self.discord_username = discord_username


class FakeRepo:
    """Stub repo recording every ``update_discord_identity`` call."""

    def __init__(self, *, result: bool = True) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.result = result

    async def update_discord_identity(self, puuid: str, discord_id: str, discord_username: str) -> bool:
        self.calls.append((puuid, discord_id, discord_username))
        return self.result


# ---------------------------------------------------------------- rank tier


def test_extract_rank_tier_splits_rank_number():
    assert extract_rank_tier("Diamond 3") == "Diamond"


def test_extract_rank_tier_single_word_passes_through():
    assert extract_rank_tier("Radiant") == "Radiant"


def test_extract_rank_tier_unknown_is_kept():
    assert extract_rank_tier("Unknown") == "Unknown"


def test_extract_rank_tier_immortal_numbered():
    assert extract_rank_tier("Immortal 1") == "Immortal"


# ------------------------------------------------------------ rank nickname


def test_map_rank_nickname_known_tiers_abbreviate():
    assert map_rank_nickname("Diamond") == "Dia"
    assert map_rank_nickname("Bronze") == "Brz"
    assert map_rank_nickname("Radiant") == "Radiant"  # no abbreviation in source


def test_map_rank_nickname_unknown_tier_passes_through():
    assert map_rank_nickname("Unverified") == "Unverified"


def test_rank_names_mapper_covers_every_tier():
    assert set(RANK_NAMES_MAPPER) == set(ALPHA_RANKS) | set(OMEGA_RANKS)


def test_alpha_and_omega_ranks_are_disjoint():
    assert not set(ALPHA_RANKS) & set(OMEGA_RANKS)


# ---------------------------------------------------------------- nickname


def test_build_nickname_under_limit_unchanged():
    assert build_nickname("Naheed", "Diamond") == "Naheed (Dia)"


def test_build_nickname_truncates_global_name_to_32_chars():
    nickname = build_nickname("X" * 40, "Diamond")
    assert len(nickname) == 32
    assert nickname == "X" * 26 + " (Dia)"


def test_build_nickname_at_exactly_32_chars_untouched():
    # "A" * 26 + " (Dia)" is exactly 32 chars -> no truncation.
    assert build_nickname("A" * 26, "Diamond") == "A" * 26 + " (Dia)"


def test_build_nickname_unknown_tier_keeps_label():
    assert build_nickname("Player", "Unknown") == "Player (Unknown)"


# --------------------------------------------------------------- role names


def test_rank_role_names_alpha_tier():
    assert rank_role_names("Diamond") == ("Alpha", "Diamond", "Verified")


def test_rank_role_names_omega_tier():
    assert rank_role_names("Iron") == ("Omega", "Iron", "Verified")


def test_rank_role_names_unknown_tier_returns_none():
    assert rank_role_names("Unknown") == (None, None, None)
    assert rank_role_names("Unverified") == (None, None, None)


# ------------------------------------------------------------ write-back


async def test_write_back_updates_when_username_changed():
    # p1 stored discord_id "111" with username "old-name"; the member's name is
    # now "new-name" -> update_discord_identity corrects with the member's
    # current discord_id + username.
    player = _Player(puuid="p1", discord_id="111", discord_username="old-name")
    repo = FakeRepo()

    ok = await sync_discord_identity(
        repo,
        discord_id="111",
        discord_username="new-name",
        players=[player],
    )

    assert ok is True
    assert repo.calls == [("p1", "111", "new-name")]


async def test_write_back_skipped_when_identity_unchanged():
    player = _Player(puuid="p1", discord_id="111", discord_username="new-name")
    repo = FakeRepo()

    ok = await sync_discord_identity(
        repo,
        discord_id="111",
        discord_username="new-name",
        players=[player],
    )

    assert ok is False
    assert repo.calls == []


async def test_write_back_skipped_when_no_row_matches():
    # No row carries the member's discord_id (and one row has an empty id).
    players = [
        _Player(puuid="p1", discord_id="", discord_username="a"),
        _Player(puuid="p2", discord_id="222", discord_username="b"),
    ]
    repo = FakeRepo()

    ok = await sync_discord_identity(
        repo,
        discord_id="999",
        discord_username="c",
        players=players,
    )

    assert ok is False
    assert repo.calls == []


async def test_write_back_reports_false_when_row_vanished():
    player = _Player(puuid="p1", discord_id="111", discord_username="old-name")
    repo = FakeRepo(result=False)

    ok = await sync_discord_identity(
        repo,
        discord_id="111",
        discord_username="new-name",
        players=[player],
    )

    assert ok is False
    assert repo.calls == [("p1", "111", "new-name")]


async def test_write_back_uses_first_matching_row():
    # Mirrors the source's `break` after the first discord_id match.
    players = [
        _Player(puuid="p1", discord_id="111", discord_username="old-name"),
        _Player(puuid="p2", discord_id="111", discord_username="also-old"),
    ]
    repo = FakeRepo()

    ok = await sync_discord_identity(
        repo,
        discord_id="111",
        discord_username="new-name",
        players=players,
    )

    assert ok is True
    assert repo.calls == [("p1", "111", "new-name")]
