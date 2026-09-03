"""Dual-shape rank-details reader (SDD 2026-08-14 leaderboard standardization, task 3).

Ported verbatim from ``valorantsl-new`` ``backend/app/models/user.py``
``get_rank_field``. Reads a rank field from either the flat
(``rank_details[key]``) or the legacy nested (``rank_details['data'][key]``)
shape; any other input yields ``default``. Shared by the leaderboard service,
registration, and workers.
"""

from typing import Any


def get_rank_field(rank_details: Any, key: str, default=None):
    """Read a rank field from either flat (rank_details[key]) or legacy
    nested (rank_details['data'][key]) shape."""
    if not isinstance(rank_details, dict):
        return default
    if key in rank_details:
        return rank_details.get(key)
    data = rank_details.get("data")
    if isinstance(data, dict):
        return data.get(key, default)
    return default
