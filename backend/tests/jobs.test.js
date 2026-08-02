const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const jobsPath = path.join(__dirname, "../src/lib/jobs.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const generatedPrismaPath = path.join(__dirname, "../src/generated/prisma/index.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const monitoringPath = path.join(__dirname, "../src/lib/monitoring.js");
const mailDefinitionsPath = path.join(
  __dirname,
  "../src/lib/mail/mail-job-definitions.js"
);
const loggerMock = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  redact: (value) => {
    const redactTokens = (text) =>
      String(text).replace(/([?&]token=)[^&#\s]*/gi, "$1[REDACTED]");

    return value instanceof Error
      ? {
          name: value.name,
          message: redactTokens(value.message),
        }
      : redactTokens(value);
  },
};

const createJobsPrismaMock = () => {
  const jobs = [];
  let createManyCalls = 0;

  const cloneJob = (job) => ({
    ...job,
    payload: JSON.parse(JSON.stringify(job.payload)),
  });

  const tx = {
    backgroundJob: {
      create: async ({ data }) => {
        if (data.dedupeKey && jobs.some((entry) => entry.dedupeKey === data.dedupeKey)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const job = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: data.completedAt || null,
          failedAt: data.failedAt || null,
          lockedAt: data.lockedAt || null,
          lastError: data.lastError || null,
        };
        jobs.push(job);
        return cloneJob(job);
      },
      createMany: async ({ data }) => {
        createManyCalls += 1;
        for (const entry of data) {
          await tx.backgroundJob.create({ data: entry });
        }
        return { count: data.length };
      },
      findFirst: async ({ where, orderBy: _orderBy }) => {
        const now = where.OR[0]?.availableAt?.lte;
        const staleCutoff = where.OR[1]?.lockedAt?.lt;
        const filtered = jobs.filter((job) => {
          if (job.status === "queued" && job.availableAt <= now) {
            return true;
          }

          if (
            job.status === "processing" &&
            job.lockedAt &&
            job.lockedAt < staleCutoff
          ) {
            return true;
          }

          return false;
        });

        filtered.sort((left, right) => {
          if (left.availableAt.getTime() !== right.availableAt.getTime()) {
            return left.availableAt.getTime() - right.availableAt.getTime();
          }

          return left.createdAt.getTime() - right.createdAt.getTime();
        });

        return filtered[0] ? cloneJob(filtered[0]) : null;
      },
      updateMany: async ({ where, data }) => {
        const job = jobs.find((entry) => entry.id === where.id);
        if (!job) {
          return { count: 0 };
        }

        if (job.status !== where.status) {
          return { count: 0 };
        }

        if (Object.prototype.hasOwnProperty.call(where, "lockedAt")) {
          if (String(job.lockedAt) !== String(where.lockedAt)) {
            return { count: 0 };
          }
        }

        if (data.status) {
          job.status = data.status;
        }

        if (Object.prototype.hasOwnProperty.call(data, "lockedAt")) {
          job.lockedAt = data.lockedAt;
        }

        if (Object.prototype.hasOwnProperty.call(data, "lastError")) {
          job.lastError = data.lastError;
        }

        if (Object.prototype.hasOwnProperty.call(data, "payload")) {
          job.payload = JSON.parse(JSON.stringify(data.payload));
        }

        if (data.attempts?.increment) {
          job.attempts += data.attempts.increment;
        }

        job.updatedAt = new Date();
        return { count: 1 };
      },
      findUnique: async ({ where }) => {
        const job = jobs.find((entry) => where.id ? entry.id === where.id : entry.dedupeKey === where.dedupeKey);
        return job ? cloneJob(job) : null;
      },
      update: async ({ where, data }) => {
        const job = jobs.find((entry) => entry.id === where.id);
        if (!job) {
          throw new Error("Job not found.");
        }

        Object.assign(job, data);
        job.updatedAt = new Date();
        return cloneJob(job);
      },
    },
  };

  return {
    prisma: {
      backgroundJob: tx.backgroundJob,
      $transaction: async (callback) =>
        callback(tx),
    },
    jobs,
    getCreateManyCalls: () => createManyCalls,
  };
};

test("enqueueJob persists a queued background job without raw sensitive tokens", async () => {
  const prismaMock = createJobsPrismaMock();
  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [envPath]: {
      env: {
        JOB_WORKER_ENABLED: true,
        JOB_WORKER_POLL_MS: 5000,
        JOB_WORKER_MAX_ATTEMPTS: 5,
        AUTH_ENCRYPTION_KEY: "jobs-test-encryption-key",
      },
    },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => true,
    },
  });

  try {
    const rawToken = "raw-verification-token";
    const result = await jobsModule.enqueueJob("email.send", {
      type: "verification",
      rawToken,
    });

    assert.equal(result.accepted, true);
    assert.equal(prismaMock.jobs.length, 1);
    assert.equal(prismaMock.jobs[0].status, "queued");
    assert.equal(prismaMock.jobs[0].attempts, 0);
    assert.equal(prismaMock.jobs[0].payload.rawToken, undefined);
    assert.ok(prismaMock.jobs[0].payload.tokenCiphertext);
    assert.doesNotMatch(
      JSON.stringify(prismaMock.jobs[0].payload),
      new RegExp(rawToken)
    );
  } finally {
    restore();
  }
});

test("enqueueJob coalesces active jobs with the same deduplication key", async () => {
  const prismaMock = createJobsPrismaMock();
  const mocks = {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: { Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" }, PrismaClientKnownRequestError: class extends Error {} } },
    [envPath]: { env: { JOB_WORKER_ENABLED: true, JOB_WORKER_POLL_MS: 5000, JOB_WORKER_MAX_ATTEMPTS: 5, AUTH_ENCRYPTION_KEY: "jobs-test-encryption-key" } },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: { EMAIL_JOB_NAME: "email.send", processQueuedMailJob: async () => true },
  };
  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, mocks);
  try {
    const first = await jobsModule.enqueueJob("challonge.sync", { integrationId: "one" }, { dedupeKey: "challonge.sync:one" });
    const second = await jobsModule.enqueueJob("challonge.sync", { integrationId: "one" }, { dedupeKey: "challonge.sync:one" });
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.jobId, first.jobId);
    assert.equal(prismaMock.jobs.length, 1);
  } finally { restore(); }
});

test("enqueueJobs persists invitation jobs in one batch without raw tokens", async () => {
  const prismaMock = createJobsPrismaMock();
  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [envPath]: {
      env: {
        JOB_WORKER_ENABLED: true,
        JOB_WORKER_POLL_MS: 5000,
        JOB_WORKER_MAX_ATTEMPTS: 5,
        AUTH_ENCRYPTION_KEY: "jobs-test-encryption-key",
      },
    },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => true,
    },
  });

  try {
    const results = await jobsModule.enqueueJobs([
      { name: "email.send", payload: { type: "teamInvite", rawToken: "token-one" } },
      { name: "email.send", payload: { type: "teamInvite", rawToken: "token-two" } },
    ]);

    assert.equal(results.length, 2);
    assert.equal(prismaMock.getCreateManyCalls(), 1);
    assert.equal(prismaMock.jobs.length, 2);
    assert.ok(prismaMock.jobs.every((job) => !job.payload.rawToken));
    assert.ok(prismaMock.jobs.every((job) => job.payload.tokenCiphertext));
  } finally {
    restore();
  }
});

test("runJobWorkerTick protects legacy raw tokens before processing queued jobs", async () => {
  const prismaMock = createJobsPrismaMock();
  const processedPayloads = [];
  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [envPath]: {
      env: {
        JOB_WORKER_ENABLED: true,
        JOB_WORKER_POLL_MS: 5000,
        JOB_WORKER_MAX_ATTEMPTS: 5,
      },
    },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async (payload) => {
        processedPayloads.push(payload);
        return true;
      },
    },
  });

  try {
    await jobsModule.enqueueJob("email.send", { type: "verification", email: "a@example.com" });
    prismaMock.jobs[0].payload.rawToken = "legacy-raw-token";
    const processedCount = await jobsModule.runJobWorkerTick();

    assert.equal(processedCount, 1);
    assert.equal(processedPayloads.length, 1);
    assert.equal(processedPayloads[0].rawToken, undefined);
    assert.ok(processedPayloads[0].tokenCiphertext);
    assert.equal(prismaMock.jobs[0].payload.rawToken, undefined);
    assert.equal(prismaMock.jobs[0].payload.tokenCiphertext, undefined);
    assert.equal(prismaMock.jobs[0].status, "succeeded");
    assert.ok(prismaMock.jobs[0].completedAt instanceof Date);
  } finally {
    restore();
  }
});

test("runJobWorkerTick retries transient job claim transaction timeouts", async () => {
  class PrismaClientKnownRequestError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const prismaMock = createJobsPrismaMock();
  const baseTransaction = prismaMock.prisma.$transaction;
  let transactionCalls = 0;
  let processedCount = 0;

  prismaMock.prisma.$transaction = async (callback, options) => {
    transactionCalls += 1;

    assert.equal(options.isolationLevel, "Serializable");
    assert.equal(options.maxWait, 10000);
    assert.equal(options.timeout, 15000);

    if (transactionCalls < 3) {
      throw new PrismaClientKnownRequestError(
        "Unable to start a transaction in the given time.",
        "P2028"
      );
    }

    return baseTransaction(callback, options);
  };

  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError,
      },
    },
    [envPath]: {
      env: {
        JOB_WORKER_ENABLED: true,
        JOB_WORKER_POLL_MS: 5000,
        JOB_WORKER_MAX_ATTEMPTS: 5,
      },
    },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => {
        processedCount += 1;
        return true;
      },
    },
  });

  try {
    await jobsModule.enqueueJob("email.send", { type: "verification" });
    const tickProcessedCount = await jobsModule.runJobWorkerTick();

    assert.equal(tickProcessedCount, 1);
    assert.equal(processedCount, 1);
    assert.equal(transactionCalls, 4);
    assert.equal(prismaMock.jobs[0].status, "succeeded");
  } finally {
    restore();
  }
});

test("runJobWorkerTick retries failed jobs until the max attempt threshold", async () => {
  const prismaMock = createJobsPrismaMock();
  const capturedExceptions = [];
  const { module: jobsModule, restore } = loadModuleWithMocks(jobsPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: { Serializable: "Serializable" },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [envPath]: {
      env: {
        JOB_WORKER_ENABLED: true,
        JOB_WORKER_POLL_MS: 5000,
        JOB_WORKER_MAX_ATTEMPTS: 2,
      },
    },
    [loggerPath]: loggerMock,
    [monitoringPath]: { captureException: (error) => capturedExceptions.push(error) },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => {
        throw new Error("SMTP down for /verify-email?token=raw-verification-token");
      },
    },
  });

  try {
    await jobsModule.enqueueJob(
      "email.send",
      {
        type: "verification",
        email: "a@example.com",
        rawToken: "raw-verification-token",
      },
      { maxAttempts: 2 }
    );

    const firstProcessedCount = await jobsModule.runJobWorkerTick();
    assert.equal(firstProcessedCount, 1);
    assert.equal(prismaMock.jobs[0].status, "queued");
    assert.equal(prismaMock.jobs[0].attempts, 1);
    assert.match(prismaMock.jobs[0].lastError, /SMTP down/);
    assert.doesNotMatch(prismaMock.jobs[0].lastError, /raw-verification-token/);
    assert.ok(prismaMock.jobs[0].payload.tokenCiphertext);

    prismaMock.jobs[0].availableAt = new Date(Date.now() - 1000);

    const secondProcessedCount = await jobsModule.runJobWorkerTick();
    assert.equal(secondProcessedCount, 1);
    assert.equal(prismaMock.jobs[0].status, "failed");
    assert.equal(prismaMock.jobs[0].attempts, 2);
    assert.ok(prismaMock.jobs[0].failedAt instanceof Date);
    assert.equal(prismaMock.jobs[0].payload.tokenCiphertext, undefined);
    assert.equal(capturedExceptions.length, 2);
  } finally {
    restore();
  }
});
