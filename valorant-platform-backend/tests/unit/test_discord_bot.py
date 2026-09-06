"""Discord worker helpers and async role/nickname interactions with fake members.

No Discord connection is made; identity write-back uses a fake repository.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

from workers.discord_bot import (
    ALPHA_RANKS,
    OMEGA_RANKS,
    RANK_NAMES_MAPPER,
    DiscordBotRunner,
    build_nickname,
    extract_rank_tier,
    map_rank_nickname,
    rank_role_names,
    sync_discord_identity,
)


class _Role:
    def __init__(self, name: str) -> None:
        self.name = name


class _Guild:
    def __init__(self, *role_names: str) -> None:
        self.roles = [_Role(name) for name in role_names]


class _Member:
    def __init__(self, *, member_id: str, roles: list[_Role], guild: _Guild, bot: bool = False) -> None:
        self.id = member_id
        self.name = "discord-name"
        self.global_name = "Global Name"
        self.roles = roles
        self.guild = guild
        self.bot = bot
        self.edit = AsyncMock()
        self.add_roles = AsyncMock()
        self.remove_roles = AsyncMock()


def _runner() -> DiscordBotRunner:
    runner = object.__new__(DiscordBotRunner)
    runner.logger = Mock()
    return runner


def _player(*, discord_id: str, rank: str) -> Mock:
    player = Mock()
    player.discord_id = discord_id
    player.rank_details = {"currenttierpatched": rank}
    return player


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


# ---------------------------------------------------------- Discord interactions


async def test_registered_member_updates_rank_roles_and_preserves_unrelated_roles():
    guild = _Guild("@everyone", "Alpha", "Omega", "Diamond", "Verified", "Unverified", "Tournament Staff")
    everyone, alpha, omega, diamond, verified, unverified, unrelated = guild.roles
    member = _Member(
        member_id="111",
        roles=[everyone, unrelated, omega, unverified],
        guild=guild,
    )

    await _runner().update_discord_roles(member, [_player(discord_id="111", rank="Diamond 3")])

    assert member.edit.await_args.kwargs == {"nick": "Global Name (Dia)"}
    assert member.remove_roles.await_args.args == (omega, unverified)
    assert member.add_roles.await_args.args == (alpha, diamond, verified)
    assert unrelated in member.roles


async def test_unregistered_member_gets_unverified_without_removing_unrelated_roles():
    guild = _Guild("@everyone", "Diamond", "Unverified", "Tournament Staff")
    everyone, diamond, unverified, unrelated = guild.roles
    member = _Member(
        member_id="999",
        roles=[everyone, diamond, unrelated],
        guild=guild,
    )

    await _runner().update_discord_roles(member, [])

    assert member.edit.await_args.kwargs == {"nick": "Global Name (Unverified)"}
    assert member.remove_roles.await_args.args == (diamond,)
    assert member.add_roles.await_args.args == (unverified,)
    assert unrelated in member.roles


async def test_manual_member_skips_nickname_and_role_mutation():
    guild = _Guild("@everyone", "Manual", "Diamond", "Tournament Staff")
    everyone, manual, diamond, unrelated = guild.roles
    member = _Member(
        member_id="111",
        roles=[everyone, manual, diamond, unrelated],
        guild=guild,
    )

    await _runner().update_discord_roles(member, [_player(discord_id="111", rank="Diamond 3")])

    member.edit.assert_not_awaited()
    member.remove_roles.assert_not_awaited()
    member.add_roles.assert_not_awaited()
    assert member.roles == [everyone, manual, diamond, unrelated]


async def test_update_roles_only_removes_and_adds_explicit_managed_roles():
    guild = _Guild("@everyone", "Omega", "Iron", "Verified", "Tournament Staff", "External Role")
    everyone, omega, iron, verified, unrelated, external = guild.roles
    member = _Member(
        member_id="111",
        roles=[everyone, omega, unrelated],
        guild=guild,
    )

    await _runner().update_roles(member, [iron, verified, external])

    assert member.remove_roles.await_args.args == (omega,)
    assert member.add_roles.await_args.args == (iron, verified)
    assert unrelated in member.roles


async def test_bot_member_is_skipped_even_when_called_directly():
    guild = _Guild("@everyone", "Manual", "Unverified", "Tournament Staff")
    everyone, manual, unverified, unrelated = guild.roles
    member = _Member(
        member_id="222",
        roles=[everyone, manual, unverified, unrelated],
        guild=guild,
        bot=True,
    )

    await _runner().update_discord_roles(member, [])

    member.edit.assert_not_awaited()
    member.remove_roles.assert_not_awaited()
    member.add_roles.assert_not_awaited()
    assert member.roles == [everyone, manual, unverified, unrelated]
