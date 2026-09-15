"""Server check step of the rank updater (0018).

For each player the updater has just refreshed, fetch the servers of their
recent competitive matches, at most once per ``server_check_interval_hours``,
and record them. Flagging happens at read time (``ServerCheckService``); this
only gathers evidence.

It rides on the updater instead of running as its own worker so it shares the
updater's pacing, pause window and write-freeze gate, and adds no service to
the production release. With a 24 h interval and a ~76 min pass, a typical
pass checks about one player in twenty; the first pass after this ships checks
everyone. ``checked_at`` lives in the database, so a deploy restarting the pass
does not make everyone due again.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.db.repositories.leaderboard_server_check_repository import LeaderboardServerCheckRepository
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import HenrikNotFoundError


class ServerChecker:
    def __init__(
        self,
        client: HenrikClient,
        repo: LeaderboardServerCheckRepository,
        *,
        affinity: str,
        match_count: int,
        interval: timedelta,
        delay: float,
    ) -> None:
        self._client = client
        self._repo = repo
        self._affinity = affinity
        self._match_count = match_count
        self._interval = interval
        self._delay = delay
        self._checked_at: dict[str, datetime | None] = {}

    @classmethod
    def from_settings(
        cls, client: HenrikClient, repo: LeaderboardServerCheckRepository, settings: Settings
    ) -> ServerChecker:
        return cls(
            client,
            repo,
            affinity=settings.leaderboard_affinity,
            match_count=settings.server_check_match_count,
            interval=timedelta(hours=settings.server_check_interval_hours),
            delay=settings.updater_rate_limit_delay,
        )

    async def start_pass(self) -> None:
        """Read every player's last check once, so the pass needs no per-player query."""
        self._checked_at = await self._repo.checked_at_by_puuid()

    def is_due(self, puuid: str, now: datetime | None = None) -> bool:
        checked_at = self._checked_at.get(puuid)
        return checked_at is None or (now or datetime.now(UTC)) - checked_at >= self._interval

    async def check(self, puuid: str) -> bool:
        """Fetch and record one player's servers if due; ``False`` when not due.

        A 404 means Henrik has no stored matches for this account on the home
        shard, which is itself the evidence (an account on another shard), so it
        is recorded as a check that found none. Any other failure raises and is
        retried on the next pass, because nothing was stamped.
        """
        if not self.is_due(puuid):
            return False
        # One more Henrik request for this player; keep the updater's spacing.
        await asyncio.sleep(self._delay)
        try:
            matches = await self._client.get_stored_competitive_servers(
                puuid, affinity=self._affinity, size=self._match_count
            )
        except HenrikNotFoundError:
            matches = []
        await self._repo.record_servers(puuid, matches)
        self._checked_at[puuid] = datetime.now(UTC)
        return True
