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

const createJobsPrismaMock = () => {
  const jobs = [];

  const cloneJob = (job) => ({
    ...job,
    payload: JSON.parse(JSON.stringify(job.payload)),
  });

  const tx = {
    backgroundJob: {
      create: async ({ data }) => {
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
      findFirst: async ({ where, orderBy }) => {
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

        if (data.attempts?.increment) {
          job.attempts += data.attempts.increment;
        }

        job.updatedAt = new Date();
        return { count: 1 };
      },
      findUnique: async ({ where }) => {
        const job = jobs.find((entry) => entry.id === where.id);
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
  };
};

test("enqueueJob persists a queued background job", async () => {
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
      },
    },
    [loggerPath]: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    [monitoringPath]: { captureException: () => {} },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => true,
    },
  });

  try {
    const result = await jobsModule.enqueueJob("email.send", { type: "verification" });

    assert.equal(result.accepted, true);
    assert.equal(prismaMock.jobs.length, 1);
    assert.equal(prismaMock.jobs[0].status, "queued");
    assert.equal(prismaMock.jobs[0].attempts, 0);
  } finally {
    restore();
  }
});

test("runJobWorkerTick processes queued jobs and marks them succeeded", async () => {
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
    [loggerPath]: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
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
    const processedCount = await jobsModule.runJobWorkerTick();

    assert.equal(processedCount, 1);
    assert.equal(processedPayloads.length, 1);
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
    [loggerPath]: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
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
    [loggerPath]: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    [monitoringPath]: { captureException: (error) => capturedExceptions.push(error) },
    [mailDefinitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      processQueuedMailJob: async () => {
        throw new Error("SMTP down");
      },
    },
  });

  try {
    await jobsModule.enqueueJob(
      "email.send",
      { type: "verification", email: "a@example.com" },
      { maxAttempts: 2 }
    );

    const firstProcessedCount = await jobsModule.runJobWorkerTick();
    assert.equal(firstProcessedCount, 1);
    assert.equal(prismaMock.jobs[0].status, "queued");
    assert.equal(prismaMock.jobs[0].attempts, 1);
    assert.match(prismaMock.jobs[0].lastError, /SMTP down/);

    prismaMock.jobs[0].availableAt = new Date(Date.now() - 1000);

    const secondProcessedCount = await jobsModule.runJobWorkerTick();
    assert.equal(secondProcessedCount, 1);
    assert.equal(prismaMock.jobs[0].status, "failed");
    assert.equal(prismaMock.jobs[0].attempts, 2);
    assert.ok(prismaMock.jobs[0].failedAt instanceof Date);
    assert.equal(capturedExceptions.length, 2);
  } finally {
    restore();
  }
});
