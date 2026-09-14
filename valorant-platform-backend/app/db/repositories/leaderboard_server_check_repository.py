"""Leaderboard server check data access (0018).

``LeaderboardServerCheckRepository`` owns ``leaderboard_player_server_matches``
and ``leaderboard_player_server_checks``. It never writes ``leaderboard_players``:
the updater's rank refresh and admin removal stay exactly as they were.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LeaderboardPlayer, LeaderboardServerCheck, LeaderboardServerMatch
from app.integrations.henrik.models import HenrikServerMatch

# Matches older than this are deleted when a player is checked. Longer than any
# sensible window, so changing the window does not need a refetch.
RETENTION = timedelta(days=120)


class LeaderboardServerCheckRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def checked_at_by_puuid(self) -> dict[str, datetime | None]:
        """When each player's servers were last fetched; players never fetched are absent."""
        rows = (await self._session.execute(
            select(LeaderboardServerCheck.puuid, LeaderboardServerCheck.checked_at)
        )).all()
        return {puuid: checked_at for puuid, checked_at in rows}

    async def record_servers(self, puuid: str, matches: Iterable[HenrikServerMatch]) -> None:
        """Store the servers seen for a player, stamp the check, and commit.

        A match already stored is left as it was. Commits on its own, like the
        rank refresh before it, so nothing here holds a lock across a pass. The
        updater only calls this for a player whose refresh just found their row;
        a removal landing in between leaves rows that are simply never listed.
        """
        values = [
            {
                "puuid": puuid,
                "match_id": match.match_id,
                "cluster": match.cluster,
                "shard": match.shard,
                "started_at": match.started_at,
            }
            for match in matches
        ]
        if values:
            await self._session.execute(
                pg_insert(LeaderboardServerMatch).values(values).on_conflict_do_nothing(
                    index_elements=[LeaderboardServerMatch.puuid, LeaderboardServerMatch.match_id]
                )
            )
        await self._session.execute(
            delete(LeaderboardServerMatch).where(
                LeaderboardServerMatch.puuid == puuid,
                LeaderboardServerMatch.started_at < func.now() - RETENTION,
            )
        )
        stamp = pg_insert(LeaderboardServerCheck).values(puuid=puuid, checked_at=func.now())
        await self._session.execute(
            stamp.on_conflict_do_update(
                index_elements=[LeaderboardServerCheck.puuid],
                set_={"checked_at": stamp.excluded.checked_at},
            )
        )
        await self._session.commit()

    async def registrations_with_checks(
        self,
    ) -> list[tuple[LeaderboardPlayer, LeaderboardServerCheck | None]]:
        """Every registration with its check row, if it has one.

        ``populate_existing``: sessions do not expire on commit, so without it a
        read straight after ``reopen`` would return the stale clearance.
        """
        rows = (await self._session.execute(
            select(LeaderboardPlayer, LeaderboardServerCheck)
            .outerjoin(LeaderboardServerCheck, LeaderboardServerCheck.puuid == LeaderboardPlayer.puuid)
            .order_by(LeaderboardPlayer.puuid)
            .execution_options(populate_existing=True)
        )).all()
        return [(row[0], row[1]) for row in rows]

    async def server_counts(self, cutoff: datetime) -> dict[str, dict[str | None, int]]:
        """Per registered player, matches per server since ``cutoff`` or their clearance.

        Whichever is later: a clearance covers the matches before it.
        """
        since = func.greatest(cutoff, func.coalesce(LeaderboardServerCheck.cleared_at, cutoff))
        rows = (await self._session.execute(
            select(LeaderboardServerMatch.puuid, LeaderboardServerMatch.cluster, func.count())
            .join(LeaderboardPlayer, LeaderboardPlayer.puuid == LeaderboardServerMatch.puuid)
            .outerjoin(LeaderboardServerCheck, LeaderboardServerCheck.puuid == LeaderboardServerMatch.puuid)
            .where(LeaderboardServerMatch.started_at >= since)
            .group_by(LeaderboardServerMatch.puuid, LeaderboardServerMatch.cluster)
        )).all()
        counts: dict[str, dict[str | None, int]] = defaultdict(dict)
        for puuid, cluster, n in rows:
            counts[puuid][cluster] = n
        return dict(counts)

    async def clear(self, puuid: str, *, cleared_by: str | None) -> LeaderboardServerCheck:
        """Record that an admin reviewed this player's flag and kept them. The caller commits."""
        stmt = pg_insert(LeaderboardServerCheck).values(
            puuid=puuid, cleared_at=func.now(), cleared_by=cleared_by
        )
        return (await self._session.execute(
            stmt.on_conflict_do_update(
                index_elements=[LeaderboardServerCheck.puuid],
                set_={"cleared_at": stmt.excluded.cleared_at, "cleared_by": stmt.excluded.cleared_by},
            )
            .returning(LeaderboardServerCheck)
            .execution_options(populate_existing=True)
        )).scalar_one()

    async def reopen(self, puuid: str) -> bool:
        """Undo a clearance; ``False`` when there was none. The caller commits."""
        result = await self._session.execute(
            update(LeaderboardServerCheck)
            .where(LeaderboardServerCheck.puuid == puuid, LeaderboardServerCheck.cleared_at.is_not(None))
            .values(cleared_at=None, cleared_by=None)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount > 0
