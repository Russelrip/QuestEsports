"""Weekly name-audit worker (SDD 2026-08-14 leaderboard standardization, task 8).

Ports ``valorantsl-new/updater/name_audit.py`` onto this repo's shared
``HenrikClient`` (task 3) + ``LeaderboardPlayerRepository`` (task 1). Every
registered player's Riot ID (name/tag) is re-checked against the global
account-by-puuid endpoint (``get_account_by_puuid``; R32 — no affinity/platform
in the path, so a player who has never played competitive still has an account
and is audited), and drift is corrected in place via
``LeaderboardPlayerRepository.update_name_tag`` (R33 — existing rows only,
never an insert). ``name_audit_delay`` seconds are slept between players.

R35: this is a one-shot worker (``python -m workers.name_audit`` runs the
audit once and exits); the weekly Sunday 02:00 cadence is deployment-managed
(cron/supervisor), and ``logging.basicConfig`` (R31) means a standalone run
actually emits INFO output. The updater's ``--name-audit`` flag invokes
``run_name_audit``.
"""

from __future__ import annotations

import asyncio
import errno
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

logger = logging.getLogger(__name__)


def get_settings():
    """Lazily load settings so lock behavior can be tested without app extras."""
    from app.config import get_settings as load_settings

    return load_settings()


# Kept as a patchable compatibility seam for worker admission tests. The real
# client is imported only after admission and lock ownership are established.
HenrikClient = None


class ReleaseLockError(RuntimeError):
    """The release lock could not be opened or used for a non-contention reason."""


def _try_acquire_release_lock(lock_path: Path):
    """Return an open lock file, ``None`` for contention, or raise on real errors."""
    try:
        lock_file = lock_path.open("a+")
    except OSError as exc:
        raise ReleaseLockError(f"cannot open release lock {lock_path}: {exc}") from exc

    try:
        try:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:  # pragma: no cover - production is Linux
            import msvcrt

            lock_file.seek(0)
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError as exc:
        lock_file.close()
        if isinstance(exc, BlockingIOError) or exc.errno == errno.EAGAIN:
            return None
        raise ReleaseLockError(f"cannot lock release lock {lock_path}: {exc}") from exc
    return lock_file


def _release_file_lock(lock_file) -> None:
    try:
        import fcntl

        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except ImportError:  # pragma: no cover - production is Linux
        pass
    finally:
        lock_file.close()


@asynccontextmanager
async def _release_lock(settings):
    """Acquire the deployment lock without requiring a global write freeze.

    The lock is non-blocking so a cutover never waits on a potentially slow
    Henrik audit.  A few visible retries make the weekly timer tolerant of a
    short deployment hold; after the retry budget the run is a successful skip.
    """
    lock_path = Path(settings.release_lock_path)
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ReleaseLockError(f"cannot prepare release lock directory {lock_path.parent}: {exc}") from exc
    lock_file = None
    for attempt in range(settings.name_audit_lock_retries + 1):
        lock_file = _try_acquire_release_lock(lock_path)
        if lock_file is not None:
            logger.info("name audit acquired release lock: %s", lock_path)
            break
        if attempt >= settings.name_audit_lock_retries:
            logger.warning("name audit skipped: release lock held after %s retries", attempt)
            yield None
            return
        logger.warning(
            "name audit waiting: release lock held (retry %s/%s in %ss)",
            attempt + 1,
            settings.name_audit_lock_retries,
            settings.name_audit_lock_retry_seconds,
        )
        await asyncio.sleep(settings.name_audit_lock_retry_seconds)
    if lock_file is None:
        # Keep this invariant explicit even if the acquisition loop is changed:
        # callers must never interpret a missing handle as a held lock.
        yield None
        return
    try:
        yield lock_file
    finally:
        _release_file_lock(lock_file)


async def audit_names(client, repo, *, name_audit_delay: float) -> dict[str, int]:
    """One full name/tag audit pass over every ``leaderboard_players`` row.

    Returns ``{"total", "updated", "skipped", "errors"}``. Per player the fetch,
    compare and ``repo.update_name_tag`` are ALL inside one try (fix round 1):

    - ``HenrikNotFoundError`` (player absent on the API) -> ``skipped``;
    - any other exception — including a failed per-player DB write/commit ->
      ``await repo.rollback()`` then ``errors`` (logged, loop continues; the
      rollback resets the session after a failed commit so the remaining
      players are not poisoned);
    - name/tag unchanged -> ``skipped``;
    - name/tag changed -> ``repo.update_name_tag`` (commits per player, so
      earlier corrections survive a later failure); ``True`` -> ``updated``,
      ``False`` (row vanished mid-run) -> ``errors``.

    ``name_audit_delay`` seconds are slept between players, OUTSIDE the per-
    player try (skipped after the last). HenrikClient already owns 429/Retry-
    After handling — this worker never re-implements retries.
    """
    players = await repo.list_all()
    # A rollback expires every ORM instance held by the AsyncSession. Snapshot
    # the scalar fields up front so one failed player cannot make the next
    # iteration trigger an implicit lazy load outside SQLAlchemy's greenlet.
    audit_rows = [(player.puuid, player.name, player.tag) for player in players]
    stats = {"total": len(audit_rows), "updated": 0, "skipped": 0, "errors": 0}
    for i, (puuid, current_name, current_tag) in enumerate(audit_rows):
        try:
            from app.integrations.henrik.exceptions import HenrikNotFoundError

            account = await client.get_account_by_puuid(puuid)
            if account.name == current_name and account.tag == current_tag:
                logger.debug("name audit: %s#%s unchanged", current_name, current_tag)
                stats["skipped"] += 1
            elif await repo.update_name_tag(puuid, account.name, account.tag):
                logger.info(
                    "name audit: updated %s#%s -> %s#%s",
                    current_name,
                    current_tag,
                    account.name,
                    account.tag,
                )
                stats["updated"] += 1
            else:
                logger.warning("name audit: row vanished for %s, not updated", puuid)
                stats["errors"] += 1
        except HenrikNotFoundError:
            logger.debug("name audit: player %s not found on API, skipping", puuid)
            stats["skipped"] += 1
        except Exception as exc:  # noqa: BLE001 - one bad player must not abort the audit
            logger.error("name audit: failed for player %s: %s", puuid, exc)
            await repo.rollback()
            stats["errors"] += 1
        if i < len(audit_rows) - 1:
            await asyncio.sleep(name_audit_delay)
    return stats


def _log_summary(stats: dict[str, int]) -> None:
    logger.info(
        "name audit complete: total=%s updated=%s skipped=%s errors=%s",
        stats["total"],
        stats["updated"],
        stats["skipped"],
        stats["errors"],
    )


async def run_name_audit() -> int:
    """One-shot audit run; returns the process exit code (0 success, 1 error).

    Builds the shared ``HenrikClient`` + ``SessionFactory`` repo, runs
    ``audit_names``, commits the session, and logs the summary.
    """
    from app.middleware.write_freeze import refuse_writer_start

    settings = get_settings()
    if not refuse_writer_start("valorant-name-audit", settings):
        return 0
    try:
        async with _release_lock(settings) as lock_file:
            if lock_file is None:
                return 0
            return await _run_name_audit_with_lock(settings)
    except ReleaseLockError as exc:
        logger.error("name audit release lock failure: %s", exc)
        return 1


async def _run_name_audit_with_lock(settings) -> int:
    """Run the audit after writer admission and lock acquisition."""
    from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
    from app.db.session import SessionFactory

    client_factory = HenrikClient
    if client_factory is None:
        from app.integrations.henrik.client import HenrikClient as client_factory

    client = client_factory(settings)
    session = SessionFactory()
    try:
        repo = LeaderboardPlayerRepository(session)
        stats = await audit_names(client, repo, name_audit_delay=settings.name_audit_delay)
        await session.commit()
        _log_summary(stats)
        return 1 if stats["errors"] > 0 else 0
    except Exception as exc:  # noqa: BLE001 - top-level worker boundary
        logger.error("name audit failed: %s", exc)
        return 1
    finally:
        await client.aclose()
        await session.close()


def main() -> None:
    """CLI entry point: ``python -m workers.name_audit`` — audit once and exit."""
    logging.basicConfig(level=logging.INFO)
    sys.exit(asyncio.run(run_name_audit()))


if __name__ == "__main__":
    main()
