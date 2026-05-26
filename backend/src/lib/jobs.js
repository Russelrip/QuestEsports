const crypto = require("crypto");
const { Prisma } = require("../generated/prisma");
const { env } = require("../config/env");
const { prisma } = require("./prisma");
const { logger } = require("./logger");
const { captureException } = require("./monitoring");
const { processQueuedMailJob, EMAIL_JOB_NAME } = require("./mail/mail-job-definitions");

const JOB_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const JOB_RETRY_BASE_DELAY_MS = 30 * 1000;
const MAX_CLAIM_RETRIES = 3;
const MAX_JOBS_PER_TICK = 10;
const CLAIM_TRANSACTION_MAX_WAIT_MS = 10 * 1000;
const CLAIM_TRANSACTION_TIMEOUT_MS = 15 * 1000;

let workerInterval = null;
let workerRunning = false;

const suggestedJobBackends = [
  {
    name: "Database-backed worker",
    useCase: "Persistent email delivery and low-volume operational jobs",
  },
  {
    name: "BullMQ",
    useCase: "Redis-backed email, media, and webhook jobs at higher scale",
  },
  {
    name: "Cloud queue",
    useCase: "Managed background processing in hosted environments",
  },
];

const summarizeJobError = (error) => {
  if (!error) {
    return "Unknown job failure.";
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 4000);
  }

  return String(error).slice(0, 4000);
};

const computeRetryDelayMs = (attempts) =>
  JOB_RETRY_BASE_DELAY_MS * Math.max(attempts, 1);

const isRetryableClaimError = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2028" || error.code === "P2034");

const enqueueJob = async (name, payload = {}, options = {}) => {
  const maxAttempts = Math.max(
    Number.parseInt(options.maxAttempts, 10) || env.JOB_WORKER_MAX_ATTEMPTS,
    1
  );
  const availableAt =
    options.availableAt instanceof Date ? options.availableAt : new Date();

  const job = await prisma.backgroundJob.create({
    data: {
      id: crypto.randomUUID(),
      name,
      payload,
      status: "queued",
      attempts: 0,
      maxAttempts,
      availableAt,
    },
  });

  logger.info("Background job enqueued", {
    jobId: job.id,
    jobName: name,
    availableAt: job.availableAt,
    maxAttempts: job.maxAttempts,
  });

  return {
    accepted: true,
    jobId: job.id,
    name: job.name,
    availableAt: job.availableAt,
    maxAttempts: job.maxAttempts,
  };
};

const claimNextJob = async () => {
  const now = new Date();
  const staleLockCutoff = new Date(now.getTime() - JOB_LOCK_TIMEOUT_MS);

  for (let attempt = 1; attempt <= MAX_CLAIM_RETRIES; attempt += 1) {
    try {
      const claimedJob = await prisma.$transaction(
        async (tx) => {
          const candidate = await tx.backgroundJob.findFirst({
            where: {
              OR: [
                {
                  status: "queued",
                  availableAt: {
                    lte: now,
                  },
                },
                {
                  status: "processing",
                  lockedAt: {
                    lt: staleLockCutoff,
                  },
                },
              ],
            },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
          });

          if (!candidate) {
            return null;
          }

          const updateResult = await tx.backgroundJob.updateMany({
            where: {
              id: candidate.id,
              status: candidate.status,
              ...(candidate.status === "processing"
                ? { lockedAt: candidate.lockedAt }
                : {}),
            },
            data: {
              status: "processing",
              lockedAt: now,
              attempts: {
                increment: 1,
              },
              lastError: null,
            },
          });

          if (updateResult.count !== 1) {
            return null;
          }

          return tx.backgroundJob.findUnique({
            where: { id: candidate.id },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: CLAIM_TRANSACTION_MAX_WAIT_MS,
          timeout: CLAIM_TRANSACTION_TIMEOUT_MS,
        }
      );

      if (!claimedJob) {
        return null;
      }

      return claimedJob;
    } catch (error) {
      if (isRetryableClaimError(error) && attempt < MAX_CLAIM_RETRIES) {
        continue;
      }

      throw error;
    }
  }

  return null;
};

const markJobSucceeded = async (jobId) => {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      lockedAt: null,
      completedAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  });
};

const markJobFailed = async (job) => {
  const attempts = job.attempts;
  const reachedMaxAttempts = attempts >= job.maxAttempts;
  const now = new Date();

  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: reachedMaxAttempts ? "failed" : "queued",
      lockedAt: null,
      failedAt: reachedMaxAttempts ? now : null,
      availableAt: reachedMaxAttempts
        ? job.availableAt
        : new Date(now.getTime() + computeRetryDelayMs(attempts)),
      lastError: summarizeJobError(job.error),
    },
  });
};

const processJobByName = async (job) => {
  switch (job.name) {
    case EMAIL_JOB_NAME:
      return processQueuedMailJob(job.payload);
    default:
      throw new Error(`Unsupported background job: ${job.name}`);
  }
};

const runJobWorkerTick = async () => {
  let processedCount = 0;

  while (processedCount < MAX_JOBS_PER_TICK) {
    const job = await claimNextJob();
    if (!job) {
      break;
    }

    try {
      await processJobByName(job);
      await markJobSucceeded(job.id);
      logger.info("Background job completed", {
        jobId: job.id,
        jobName: job.name,
        attempts: job.attempts,
      });
    } catch (error) {
      job.error = error;
      await markJobFailed(job);

      logger.error("Background job failed", {
        jobId: job.id,
        jobName: job.name,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error,
      });

      captureException(error, {
        jobId: job.id,
        jobName: job.name,
        attempts: job.attempts,
      });
    }

    processedCount += 1;
  }

  return processedCount;
};

const tickWorkerSafely = async () => {
  if (workerRunning) {
    return;
  }

  workerRunning = true;

  try {
    await runJobWorkerTick();
  } catch (error) {
    logger.error("Background job worker tick failed", { error });
    captureException(error, {
      component: "background-job-worker",
    });
  } finally {
    workerRunning = false;
  }
};

const startJobWorker = () => {
  if (!env.JOB_WORKER_ENABLED || workerInterval) {
    return false;
  }

  workerInterval = setInterval(() => {
    void tickWorkerSafely();
  }, env.JOB_WORKER_POLL_MS);

  if (typeof workerInterval.unref === "function") {
    workerInterval.unref();
  }

  logger.info("Background job worker started", {
    pollIntervalMs: env.JOB_WORKER_POLL_MS,
    enabled: env.JOB_WORKER_ENABLED,
  });

  void tickWorkerSafely();

  return true;
};

const stopJobWorker = async () => {
  if (!workerInterval) {
    return;
  }

  clearInterval(workerInterval);
  workerInterval = null;
  logger.info("Background job worker stopped");
};

module.exports = {
  enqueueJob,
  runJobWorkerTick,
  startJobWorker,
  stopJobWorker,
  suggestedJobBackends,
};
