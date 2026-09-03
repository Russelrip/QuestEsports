"""Anchor identity verification (spec §4.4 D6, §5.5). Pure, no I/O.

For rated finalization both anchor PUUIDs must appear in ``match_players`` on
OPPOSING sides of every attached game. Failure is 409 ``ANCHOR_MISMATCH``
unless the admin supplies an explicit ``override_reason`` + explicit rated
mode (the audited override path, enforced in ``rating_service``).
"""

from __future__ import annotations

import uuid


def verify_opposing_anchors(
    *,
    anchor_a: str,
    anchor_b: str,
    match_ids: list[uuid.UUID],
    sides_by_match: dict[uuid.UUID, dict[str, str]],
) -> list[str]:
    """Return per-game verification errors (empty == verified).

    ``sides_by_match`` maps ``match_id -> {puuid: side}`` for the two anchors
    only (the caller pre-filters by the anchor puuids). A game missing from
    the map carries neither anchor.
    """
    errors: list[str] = []
    for match_id in match_ids:
        sides = sides_by_match.get(match_id, {})
        side_a = sides.get(anchor_a)
        side_b = sides.get(anchor_b)
        if side_a is None:
            errors.append(f"game {match_id}: anchor A not found on either side")
        if side_b is None:
            errors.append(f"game {match_id}: anchor B not found on either side")
        if side_a is not None and side_b is not None and side_a == side_b:
            errors.append(f"game {match_id}: anchors are not on opposing sides")
    return errors
