"""Unit tests for the pure functions of ``scripts/migrate_valorantsl_players.py``.

Covers only the DB-free pieces (R42): ``_to_aware_datetime``,
``map_to_leaderboard_player``, and ``dedupe_by_discord_username``, driven by
fake source rows shaped like ``valorantsl-new``'s ``public.players``.
"""

from datetime import UTC, datetime, timedelta, timezone

from scripts.migrate_valorantsl_players import (
    DROPPED_COLUMNS,
    SOURCE_COLUMNS,
    TARGET_COLUMNS,
    _to_aware_datetime,
    dedupe_by_discord_username,
    map_to_leaderboard_player,
)


def _source_row(**overrides: object) -> dict:
    """A fake ``public.players`` row carrying every source column."""
    row: dict = {
        "puuid": "puuid-1",
        "name": "Player One",
        "tag": "TAG1",
        "region": "ap",
        "discord_id": "123456789",
        "discord_username": "player_one",
        "elo": 1200,
        "currenttierpatched": "Diamond",
        "rank_details": {"elo": 1200, "currenttierpatched": "Diamond"},
        "peak_rank": {"tier_name": "Ascendant"},
        "seasonal_ranks": [],
        "match_stats": {"wins": 3},
        "last_played_match": "2025-01-01T10:00:00",
        "updated_at": "2025-01-01T10:00:00Z",
        "seasonal_extended_at": "2025-01-01T10:00:00Z",
        "last_updated": "2025-01-01T10:00:00Z",
        "update_source": "migration_script",
        "account_level": 100,
        "card": "card_xyz",
        "raw_source": {"raw": True},
        "row_created_at": "2025-01-01T10:00:00Z",
        "row_updated_at": "2025-01-01T10:00:00Z",
    }
    row.update(overrides)
    return row


# --- _to_aware_datetime ----------------------------------------------------


def test_to_aware_datetime_none_stays_none() -> None:
    assert _to_aware_datetime(None) is None


def test_to_aware_datetime_naive_datetime_becomes_aware_utc() -> None:
    # fromisoformat (no offset) yields a naive datetime, exercising the naive→UTC branch.
    out = _to_aware_datetime(datetime.fromisoformat("2025-01-01T10:00:00"))
    assert out is not None
    assert out == datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
    assert out.tzinfo is not None


def test_to_aware_datetime_aware_datetime_is_untouched() -> None:
    aware = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
    assert _to_aware_datetime(aware) is aware


def test_to_aware_datetime_iso_strings() -> None:
    assert _to_aware_datetime("2025-01-01T10:00:00") == datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
    assert _to_aware_datetime("2025-01-01T10:00:00Z") == datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
    offset = timezone(timedelta(hours=5, minutes=30))
    assert _to_aware_datetime("2025-01-01T10:00:00+05:30") == datetime(2025, 1, 1, 10, 0, 0, tzinfo=offset)


def test_to_aware_datetime_garbage_is_none() -> None:
    assert _to_aware_datetime(42) is None


# --- map_to_leaderboard_player ---------------------------------------------


def test_target_columns_are_source_minus_dropped() -> None:
    assert TARGET_COLUMNS == [column for column in SOURCE_COLUMNS if column not in set(DROPPED_COLUMNS)]


def test_target_columns_match_leaderboard_player() -> None:
    assert set(TARGET_COLUMNS) == {
        "puuid",
        "name",
        "tag",
        "region",
        "discord_id",
        "discord_username",
        "elo",
        "currenttierpatched",
        "rank_details",
        "peak_rank",
        "seasonal_ranks",
        "last_played_match",
        "update_source",
    }


def test_map_drops_legacy_extras() -> None:
    out = map_to_leaderboard_player(_source_row())
    assert set(out) == set(TARGET_COLUMNS)
    for extra in DROPPED_COLUMNS:
        assert extra not in out


def test_map_rank_details_passthrough_flat_shape() -> None:
    flat = {"elo": 1200, "currenttierpatched": "Diamond"}
    out = map_to_leaderboard_player(_source_row(rank_details=flat))
    assert out["rank_details"] is flat


def test_map_rank_details_passthrough_nested_shape() -> None:
    nested = {"data": {"elo": 1200, "currenttierpatched": "Diamond"}}
    out = map_to_leaderboard_player(_source_row(rank_details=nested))
    assert out["rank_details"] == nested


def test_map_coerces_last_played_match_to_aware_utc() -> None:
    out = map_to_leaderboard_player(_source_row(last_played_match="2025-01-01T10:00:00"))
    assert out["last_played_match"] == datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)


def test_map_last_played_match_none_stays_none() -> None:
    assert map_to_leaderboard_player(_source_row(last_played_match=None))["last_played_match"] is None


def test_map_update_source_fallback() -> None:
    assert map_to_leaderboard_player(_source_row(update_source=None))["update_source"] == "migration"
    assert map_to_leaderboard_player(_source_row(update_source=""))["update_source"] == "migration"
    assert map_to_leaderboard_player(_source_row(update_source="updater_service"))["update_source"] == "updater_service"


def test_map_omits_updated_at() -> None:
    # ``updated_at`` is deliberately not carried over: the repository's
    # ``upsert`` stamps it (``func.now()``) on write, so a mapped value would
    # be silently overridden.
    out = map_to_leaderboard_player(_source_row(updated_at="2025-01-01T10:00:00Z"))
    assert "updated_at" not in out


def test_map_discord_id_fallback_empty_string() -> None:
    assert map_to_leaderboard_player(_source_row(discord_id=None))["discord_id"] == ""


# --- dedupe_by_discord_username --------------------------------------------


def test_dedupe_keeps_newest_row_per_username() -> None:
    old = _source_row(puuid="old", discord_username="same_user", updated_at="2025-01-01T10:00:00", last_updated=None)
    new = _source_row(puuid="new", discord_username="same_user", updated_at="2025-02-01T10:00:00", last_updated=None)
    out = dedupe_by_discord_username([old, new])
    assert [row["puuid"] for row in out] == ["new"]


def test_dedupe_uses_max_of_updated_at_and_last_updated() -> None:
    # Row a is fresher by max(updated_at, last_updated) even though its
    # updated_at alone is older than b's.
    a = _source_row(puuid="a", discord_username="same_user", updated_at="2025-01-01T10:00:00", last_updated="2025-03-01T10:00:00")
    b = _source_row(puuid="b", discord_username="same_user", updated_at="2025-02-01T10:00:00", last_updated=None)
    out = dedupe_by_discord_username([a, b])
    assert [row["puuid"] for row in out] == ["a"]


def test_dedupe_rows_missing_both_datetimes_are_oldest() -> None:
    stale = _source_row(puuid="stale", discord_username="same_user", updated_at=None, last_updated=None)
    fresh = _source_row(puuid="fresh", discord_username="same_user", updated_at="2025-01-01T10:00:00", last_updated=None)
    out = dedupe_by_discord_username([fresh, stale])
    assert [row["puuid"] for row in out] == ["fresh"]


def test_dedupe_collapses_empty_and_none_usernames_to_one_group() -> None:
    empty = _source_row(puuid="empty", discord_username="", updated_at="2025-01-01T10:00:00", last_updated=None)
    none = _source_row(puuid="none", discord_username=None, updated_at="2025-02-01T10:00:00", last_updated=None)
    out = dedupe_by_discord_username([empty, none])
    assert len(out) == 1
    assert out[0]["puuid"] == "none"


def test_dedupe_preserves_distinct_usernames() -> None:
    alice = _source_row(puuid="a", discord_username="alice", updated_at="2025-01-01T10:00:00", last_updated=None)
    bob = _source_row(puuid="b", discord_username="bob", updated_at="2025-01-01T10:00:00", last_updated=None)
    out = dedupe_by_discord_username([alice, bob])
    assert sorted(row["puuid"] for row in out) == ["a", "b"]
