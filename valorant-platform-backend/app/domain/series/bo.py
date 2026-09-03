"""Best-of (BO1/BO3/BO5) validation rules (plan Task 12; design §10.2).

Pure, no I/O. ``validate_series_games`` checks the design §10.2 finalization
rules against a series' attached games:

1. game numbers start at 1 and are contiguous;
2. every attached game has a valid side mapping;
3. every attached match is completed;
4. exactly one team reaches the required wins;
5. no game exists after the series was already mathematically clinched;
6. every game has a round-derived winner (ties are rejected) and the stored
   ``winner_team_id`` agrees with that derivation.

Because ``GameSnapshot`` carries no team ids, rule 6 is enforced as a
consistency check: a decided game (unequal rounds) must store a winner, and a
tied game must not store one. The series-level winner agreement (winner UUID
vs rounds via the side mapping) is checked by the service, which also derives
every stored winner exclusively from the mapped team-A/team-B round totals
(never from ``match.winning_side``).

``validate_draft_state`` is the mutation-time gate (fix round 1): it enforces
every structural rule on every draft mutation so only valid draft states
persist, while allowing an in-progress series (no winner yet) as long as it is
still resumable — a draft must be buildable up to a valid 2-1/3-2 shape.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

# Valid side literals (design §5.4 pinned side table).
_SIDES = frozenset({"red", "blue"})

# Required map wins / maximum games per format.
FORMAT_REQUIRED_WINS: dict[str, int] = {"bo1": 1, "bo3": 2, "bo5": 3}
FORMAT_MAX_GAMES: dict[str, int] = {"bo1": 1, "bo3": 3, "bo5": 5}


@dataclass(frozen=True)
class GameSnapshot:
    """The persisted state of one attached series game (no I/O)."""

    game_number: int
    match_id: uuid.UUID
    team_a_side: str
    team_b_side: str
    team_a_rounds: int
    team_b_rounds: int
    winner_team_id: uuid.UUID | None
    is_completed: bool


@dataclass(frozen=True)
class CanonicalGameSnapshot:
    """Preview read model for one attached game (no I/O).

    Persisted structural fields (game number, side mapping, stored winner) plus
    the CURRENT canonical match state (map, scores, completion). The preview
    service derives the game's rounds and winner from these current match
    values through the persisted side mapping — never from the copied
    ``series_games.team_a_rounds``/``team_b_rounds``/``winner_team_id``
    snapshot columns, which go stale when a canonical match is refreshed.
    ``stored_winner_team_id`` is kept only so the preview can flag a stored
    winner that no longer agrees with the currently derived winner.
    """

    game_id: uuid.UUID
    game_number: int
    match_id: uuid.UUID
    map_name: str | None
    team_a_side: str
    team_b_side: str
    stored_winner_team_id: uuid.UUID | None
    red_score: int | None
    blue_score: int | None
    is_completed: bool


def is_clinched(team_a_wins: int, team_b_wins: int, format_: str) -> bool:
    """True once either team has reached the format's required wins."""
    return team_a_wins >= FORMAT_REQUIRED_WINS[format_] or team_b_wins >= FORMAT_REQUIRED_WINS[format_]


def validate_series_games(games: list[GameSnapshot], format_: str) -> list[str]:
    """Validate the games against the best-of rules; empty list == valid.

    Errors are human-readable and deterministic; each rule reports at most
    once per affected game so callers can surface them directly.
    """
    errors: list[str] = []
    required = FORMAT_REQUIRED_WINS.get(format_)
    max_games = FORMAT_MAX_GAMES.get(format_)
    if required is None or max_games is None:
        errors.append(f"unknown format: {format_}")
        return errors

    ordered = sorted(games, key=lambda game: game.game_number)

    # 1. Contiguous game numbers starting at 1.
    numbers = [game.game_number for game in ordered]
    if numbers != list(range(1, len(games) + 1)):
        errors.append("game numbers must start at 1 and be contiguous")

    # 2. Valid side mapping (both sides in {'red','blue'}, distinct).
    for game in ordered:
        if game.team_a_side not in _SIDES or game.team_b_side not in _SIDES:
            errors.append(f"game {game.game_number}: invalid side mapping")
        elif game.team_a_side == game.team_b_side:
            errors.append(f"game {game.game_number}: both teams on the same side")

    # 3. Completed matches only.
    for game in ordered:
        if not game.is_completed:
            errors.append(f"game {game.game_number}: match is not completed")

    # 3.5 Ties are rejected (fix round 1): every game must have a
    #     round-derived winner.
    for game in ordered:
        if game.team_a_rounds == game.team_b_rounds:
            errors.append(f"game {game.game_number}: tied round score has no winner")

    # 4 + 5. Running map wins; count them and reject any game after a clinch.
    team_a_wins = 0
    team_b_wins = 0
    for game in ordered:
        if is_clinched(team_a_wins, team_b_wins, format_):
            errors.append(f"game {game.game_number}: no game after the series was already clinched")
            break  # every later game is after the clinch too
        if game.team_a_rounds > game.team_b_rounds:
            team_a_wins += 1
        elif game.team_b_rounds > game.team_a_rounds:
            team_b_wins += 1
        # A tied game counts as a win for neither team (already rejected above).

    if team_a_wins >= required and team_b_wins >= required:
        errors.append("both teams reached the required wins")
    elif team_a_wins < required and team_b_wins < required:
        errors.append("no team reached the required wins")

    # 6. Stored winner agrees with the round-derived winner (decided games
    #    store one; tied games store none).
    for game in ordered:
        decided = game.team_a_rounds != game.team_b_rounds
        if decided and game.winner_team_id is None:
            errors.append(f"game {game.game_number}: missing winner for a decided game")
        elif not decided and game.winner_team_id is not None:
            errors.append(f"game {game.game_number}: winner set on a tied game")

    # 7. Format bound (defense in depth for shapes that escape the clinch
    #    check, e.g. a 2-1 BO3 carried on with extra games already flagged).
    if len(games) > max_games:
        errors.append(f"too many games for {format_}: {len(games)} > {max_games}")

    return errors


def validate_draft_state(games: list[GameSnapshot], format_: str) -> list[str]:
    """Mutation-time draft validation (fix round 1); empty list == valid.

    Enforces every structural best-of rule so only valid draft states persist:
    contiguous numbers (no gaps/duplicates), valid distinct sides, completed
    matches only, no tied games, no game after a clinch, the format bound, and
    winner/round consistency. Unlike ``validate_series_games`` (a finalization
    gate), an in-progress series with no winner yet is allowed while it is
    still resumable (fewer games than the format allows).
    """
    errors: list[str] = []
    required = FORMAT_REQUIRED_WINS.get(format_)
    max_games = FORMAT_MAX_GAMES.get(format_)
    if required is None or max_games is None:
        errors.append(f"unknown format: {format_}")
        return errors

    ordered = sorted(games, key=lambda game: game.game_number)

    # 1. Contiguous game numbers starting at 1.
    numbers = [game.game_number for game in ordered]
    if numbers != list(range(1, len(games) + 1)):
        errors.append("game numbers must start at 1 and be contiguous")

    # 2. Valid side mapping (both sides in {'red','blue'}, distinct).
    for game in ordered:
        if game.team_a_side not in _SIDES or game.team_b_side not in _SIDES:
            errors.append(f"game {game.game_number}: invalid side mapping")
        elif game.team_a_side == game.team_b_side:
            errors.append(f"game {game.game_number}: both teams on the same side")

    # 3. Completed matches only.
    for game in ordered:
        if not game.is_completed:
            errors.append(f"game {game.game_number}: match is not completed")

    # 4. Ties are rejected: every game must have a round-derived winner.
    for game in ordered:
        if game.team_a_rounds == game.team_b_rounds:
            errors.append(f"game {game.game_number}: tied round score has no winner")

    # 5. Running map wins + no game after a clinch.
    team_a_wins = 0
    team_b_wins = 0
    for game in ordered:
        if is_clinched(team_a_wins, team_b_wins, format_):
            errors.append(f"game {game.game_number}: no game after the series was already clinched")
            break  # every later game is after the clinch too
        if game.team_a_rounds > game.team_b_rounds:
            team_a_wins += 1
        elif game.team_b_rounds > game.team_a_rounds:
            team_b_wins += 1

    # 6. Format bound.
    if len(games) > max_games:
        errors.append(f"too many games for {format_}: {len(games)} > {max_games}")

    # 7. Settled-or-resumable: at the format's max game count a winner must
    #    have emerged (an in-progress draft is allowed only while resumable).
    if len(games) == max_games and team_a_wins < required and team_b_wins < required:
        errors.append("series reached max games without a winner")

    # 8. Stored winner agrees with the round-derived winner.
    for game in ordered:
        decided = game.team_a_rounds != game.team_b_rounds
        if decided and game.winner_team_id is None:
            errors.append(f"game {game.game_number}: missing winner for a decided game")
        elif not decided and game.winner_team_id is not None:
            errors.append(f"game {game.game_number}: winner set on a tied game")

    return errors
