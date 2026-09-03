"""Red/Blue side mapping helpers (plan Task 12; design §5.4, §10.2).

Pure, no I/O. A series game always maps exactly one side to team A and the
opposite side to team B, so ``resolve_sides`` is the only place a pair is
derived and ``team_b_side`` is never entered independently.
"""

from __future__ import annotations

_SIDES = frozenset({"red", "blue"})

OPPOSITE_SIDE: dict[str, str] = {"red": "blue", "blue": "red"}


def validate_side_literal(side: str) -> str:
    """Return ``side`` when it is a known literal, else raise ``ValueError``.

    The API schema already constrains ``team_a_side`` to ``{'red','blue'}``
    (422 ``INVALID_REQUEST`` at the boundary); this is the defensive domain
    gate that callers translate to ``INVALID_SIDE_MAPPING`` (422).
    """
    if side not in _SIDES:
        raise ValueError(f"invalid side mapping: {side!r}")
    return side


def resolve_sides(team_a_side: str) -> tuple[str, str]:
    """Return ``(team_a_side, team_b_side)`` with the opposite side as team B."""
    return team_a_side, OPPOSITE_SIDE[validate_side_literal(team_a_side)]
