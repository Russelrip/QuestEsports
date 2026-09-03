"""``get_rank_field`` dual-shape helper tests (plan task 3).

Ported verbatim from ``valorantsl-new`` ``backend/app/models/user.py``; the
hard requirement is dual-shape tolerance: a flat key wins, a legacy
``rank_details['data'][key]`` nested fallback is honored, and any other input
falls back to ``default``.
"""

from app.services.rank_field import get_rank_field


def test_flat_key_present_wins():
    rank_details = {"ranking_in_tier": 42, "currenttierpatched": "Gold 1"}
    assert get_rank_field(rank_details, "ranking_in_tier") == 42


def test_legacy_nested_data_fallback():
    rank_details = {"data": {"ranking_in_tier": 7, "elo": 900}}
    assert get_rank_field(rank_details, "ranking_in_tier") == 7


def test_flat_shape_takes_precedence_over_nested():
    rank_details = {"ranking_in_tier": 42, "data": {"ranking_in_tier": 7}}
    assert get_rank_field(rank_details, "ranking_in_tier") == 42


def test_non_dict_input_returns_default():
    assert get_rank_field(None, "ranking_in_tier") is None
    assert get_rank_field("rank", "ranking_in_tier", default=0) == 0
    assert get_rank_field(["not", "a", "dict"], "ranking_in_tier", default=-1) == -1


def test_missing_key_returns_default():
    assert get_rank_field({}, "ranking_in_tier") is None
    assert get_rank_field({"data": {"elo": 1}}, "ranking_in_tier", default=-1) == -1


def test_nested_data_not_a_dict_returns_default():
    rank_details = {"data": "not-a-dict"}
    assert get_rank_field(rank_details, "ranking_in_tier", default=99) == 99


def test_explicit_default_value_returned():
    rank_details = {"ranking_in_tier": 5}
    assert get_rank_field(rank_details, "elo", default="missing") == "missing"
