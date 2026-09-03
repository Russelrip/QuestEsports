"""Background rank updater (SDD 2026-08-14 leaderboard standardization, task 7).

Ports ``valorantsl-new/updater/updater.py``'s PlayerUpdater loop onto this
repo's shared ``HenrikClient`` (task 3) + ``LeaderboardPlayerRepository`` (task
1). Every ``updater_interval_minutes`` the scheduler pulls all
``leaderboard_players``, fetches MMR + last competitive match per player via
``HenrikClient`` (which ALREADY owns ``Retry-After``/429 handling and the
transient retry budget — this worker never re-implements retries), and upserts
name/tag/rank data with ``update_source="updater_service"``. A between-player
``rate_limit_delay`` and the Sunday 01:30–06:00 Asia/Colombo rank-pause window
are honored (R30; a simple asyncio loop replaces valorantsl-new's ``schedule``
dependency).

CLI (``python -m workers.updater``): default scheduler (initial full pass, then
the interval loop), ``--once`` (one full pass; exit 0 iff ``updated > 0``),
``--test PUUID`` (single player), ``--info`` (config dump), ``--name-audit``
(run the task-8 name-audit once and exit with its status).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from datetime import time as dtime
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.db.session import SessionFactory
from app.integrations.henrik.client import HenrikClient
from app.middleware.write_freeze import refuse_writer_start

logger = logging.getLogger(__name__)

COLOMBO_TZ = ZoneInfo("Asia/Colombo")


def _in_rank_pause_window(now: datetime | None = None) -> bool:
    """True during the Sunday 01:30–06:00 Asia/Colombo window when the name audit runs."""
    # DTZ005 suppressed: verbatim valorantsl-new parity — naive local now, then
    # .astimezone(COLOMBO_TZ) is identical to now(COLOMBO_TZ) for the window test.
    local = (now or datetime.now()).astimezone(COLOMBO_TZ)  # noqa: DTZ005
    return local.weekday() == 6 and dtime(1, 30) <= local.time() < dtime(6, 0)


def _parse_last_played(last: str | None) -> datetime | None:
    """ISO string -> tz-aware ``datetime`` for ``last_played_match``; ``None`` stays ``None``."""
    return datetime.fromisoformat(last) if last else None


async def _update_player(
    client: HenrikClient,
    repo: LeaderboardPlayerRepository,
    player,
    *,
    affinity: str,
    platform: str,
) -> None:
    """Fetch one player's MMR + last competitive match and upsert the row."""
    mmr = await client.get_player_mmr(player.puuid, affinity=affinity, platform=platform)
    last = await client.get_last_competitive_match(player.puuid, affinity=affinity, platform=platform)
    await repo.upsert(
        puuid=player.puuid,
        name=mmr["name"],
        tag=mmr["tag"],
        region=affinity,
        elo=mmr["rank_details"]["elo"],
        currenttierpatched=mmr["rank_details"]["currenttierpatched"],
        rank_details=mmr["rank_details"],
        peak_rank=mmr["peak_rank"],
        seasonal_ranks=mmr["seasonal_ranks"],
        last_played_match=_parse_last_played(last),
        update_source="updater_service",
    )


async def update_all_players(
    client: HenrikClient,
    repo: LeaderboardPlayerRepository,
    *,
    affinity: str,
    platform: str,
    rate_limit_delay: float,
) -> dict[str, int]:
    """One full pass over every ``leaderboard_players`` row.

    Returns ``{"total", "updated", "failed"}``. Per-player failures are caught
    and counted as ``failed`` — one bad player never kills the pass. The
    rollback is SCOPED: only a ``SQLAlchemyError`` (raised by the per-player
    upsert, i.e. a genuinely aborted DB write) calls ``await repo.rollback()``
    so the session is reset for the next player; a pure Henrik failure
    (404/429/network — raised BEFORE any DB write for that player) does NOT
    roll back, preserving the earlier players' flushed-but-uncommitted upserts
    so the pass-level commit still persists the prefix. ``rate_limit_delay``
    seconds are slept between players (skipped on the last).
    """
    players = await repo.list_all()
    stats = {"total": len(players), "updated": 0, "failed": 0}
    for i, player in enumerate(players):
        try:
            await _update_player(client, repo, player, affinity=affinity, platform=platform)
            stats["updated"] += 1
        except SQLAlchemyError:
            logger.exception("failed to update player %s (db error)", player.puuid)
            await repo.rollback()
            stats["failed"] += 1
        except Exception:
            logger.exception("failed to update player %s", player.puuid)
            stats["failed"] += 1
        if i < len(players) - 1:
            await asyncio.sleep(rate_limit_delay)
    return stats


async def update_player_by_puuid(
    client: HenrikClient,
    repo: LeaderboardPlayerRepository,
    puuid: str,
    *,
    affinity: str,
    platform: str,
) -> bool:
    """Update a single player by PUUID (``--test``). ``False`` if not registered."""
    player = await repo.get_by_puuid(puuid)
    if player is None:
        logger.warning("player not found in database: %s", puuid)
        return False
    await _update_player(client, repo, player, affinity=affinity, platform=platform)
    return True


def _log_summary(stats: dict[str, int]) -> None:
    logger.info(
        "update pass complete: total=%s updated=%s failed=%s",
        stats["total"],
        stats["updated"],
        stats["failed"],
    )


def _print_info(settings: Settings) -> None:
    print("=" * 60)
    print("Valorant Platform Player Updater")
    print("=" * 60)
    print(f"Henrik base URL: {settings.henrik_base_url}")
    print(f"Affinity/region: {settings.leaderboard_affinity}")
    print(f"Platform: {settings.leaderboard_platform}")
    print(f"Update interval: {settings.updater_interval_minutes} minutes")
    print(f"Rate limit delay: {settings.updater_rate_limit_delay}s between players")
    print(f"Henrik max retries: {settings.henrik_max_retries}")
    print("=" * 60)


async def _cli_once(settings: Settings) -> int:
    """One full pass; exit code 0 iff at least one player was updated."""
    if not refuse_writer_start("valorant-updater", settings):
        return 0
    client = HenrikClient(settings)
    session = SessionFactory()
    try:
        repo = LeaderboardPlayerRepository(session)
        stats = await update_all_players(
            client,
            repo,
            affinity=settings.leaderboard_affinity,
            platform=settings.leaderboard_platform,
            rate_limit_delay=settings.updater_rate_limit_delay,
        )
        await session.commit()
        _log_summary(stats)
        return 0 if stats["updated"] > 0 else 1
    finally:
        await client.aclose()
        await session.close()


async def _cli_test(settings: Settings, puuid: str) -> int:
    """Update a single player by PUUID; exit 0 iff the player was found and updated."""
    if not refuse_writer_start("valorant-updater", settings):
        return 0
    client = HenrikClient(settings)
    session = SessionFactory()
    try:
        repo = LeaderboardPlayerRepository(session)
        ok = await update_player_by_puuid(
            client,
            repo,
            puuid,
            affinity=settings.leaderboard_affinity,
            platform=settings.leaderboard_platform,
        )
        if ok:
            await session.commit()
        return 0 if ok else 1
    finally:
        await client.aclose()
        await session.close()


async def _cli_scheduler(settings: Settings) -> None:
    """Initial full pass, then the interval loop gated on the pause window (R30)."""
    if not refuse_writer_start("valorant-updater", settings):
        return
    client = HenrikClient(settings)
    session = SessionFactory()
    try:
        repo = LeaderboardPlayerRepository(session)
        affinity = settings.leaderboard_affinity
        platform = settings.leaderboard_platform
        delay = settings.updater_rate_limit_delay
        interval = settings.updater_interval_minutes * 60

        logger.info("updater scheduler starting: running initial full pass")
        _log_summary(await update_all_players(client, repo, affinity=affinity, platform=platform, rate_limit_delay=delay))
        await session.commit()

        while True:
            if not _in_rank_pause_window():
                try:
                    _log_summary(await update_all_players(client, repo, affinity=affinity, platform=platform, rate_limit_delay=delay))
                    await session.commit()
                except Exception:
                    logger.exception("scheduler pass failed; continuing to next interval")
                    await repo.rollback()
            else:
                logger.info("rank update paused - inside Sunday name-audit window (01:30-06:00 Asia/Colombo)")
            await asyncio.sleep(interval)
    finally:
        await client.aclose()
        await session.close()


def main() -> None:
    """CLI entry point: ``python -m workers.updater [--once|--test|--info|--name-audit]``."""
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(
        description="Valorant Platform player updater (ports valorantsl-new updater)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python -m workers.updater             # run scheduled updates\n"
            "  python -m workers.updater --once      # run one update pass and exit\n"
            "  python -m workers.updater --test PUUID  # test update for one player\n"
            "  python -m workers.updater --info      # show service configuration and exit"
        ),
    )
    parser.add_argument("--once", action="store_true", help="run one full update pass and exit")
    parser.add_argument("--test", type=str, metavar="PUUID", help="update a single player by PUUID and exit")
    parser.add_argument("--info", action="store_true", help="show service configuration and exit")
    parser.add_argument(
        "--name-audit",
        action="store_true",
        help="run the weekly name audit (task 8) once and exit",
    )
    args = parser.parse_args()

    settings = get_settings()
    if args.info:
        _print_info(settings)
        return
    if args.name_audit:
        from workers.name_audit import run_name_audit

        sys.exit(asyncio.run(run_name_audit()))
    if args.test:
        sys.exit(asyncio.run(_cli_test(settings, args.test)))
    if args.once:
        sys.exit(asyncio.run(_cli_once(settings)))
    asyncio.run(_cli_scheduler(settings))


if __name__ == "__main__":
    main()
