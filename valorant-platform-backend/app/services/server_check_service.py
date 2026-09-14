"""Leaderboard server check service (0018): list flagged players, clear and reopen flags.

Reads what the updater recorded; it never calls Henrik. Evaluation happens at
read time with the rule from settings, so changing the rule needs no refetch.
There are a few hundred registrations, so every one is evaluated per request
and filtered in Python; the per-server counts come from one grouped query.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import Settings
from app.db.models import LeaderboardPlayer, LeaderboardServerCheck
from app.db.repositories.leaderboard_player_repository import (
    MIN_QUERY_LENGTH,
    LeaderboardPlayerRepository,
    is_listed,
)
from app.db.repositories.leaderboard_server_check_repository import LeaderboardServerCheckRepository
from app.domain.leaderboard.server_check import ServerCheckPolicy, evaluate
from app.schemas.server_checks import (
    LeaderboardServerCheckEntry,
    LeaderboardServerCheckPage,
    ServerCheckRule,
    ServerCheckSummary,
    ServerMatchCount,
)

ServerCheckFilter = Literal["flagged", "cleared"]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


class ServerCheckService:
    def __init__(
        self,
        session: AsyncSession,
        repo: LeaderboardServerCheckRepository,
        players: LeaderboardPlayerRepository,
        settings: Settings,
    ) -> None:
        self._session = session
        self._repo = repo
        self._players = players
        self._settings = settings
        self._policy = ServerCheckPolicy.from_settings(settings)

    async def list_checks(
        self, status: ServerCheckFilter, query: str, page: int, per_page: int
    ) -> LeaderboardServerCheckPage:
        """Flagged players, most clearly away first; or cleared ones, latest clearance first."""
        now = datetime.now(UTC)
        entries = await self._evaluate_all(now)

        summary = ServerCheckSummary(
            registered=len(entries),
            checked=sum(1 for entry in entries if entry.checked_at is not None),
            flagged=sum(1 for entry in entries if entry.status == "flagged"),
            cleared=sum(1 for entry in entries if entry.status == "cleared"),
        )

        selected = [entry for entry in entries if entry.status == status]
        needle = query.strip().lstrip("@").casefold()
        if len(needle) >= MIN_QUERY_LENGTH:
            selected = [
                entry for entry in selected
                if needle in f"{entry.name}#{entry.tag}".casefold()
                or needle in entry.discord_username.casefold()
            ]
        if status == "flagged":
            selected.sort(key=lambda e: (-(e.away_share or 0), -e.away_matches, e.name.casefold(), e.puuid))
        else:
            selected.sort(key=lambda e: (e.cleared_at or ""), reverse=True)

        total = len(selected)
        start = (page - 1) * per_page
        return LeaderboardServerCheckPage(
            entries=selected[start:start + per_page],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
            summary=summary,
            rule=ServerCheckRule(
                home_clusters=list(self._policy.home_clusters),
                home_shard=self._policy.home_shard,
                window_days=self._settings.server_check_window_days,
                min_matches=self._policy.min_matches,
                away_share=self._policy.away_share,
            ),
        )

    async def clear(self, puuid: str, actor_id: str | None = None) -> LeaderboardServerCheckEntry:
        """Keep a flagged player: the evidence so far stops counting against them.

        Only a flagged player can be cleared, so a clearance always records a
        decision someone actually made about a flag.
        """
        entry = await self._entry_for(puuid)
        if entry.status != "flagged":
            raise AppError(
                "LEADERBOARD_SERVER_CHECK_NOT_FLAGGED", 409, "this player is not flagged by the server check"
            )
        await self._repo.clear(puuid, cleared_by=actor_id)
        await self._session.commit()
        return await self._entry_for(puuid)

    async def reopen(self, puuid: str) -> LeaderboardServerCheckEntry:
        """Undo a clearance, so every match in the window counts again."""
        await self._entry_for(puuid)
        if not await self._repo.reopen(puuid):
            await self._session.rollback()
            raise AppError(
                "LEADERBOARD_SERVER_CHECK_NOT_CLEARED", 409, "this player's server check has not been cleared"
            )
        await self._session.commit()
        return await self._entry_for(puuid)

    # ------------------------------------------------------------ internals

    async def _entry_for(self, puuid: str) -> LeaderboardServerCheckEntry:
        if await self._players.get_by_puuid(puuid) is None:
            raise AppError("LEADERBOARD_PLAYER_NOT_FOUND", 404, "leaderboard player not found")
        for entry in await self._evaluate_all(datetime.now(UTC)):
            if entry.puuid == puuid:
                return entry
        raise AppError("LEADERBOARD_PLAYER_NOT_FOUND", 404, "leaderboard player not found")

    async def _evaluate_all(self, now: datetime) -> list[LeaderboardServerCheckEntry]:
        cutoff = now - self._policy.window
        counts = await self._repo.server_counts(cutoff)
        return [
            self._to_entry(player, check, counts.get(player.puuid, {}), cutoff, now)
            for player, check in await self._repo.registrations_with_checks()
        ]

    def _to_entry(
        self,
        player: LeaderboardPlayer,
        check: LeaderboardServerCheck | None,
        servers: dict[str | None, int],
        cutoff: datetime,
        now: datetime,
    ) -> LeaderboardServerCheckEntry:
        cleared_at = check.cleared_at if check else None
        checked_at = check.checked_at if check else None
        verdict = evaluate(
            account_region=player.region,
            servers=servers,
            cleared=cleared_at is not None,
            policy=self._policy,
        )
        status = verdict.status
        if status == "not_enough_matches" and checked_at is None:
            status = "not_checked"
        return LeaderboardServerCheckEntry(
            puuid=player.puuid,
            name=player.name,
            tag=player.tag,
            discord_username=player.discord_username,
            current_tier=player.currenttierpatched,
            elo=player.elo,
            last_played_match=_iso(player.last_played_match),
            on_leaderboard=is_listed(player, now),
            account_region=player.region,
            status=status,
            reasons=list(verdict.reasons),
            matches=verdict.matches,
            known_matches=verdict.known_matches,
            away_matches=verdict.away_matches,
            away_share=verdict.away_share,
            servers=[
                ServerMatchCount(cluster=count.cluster, matches=count.matches, home=count.home)
                for count in verdict.servers
            ],
            since=max(cutoff, cleared_at).isoformat() if cleared_at else cutoff.isoformat(),
            checked_at=_iso(checked_at),
            cleared_at=_iso(cleared_at),
            cleared_by=check.cleared_by if check else None,
        )
