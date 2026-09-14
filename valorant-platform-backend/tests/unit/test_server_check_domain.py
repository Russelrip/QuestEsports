"""Leaderboard server check rule (0018): when a registration is flagged for review."""

from __future__ import annotations

from datetime import timedelta

from app.config import Settings
from app.domain.leaderboard.server_check import ServerCheckPolicy, evaluate

POLICY = ServerCheckPolicy(
    home_clusters=("Singapore", "Mumbai"),
    home_shard="ap",
    window=timedelta(days=30),
    min_matches=5,
    away_share=0.5,
)


def _judge(servers: dict[str | None, int], *, region: str = "ap", cleared: bool = False):
    return evaluate(account_region=region, servers=servers, cleared=cleared, policy=POLICY)


def test_policy_reads_settings_and_trims_cluster_names() -> None:
    policy = ServerCheckPolicy.from_settings(
        Settings(server_check_home_clusters=" Singapore, Mumbai ,,", server_check_window_days=14)
    )
    assert policy.home_clusters == ("Singapore", "Mumbai")
    assert policy.home_shard == "ap"
    assert policy.window == timedelta(days=14)


def test_home_players_are_clear() -> None:
    # The common production shapes: all Mumbai, all Singapore, or a mix.
    for servers in ({"Mumbai": 25}, {"Singapore": 25}, {"Singapore": 13, "Mumbai": 12}):
        verdict = _judge(servers)
        assert verdict.status == "clear"
        assert verdict.reasons == ()
        assert verdict.away_matches == 0


def test_mostly_away_is_flagged() -> None:
    # One of the three Sydney players in the 2026-09-14 sample.
    verdict = _judge({"Sydney": 24, "Mumbai": 1})
    assert verdict.status == "flagged"
    assert verdict.reasons == ("away_servers",)
    assert verdict.away_matches == 24
    assert verdict.known_matches == 25
    assert verdict.away_share == 24 / 25


def test_the_share_threshold_is_inclusive() -> None:
    assert _judge({"Tokyo": 5, "Singapore": 5}).status == "flagged"
    assert _judge({"Tokyo": 4, "Singapore": 6}).status == "clear"


def test_too_few_known_matches_is_not_judged() -> None:
    verdict = _judge({"Sydney": 4})
    assert verdict.status == "not_enough_matches"
    assert verdict.reasons == ()


def test_unknown_servers_count_towards_nothing() -> None:
    verdict = _judge({None: 20, "Sydney": 4})
    assert verdict.status == "not_enough_matches"
    assert verdict.matches == 24
    assert verdict.known_matches == 4
    # Unknown servers do not dilute the share either.
    assert _judge({None: 20, "Sydney": 5}).away_share == 1.0


def test_cluster_names_match_case_insensitively() -> None:
    assert _judge({"singapore": 10}).status == "clear"


def test_an_account_off_the_home_shard_is_flagged_without_any_matches() -> None:
    verdict = _judge({}, region="eu")
    assert verdict.status == "flagged"
    assert verdict.reasons == ("account_region",)
    assert _judge({}, region="AP").status == "not_enough_matches"


def test_both_reasons_are_reported() -> None:
    assert _judge({"Frankfurt": 10}, region="eu").reasons == ("account_region", "away_servers")


def test_a_clearance_drops_the_region_reason_but_not_new_away_matches() -> None:
    assert _judge({}, region="eu", cleared=True).status == "cleared"
    # The caller passes only post-clearance matches; enough of them flag again.
    again = _judge({"Sydney": 6}, region="eu", cleared=True)
    assert again.status == "flagged"
    assert again.reasons == ("away_servers",)


def test_servers_are_listed_most_played_first_with_unknown_last() -> None:
    verdict = _judge({None: 9, "Mumbai": 3, "Sydney": 9, "Singapore": 3})
    assert [(s.cluster, s.matches, s.home) for s in verdict.servers] == [
        ("Sydney", 9, False),
        (None, 9, None),
        ("Mumbai", 3, True),
        ("Singapore", 3, True),
    ]
