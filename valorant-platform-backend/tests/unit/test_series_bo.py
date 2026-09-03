"""Pure best-of/side/result domain tests (plan Task 12; design §10.2–10.3).

Full ``validate_series_games`` matrix — valid shapes (BO1 1-0; BO3 2-0/2-1;
BO5 3-0/3-1/3-2) and every rejection (no winner, games after a clinch,
non-contiguous numbers, missing/same side mapping, incomplete matches,
winner-vs-rounds mismatches, too many games) — plus ``is_clinched``,
``compute_series_result``, and the ``sides`` helpers. No I/O.
"""

from __future__ import annotations

import uuid

import pytest

from app.domain.series.bo import (
    FORMAT_MAX_GAMES,
    FORMAT_REQUIRED_WINS,
    GameSnapshot,
    is_clinched,
    validate_draft_state,
    validate_series_games,
)
from app.domain.series.results import SeriesResult, compute_series_result
from app.domain.series.sides import OPPOSITE_SIDE, resolve_sides, validate_side_literal

TEAM_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TEAM_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


def _g(
    number: int,
    a_rounds: int,
    b_rounds: int,
    *,
    a_side: str = "red",
    b_side: str = "blue",
    winner: uuid.UUID | None | object = "auto",
    completed: bool = True,
) -> GameSnapshot:
    """Build a completed snapshot; ``winner`` defaults to the round-derived one."""
    if winner == "auto":
        winner = TEAM_A if a_rounds > b_rounds else TEAM_B if b_rounds > a_rounds else None
    return GameSnapshot(
        game_number=number,
        match_id=uuid.uuid4(),
        team_a_side=a_side,
        team_b_side=b_side,
        team_a_rounds=a_rounds,
        team_b_rounds=b_rounds,
        winner_team_id=winner,  # type: ignore[arg-type]
        is_completed=completed,
    )


def _a_wins(number: int) -> GameSnapshot:
    return _g(number, 13, 9)


def _b_wins(number: int) -> GameSnapshot:
    return _g(number, 9, 13)


# ------------------------------------------------------------- valid shapes


def test_bo1_1_0_is_valid() -> None:
    assert validate_series_games([_a_wins(1)], "bo1") == []


def test_bo3_2_0_is_valid() -> None:
    assert validate_series_games([_a_wins(1), _a_wins(2)], "bo3") == []


def test_bo3_2_1_is_valid() -> None:
    assert validate_series_games([_a_wins(1), _b_wins(2), _a_wins(3)], "bo3") == []


def test_bo5_3_0_is_valid() -> None:
    assert validate_series_games([_a_wins(1), _a_wins(2), _a_wins(3)], "bo5") == []


def test_bo5_3_1_is_valid() -> None:
    assert validate_series_games([_a_wins(1), _a_wins(2), _b_wins(3), _a_wins(4)], "bo5") == []


def test_bo5_3_2_is_valid() -> None:
    assert validate_series_games(
        [_a_wins(1), _b_wins(2), _a_wins(3), _b_wins(4), _a_wins(5)], "bo5"
    ) == []


# ----------------------------------------------------- invalid: no winner


def test_bo3_1_1_invalid_no_winner() -> None:
    errors = validate_series_games([_a_wins(1), _b_wins(2)], "bo3")

    assert any("no team reached the required wins" in error for error in errors)


def test_bo5_2_2_invalid_no_winner() -> None:
    errors = validate_series_games([_a_wins(1), _b_wins(2), _a_wins(3), _b_wins(4)], "bo5")

    assert any("no team reached the required wins" in error for error in errors)


def test_empty_series_invalid_no_winner() -> None:
    errors = validate_series_games([], "bo3")

    assert any("no team reached the required wins" in error for error in errors)


def test_tied_game_counts_as_no_win_for_either_team() -> None:
    errors = validate_series_games([_g(1, 12, 12)], "bo1")

    assert any("no team reached the required wins" in error for error in errors)


# ---------------------------------------------------- invalid: after clinch


def test_bo3_no_game_after_2_0_clinch() -> None:
    errors = validate_series_games([_a_wins(1), _a_wins(2), _a_wins(3)], "bo3")

    assert any("after the series" in error and "clinched" in error for error in errors)


def test_bo5_no_game_after_3_0_clinch() -> None:
    # A wins games 1-3; a fourth game must be rejected even though BO5 allows 5.
    errors = validate_series_games([_a_wins(1), _a_wins(2), _a_wins(3), _a_wins(4)], "bo5")

    assert any("after the series" in error and "clinched" in error for error in errors)


def test_bo5_no_sixth_game_after_3_0_clinch() -> None:
    games = [_a_wins(1), _a_wins(2), _a_wins(3), _b_wins(4), _b_wins(5), _a_wins(6)]
    errors = validate_series_games(games, "bo5")

    assert any("after the series" in error and "clinched" in error for error in errors)
    assert any("too many games" in error for error in errors)


# ------------------------------------------------- invalid: side mapping


def test_missing_side_mapping_invalid() -> None:
    games = [_g(1, 13, 9, a_side="")]

    errors = validate_series_games(games, "bo1")

    assert any("side" in error for error in errors)


def test_unknown_side_literal_invalid() -> None:
    games = [_g(1, 13, 9, b_side="Green")]

    errors = validate_series_games(games, "bo1")

    assert any("side" in error for error in errors)


def test_same_side_for_both_teams_invalid() -> None:
    games = [_g(1, 13, 9, a_side="red", b_side="red")]

    errors = validate_series_games(games, "bo1")

    assert any("same side" in error for error in errors)


# -------------------------------------------------- invalid: non-contiguous


def test_non_contiguous_game_numbers_invalid() -> None:
    games = [_a_wins(1), _a_wins(3)]

    errors = validate_series_games(games, "bo3")

    assert any("contiguous" in error for error in errors)


def test_game_numbers_must_start_at_one() -> None:
    games = [_a_wins(2), _a_wins(3)]

    errors = validate_series_games(games, "bo3")

    assert any("contiguous" in error for error in errors)


def test_duplicate_game_number_invalid() -> None:
    games = [_a_wins(1), _b_wins(1)]

    errors = validate_series_games(games, "bo3")

    assert any("contiguous" in error for error in errors)


# ----------------------------------------------------- invalid: completion


def test_incomplete_match_invalid() -> None:
    games = [_a_wins(1), _g(2, 9, 5, completed=False)]

    errors = validate_series_games(games, "bo3")

    assert any("not completed" in error for error in errors)


# ------------------------------------------------- invalid: winner mismatch


def test_missing_winner_on_decided_game_invalid() -> None:
    games = [_g(1, 13, 9, winner=None)]

    errors = validate_series_games(games, "bo1")

    assert any("winner" in error for error in errors)


def test_winner_set_on_tied_game_invalid() -> None:
    games = [_g(1, 12, 12, winner=TEAM_A)]

    errors = validate_series_games(games, "bo1")

    assert any("winner" in error for error in errors)


# ------------------------------------------------- invalid: too many games


def test_bo1_with_two_games_invalid() -> None:
    errors = validate_series_games([_a_wins(1), _a_wins(2)], "bo1")

    assert any("too many games" in error for error in errors)


def test_unknown_format_rejected() -> None:
    errors = validate_series_games([_a_wins(1)], "bo7")

    assert any("format" in error for error in errors)


def test_format_constants_are_exact() -> None:
    assert FORMAT_REQUIRED_WINS == {"bo1": 1, "bo3": 2, "bo5": 3}
    assert FORMAT_MAX_GAMES == {"bo1": 1, "bo3": 3, "bo5": 5}


# ---------------------------------------------------------------- is_clinched


def test_is_clinched_bo1() -> None:
    assert is_clinched(1, 0, "bo1") is True
    assert is_clinched(0, 1, "bo1") is True
    assert is_clinched(0, 0, "bo1") is False


def test_is_clinched_bo3() -> None:
    assert is_clinched(2, 0, "bo3") is True
    assert is_clinched(2, 1, "bo3") is True
    assert is_clinched(1, 1, "bo3") is False


def test_is_clinched_bo5() -> None:
    assert is_clinched(3, 0, "bo5") is True
    assert is_clinched(3, 2, "bo5") is True
    assert is_clinched(2, 2, "bo5") is False


# ------------------------------------------------------- compute_series_result


def test_compute_result_empty_series() -> None:
    result = compute_series_result([], TEAM_A, TEAM_B)

    assert result == SeriesResult(0, 0, None)


def test_compute_result_team_a_sweep() -> None:
    result = compute_series_result([_a_wins(1), _a_wins(2)], TEAM_A, TEAM_B)

    assert result.team_a_maps_won == 2
    assert result.team_b_maps_won == 0
    assert result.calculated_winner_id == TEAM_A


def test_compute_result_team_b_wins_bo3() -> None:
    result = compute_series_result([_a_wins(1), _b_wins(2), _b_wins(3)], TEAM_A, TEAM_B)

    assert result.team_a_maps_won == 1
    assert result.team_b_maps_won == 2
    assert result.calculated_winner_id == TEAM_B


def test_compute_result_tied_series_no_winner() -> None:
    result = compute_series_result([_a_wins(1), _b_wins(2)], TEAM_A, TEAM_B)

    assert result.team_a_maps_won == 1
    assert result.team_b_maps_won == 1
    assert result.calculated_winner_id is None


def test_compute_result_tied_game_counts_for_neither() -> None:
    result = compute_series_result([_g(1, 12, 12)], TEAM_A, TEAM_B)

    assert result == SeriesResult(0, 0, None)


# --------------------------------------------------------------------- sides


def test_opposite_side_table() -> None:
    assert OPPOSITE_SIDE == {"red": "blue", "blue": "red"}


def test_resolve_sides_derives_opposite() -> None:
    assert resolve_sides("red") == ("red", "blue")
    assert resolve_sides("blue") == ("blue", "red")


def test_validate_side_literal_accepts_known_sides() -> None:
    assert validate_side_literal("red") == "red"
    assert validate_side_literal("blue") == "blue"


def test_validate_side_literal_rejects_unknown_side() -> None:
    with pytest.raises(ValueError):
        validate_side_literal("Green")


# ------------------------------------------------------ validate_draft_state


def test_draft_state_bo3_one_win_resumable() -> None:
    # An in-progress draft with no winner yet is allowed while resumable.
    assert validate_draft_state([_a_wins(1)], "bo3") == []


def test_draft_state_bo3_1_1_resumable() -> None:
    assert validate_draft_state([_a_wins(1), _b_wins(2)], "bo3") == []


def test_draft_state_bo3_2_0_valid() -> None:
    assert validate_draft_state([_a_wins(1), _a_wins(2)], "bo3") == []


def test_draft_state_bo3_2_1_valid() -> None:
    assert validate_draft_state([_a_wins(1), _b_wins(2), _a_wins(3)], "bo3") == []


def test_draft_state_bo1_single_game_valid() -> None:
    assert validate_draft_state([_a_wins(1)], "bo1") == []


def test_draft_state_bo5_3_2_valid() -> None:
    games = [_a_wins(1), _b_wins(2), _a_wins(3), _b_wins(4), _a_wins(5)]
    assert validate_draft_state(games, "bo5") == []


def test_draft_state_rejects_bo1_second_game() -> None:
    errors = validate_draft_state([_a_wins(1), _a_wins(2)], "bo1")

    assert any("clinched" in error for error in errors)
    assert any("too many games" in error for error in errors)


def test_draft_state_rejects_post_clinch_game() -> None:
    errors = validate_draft_state([_a_wins(1), _a_wins(2), _a_wins(3)], "bo3")

    assert any("clinched" in error for error in errors)


def test_draft_state_rejects_gap() -> None:
    errors = validate_draft_state([_a_wins(1), _a_wins(3)], "bo3")

    assert any("contiguous" in error for error in errors)


def test_draft_state_rejects_tied_game() -> None:
    errors = validate_draft_state([_g(1, 12, 12)], "bo1")

    assert any("tied round score" in error for error in errors)


def test_draft_state_rejects_max_games_without_winner() -> None:
    # Three BO3 games but no team reaches two wins (a tie game eats a slot).
    games = [_a_wins(1), _b_wins(2), _g(3, 12, 12)]

    errors = validate_draft_state(games, "bo3")

    assert any("reached max games without a winner" in error for error in errors)
    assert any("tied round score" in error for error in errors)


def test_draft_state_rejects_incomplete_match() -> None:
    errors = validate_draft_state([_g(1, 13, 9, completed=False)], "bo1")

    assert any("not completed" in error for error in errors)


def test_draft_state_rejects_missing_winner_on_decided_game() -> None:
    errors = validate_draft_state([_g(1, 13, 9, winner=None)], "bo1")

    assert any("missing winner" in error for error in errors)


def test_draft_state_unknown_format_rejected() -> None:
    errors = validate_draft_state([_a_wins(1)], "bo7")

    assert any("format" in error for error in errors)
