const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const jobsModulePath = path.join(__dirname, "../src/modules/players/ranking.jobs.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const libJobsPath = path.join(__dirname, "../src/lib/jobs.js");
const syncPath = path.join(__dirname, "../src/modules/players/ranking-sync.service.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const load = ({
  enabled = true,
  minutes = 15,
  lastSyncedAt = null,
  enqueue = async () => ({ duplicate: false }),
  sync = async () => ({ scanned: 0 }),
  aggregate,
} = {}) => {
  const calls = { enqueued: [], synced: 0 };
  const prisma = {
    playerRanking: {
      aggregate: aggregate ?? (async () => ({ _max: { syncedAt: lastSyncedAt } })),
    },
  };
  return {
    calls,
    ...loadModuleWithMocks(jobsModulePath, {
      [prismaPath]: { prisma },
      [envPath]: {
        env: {
          PLAYER_RANKING_SYNC_ENABLED: enabled,
          PLAYER_RANKING_SYNC_MINUTES: minutes,
        },
      },
      [libJobsPath]: {
        RANKING_SYNC_JOB_NAME: "players.ranking-sync",
        enqueueJob: async (name, payload, options) => {
          calls.enqueued.push({ name, payload, options });
          return enqueue(name, payload, options);
        },
      },
      [syncPath]: {
        syncValorantRankings: async () => {
          calls.synced += 1;
          return sync();
        },
      },
      [loggerPath]: { logger: { info() {}, warn() {}, error() {} } },
    }),
  };
};

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000);

test("a first run with no cached ranking is due", async () => {
  const { module: jobs, restore } = load({ lastSyncedAt: null });
  try {
    // Nothing has ever synced, which is exactly the state that left every
    // profile rankless.
    assert.equal(await jobs.isSyncDue(new Date()), true);
  } finally {
    restore();
  }
});

test("a sync inside the interval is not due", async () => {
  const { module: jobs, restore } = load({ lastSyncedAt: minutesAgo(5), minutes: 15 });
  try {
    assert.equal(await jobs.isSyncDue(new Date()), false);
  } finally {
    restore();
  }
});

test("a sync older than the interval is due", async () => {
  const { module: jobs, restore } = load({ lastSyncedAt: minutesAgo(16), minutes: 15 });
  try {
    assert.equal(await jobs.isSyncDue(new Date()), true);
  } finally {
    restore();
  }
});

test("due-ness comes from the cache, so a restart does not trigger a fresh sync", async () => {
  const { module: jobs, calls, restore } = load({ lastSyncedAt: minutesAgo(2) });
  try {
    // Three boots in quick succession must not mean three walks of the board.
    await jobs.runRankingSchedulerTick();
    await jobs.runRankingSchedulerTick();
    await jobs.runRankingSchedulerTick();
    assert.equal(calls.enqueued.length, 0);
  } finally {
    restore();
  }
});

test("a due tick enqueues exactly one sync, keyed so a second instance cannot double it", async () => {
  const { module: jobs, calls, restore } = load({ lastSyncedAt: minutesAgo(30) });
  try {
    const queued = await jobs.runRankingSchedulerTick();
    assert.equal(queued, true);
    assert.equal(calls.enqueued.length, 1);
    const [job] = calls.enqueued;
    assert.equal(job.name, "players.ranking-sync");
    // The board is one global resource; two concurrent walks would spend rate
    // limit to compute the same answer.
    assert.equal(job.options.dedupeKey, "players.ranking-sync");
    // No payload: a position is a property of the board, not of a player.
    assert.deepEqual(job.payload, {});
  } finally {
    restore();
  }
});

test("a duplicate enqueue is reported as not queued rather than as success", async () => {
  const { module: jobs, restore } = load({
    lastSyncedAt: minutesAgo(30),
    enqueue: async () => ({ duplicate: true }),
  });
  try {
    assert.equal(await jobs.runRankingSchedulerTick(), false);
  } finally {
    restore();
  }
});

test("the scheduler does nothing at all when it is disabled", async () => {
  const { module: jobs, calls, restore } = load({ enabled: false, lastSyncedAt: minutesAgo(90) });
  try {
    assert.equal(await jobs.runRankingSchedulerTick(), false);
    assert.equal(calls.enqueued.length, 0);
    assert.equal(jobs.startRankingScheduler(), false);
  } finally {
    restore();
  }
});

test("a failing tick is swallowed, because a rank is decoration on a profile", async () => {
  const { module: jobs, restore } = load({
    aggregate: async () => { throw new Error("database unavailable"); },
  });
  try {
    // The previous cache stays exactly as it was; nothing upstream of this
    // should ever fail because a ranking could not be refreshed.
    assert.equal(await jobs.runRankingSchedulerTick(), false);
  } finally {
    restore();
  }
});

test("the job handler runs the whole-board sync and takes no payload", async () => {
  const { module: jobs, calls, restore } = load();
  try {
    await jobs.processRankingSyncJob();
    assert.equal(calls.synced, 1);
  } finally {
    restore();
  }
});
