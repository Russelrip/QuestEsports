"""Leaderboard schema unit tests.

Pins the wire shape of ``LeaderboardEntry`` / ``LeaderboardPage`` /
``LeaderboardStats``: snake_case field names, optional-field defaults, and the
empty-page / rank-distribution constructions the service layer relies on.
"""

from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats


def test_entry_required_fields_only_defaults_optional_to_none():
    entry = LeaderboardEntry(
        puuid="puuid-1",
        name="duelist",
        tag="NA1",
        discord_username="quest",
    )
    assert entry.puuid == "puuid-1"
    assert entry.name == "duelist"
    assert entry.tag == "NA1"
    assert entry.discord_username == "quest"
    assert entry.current_tier is None
    assert entry.elo is None
    assert entry.rank_in_tier is None
    assert entry.peak_rank is None
    assert entry.peak_season is None
    assert entry.last_played_match is None


def test_full_entry_round_trips_with_snake_case_fields():
    entry = LeaderboardEntry(
        puuid="puuid-1",
        name="duelist",
        tag="NA1",
        discord_username="quest",
        current_tier="Ascendant",
        elo=1200,
        rank_in_tier=15,
        peak_rank="Immortal",
        peak_season="act_3_2025",
        last_played_match="00000000-0000-0000-0000-000000000001",
    )
    dumped = entry.model_dump()
    assert dumped == {
        "puuid": "puuid-1",
        "name": "duelist",
        "tag": "NA1",
        "discord_username": "quest",
        "current_tier": "Ascendant",
        "elo": 1200,
        "rank_in_tier": 15,
        "peak_rank": "Immortal",
        "peak_season": "act_3_2025",
        "last_played_match": "00000000-0000-0000-0000-000000000001",
    }
    assert dumped.keys() == {
        "puuid",
        "name",
        "tag",
        "discord_username",
        "current_tier",
        "elo",
        "rank_in_tier",
        "peak_rank",
        "peak_season",
        "last_played_match",
    }


def test_page_accepts_empty_entries():
    page = LeaderboardPage(entries=[], total=0, page=1, per_page=50, total_pages=0)
    assert page.entries == []
    assert page.total == 0
    assert page.page == 1
    assert page.per_page == 50
    assert page.total_pages == 0


def test_stats_accepts_rank_distribution_dict():
    stats = LeaderboardStats(
        total_users=1200,
        highest_elo=2500,
        lowest_elo=100,
        average_elo=1100.5,
        rank_distribution={"Iron": 100, "Ascendant": 200},
    )
    assert stats.rank_distribution == {"Iron": 100, "Ascendant": 200}
