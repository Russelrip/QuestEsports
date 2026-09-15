"""Leaderboard server check: whether a registration looks like it is not from Sri Lanka (0018).

Pure, no I/O. The leaderboard is for Sri Lankan players, and they play
competitive on the AP shard, on the Singapore and Mumbai servers. Two things
make a registration worth a human look:

- ``account_region``: the Riot account is not on the home shard at all.
- ``away_servers``: at least ``min_matches`` recent competitive matches were on
  a known server, and at least ``away_share`` of them were on servers other
  than the home ones.

This only ever *flags*. A Sri Lankan living abroad, or one who plays with
friends on another server, looks the same as someone who is not Sri Lankan, so
an admin decides, and removal goes through the ordinary audited removal.

An admin who reviews a flag and keeps the player *clears* it. The clearance
covers the evidence it was based on: the account region no longer counts, and
only matches that started after the clearance are considered. Enough away
matches after it flag the player again.

A match whose server Henrik did not report counts towards nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

ServerCheckStatus = Literal["flagged", "cleared", "clear", "not_enough_matches"]
ServerCheckReason = Literal["account_region", "away_servers"]


@dataclass(frozen=True)
class ServerCheckPolicy:
    home_clusters: tuple[str, ...]
    home_shard: str
    window: timedelta
    min_matches: int
    away_share: float

    @classmethod
    def from_settings(cls, settings) -> ServerCheckPolicy:
        clusters = tuple(
            name.strip() for name in settings.server_check_home_clusters.split(",") if name.strip()
        )
        return cls(
            home_clusters=clusters,
            home_shard=settings.leaderboard_affinity,
            window=timedelta(days=settings.server_check_window_days),
            min_matches=settings.server_check_min_matches,
            away_share=settings.server_check_away_share,
        )

    def is_home(self, cluster: str | None) -> bool | None:
        """``None`` for an unknown server, otherwise whether it is a home one."""
        if cluster is None:
            return None
        return cluster.casefold() in {name.casefold() for name in self.home_clusters}


@dataclass(frozen=True)
class ServerCount:
    cluster: str | None
    matches: int
    home: bool | None


@dataclass(frozen=True)
class ServerVerdict:
    status: ServerCheckStatus
    reasons: tuple[ServerCheckReason, ...]
    matches: int
    known_matches: int
    away_matches: int
    away_share: float | None
    servers: tuple[ServerCount, ...]


def evaluate(
    *,
    account_region: str,
    servers: dict[str | None, int],
    cleared: bool,
    policy: ServerCheckPolicy,
) -> ServerVerdict:
    """Judge one player from their per-server match counts.

    ``servers`` must already be limited to the matches under consideration:
    inside the window, and after the clearance when there is one.
    """
    counts = tuple(
        sorted(
            (ServerCount(cluster, n, policy.is_home(cluster)) for cluster, n in servers.items() if n > 0),
            key=lambda count: (-count.matches, count.cluster is None, (count.cluster or "").casefold()),
        )
    )
    matches = sum(count.matches for count in counts)
    known = sum(count.matches for count in counts if count.home is not None)
    away = sum(count.matches for count in counts if count.home is False)
    share = away / known if known else None

    reasons: list[ServerCheckReason] = []
    if not cleared and account_region.strip().casefold() != policy.home_shard.casefold():
        reasons.append("account_region")
    if share is not None and known >= policy.min_matches and share >= policy.away_share:
        reasons.append("away_servers")

    if reasons:
        status: ServerCheckStatus = "flagged"
    elif cleared:
        status = "cleared"
    elif known < policy.min_matches:
        status = "not_enough_matches"
    else:
        status = "clear"
    return ServerVerdict(
        status=status,
        reasons=tuple(reasons),
        matches=matches,
        known_matches=known,
        away_matches=away,
        away_share=share,
        servers=counts,
    )
