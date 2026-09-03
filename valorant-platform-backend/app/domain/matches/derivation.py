"""Pure match derivation helpers (plan Task 5; design §5.4 scores/winners).

No I/O. Consumes already-normalized ``HenrikTeam`` models (the mapper
normalizes ``team_id`` to ``red``/``blue`` via the pinned side-literal table).
"""

from app.integrations.henrik.models import HenrikTeam

_RED = "red"
_BLUE = "blue"


def derive_scores(teams: list[HenrikTeam]) -> tuple[int | None, int | None]:
    """Return ``(red_score, blue_score)`` from ``teams[].rounds.won``.

    A side that is absent from ``teams`` yields ``None`` for that score;
    rounds defaults keep the pinned ``HenrikRounds`` semantics.
    """
    red = next((team for team in teams if team.team_id == _RED), None)
    blue = next((team for team in teams if team.team_id == _BLUE), None)
    return (
        red.rounds.won if red is not None else None,
        blue.rounds.won if blue is not None else None,
    )


def derive_winning_side(teams: list[HenrikTeam]) -> str | None:
    """Derive the winning side from ``teams[].won``.

    Exactly one winning team -> its side (``"red"``/``"blue"``); more than one
    winning team -> ``"draw"``; no winner observed -> ``"unknown"``. Tolerant
    of the incomplete-match case where every ``won`` is ``None``.
    """
    winners = [team.team_id for team in teams if team.won is True]
    if len(winners) == 1:
        return winners[0]
    if len(winners) > 1:
        return "draw"
    return "unknown"
