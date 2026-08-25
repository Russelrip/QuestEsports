const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { prisma } = require("../../lib/prisma");
const { enqueueJob, RANKING_SYNC_JOB_NAME } = require("../../lib/jobs");
const { syncValorantRankings } = require("./ranking-sync.service");

// The scheduler for `ranking-sync.service.js`. That service has existed and been
// tested since the profile shipped, but nothing ever ran it, so
// `player_rankings` stayed empty and every profile rendered without a rank.
//
// Cadence follows the upstream, not our preference: the leaderboard it reads
// refreshes every 15-30 minutes, so syncing faster only spends rate limit to
// re-read numbers that have not moved.

let schedulerInterval = null;
let schedulerRunning = false;

// How often the scheduler wakes to CHECK whether a sync is due. Being due is
// decided by the data, not by this timer.
const SCHEDULER_TICK_MS = 60 * 1000;

const processRankingSyncJob = async () => syncValorantRankings();

// The next time a sync could possibly be due, remembered in process so the
// minute tick does not query for an answer it already knows. Cleared whenever
// a sync is enqueued, because the cache row is about to move.
let nextPossibleDueAt = null;

// Due-ness is read from `player_rankings.syncedAt`, not from an in-process
// timer, for two reasons: a restart must not trigger a fresh sync every time
// the process boots, and two instances must not both decide it is time. The
// dedupe key closes the remaining gap between the check and the enqueue.
const isSyncDue = async (now) => {
  const latest = await prisma.playerRanking.aggregate({ _max: { syncedAt: true } });
  const lastSyncedAt = latest._max.syncedAt;
  if (!lastSyncedAt) {
    nextPossibleDueAt = null;
    return true;
  }
  const dueAt = new Date(lastSyncedAt.getTime() + env.PLAYER_RANKING_SYNC_MINUTES * 60 * 1000);
  // Remember when to look again. Another instance may sync sooner, which only
  // means this one asks once more and finds it already done -- never that a
  // sync is missed.
  nextPossibleDueAt = dueAt;
  return now >= dueAt;
};

const runRankingSchedulerTick = async ({ now = new Date() } = {}) => {
  if (schedulerRunning || !env.PLAYER_RANKING_SYNC_ENABLED) return false;
  schedulerRunning = true;
  try {
    // Cheap guard first. The tick fires every minute but a sync is due every
    // fifteen, so querying on every tick would spend fourteen database round
    // trips to re-learn a time this process already knew -- which is exactly
    // the kind of idle polling that put this database over its egress quota.
    if (nextPossibleDueAt && now < nextPossibleDueAt) return false;
    if (!(await isSyncDue(now))) return false;
    // One queued sync at a time. The board is a single global resource; a
    // second concurrent walk of it would spend rate limit to compute the same
    // answer, and could interleave two partial reads.
    const queued = await enqueueJob(
      RANKING_SYNC_JOB_NAME,
      {},
      { maxAttempts: 2, dedupeKey: RANKING_SYNC_JOB_NAME },
    );
    // The cached row is about to move, so the remembered time is now stale.
    nextPossibleDueAt = null;
    return !queued.duplicate;
  } catch (error) {
    // A ranking is decoration on a profile and must never be why anything
    // fails. The previous cache stays exactly as it was.
    logger.error("Ranking scheduler tick failed", { error });
    return false;
  } finally {
    schedulerRunning = false;
  }
};

const startRankingScheduler = () => {
  if (!env.PLAYER_RANKING_SYNC_ENABLED || schedulerInterval) return false;
  void runRankingSchedulerTick();
  schedulerInterval = setInterval(() => void runRankingSchedulerTick(), SCHEDULER_TICK_MS);
  schedulerInterval.unref?.();
  logger.info("Ranking scheduler started", {
    intervalMinutes: env.PLAYER_RANKING_SYNC_MINUTES,
  });
  return true;
};

const stopRankingScheduler = async () => {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = null;
  while (schedulerRunning) await new Promise((resolve) => setTimeout(resolve, 25));
};

// Exposed so a test can prove the guard is reset rather than leaking between
// cases; nothing in production calls it.
const __resetDueCache = () => { nextPossibleDueAt = null; };

module.exports = {
  RANKING_SYNC_JOB_NAME,
  SCHEDULER_TICK_MS,
  isSyncDue,
  __resetDueCache,
  processRankingSyncJob,
  runRankingSchedulerTick,
  startRankingScheduler,
  stopRankingScheduler,
};
