const crypto = require("crypto");
const { Prisma } = require("../generated/prisma");
const { env } = require("../config/env");
const { prisma } = require("./prisma");
const { logger, redact } = require("./logger");
const { captureException } = require("./monitoring");
const { encryptSecret } = require("./secret-box");
const { processQueuedMailJob, EMAIL_JOB_NAME } = require("./mail/mail-job-definitions");
const {
  FILE_CLEANUP_JOB_NAME,
  TEAM_LOGO_CLEANUP_JOB_NAME,
  processFileCleanupJob,
  processTeamLogoCleanupJob,
} = require("./upload-cleanup-job");

const JOB_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const JOB_RETRY_BASE_DELAY_MS = 30 * 1000;
const MAX_CLAIM_RETRIES = 3;
const MAX_JOBS_PER_TICK = 10;
const CLAIM_TRANSACTION_MAX_WAIT_MS = 10 * 1000;
const CLAIM_TRANSACTION_TIMEOUT_MS = 15 * 1000;

let workerInterval = null;
let workerRunning = false;
let activeWorkerTick = null;
let workerStopping = false;

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
    const sanitizedError = redact(error);
    return `${sanitizedError.name}: ${sanitizedError.message}`.slice(0, 4000);
  }

  return String(redact(String(error))).slice(0, 4000);
};

const computeRetryDelayMs = (attempts) =>
  JOB_RETRY_BASE_DELAY_MS * Math.max(attempts, 1);

const isRetryableClaimError = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2028" || error.code === "P2034");

const protectJobPayload = (payload) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Object.prototype.hasOwnProperty.call(payload, "rawToken")
  ) {
    return payload;
  }

  const { rawToken, ...safePayload } = payload;

  return {
    ...safePayload,
    tokenCiphertext: encryptSecret(rawToken),
  };
};

const scrubJobPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const safePayload = { ...payload };
  delete safePayload.rawToken;
  delete safePayload.tokenCiphertext;
  return safePayload;
};

const buildQueuedJobData = (name, payload = {}, options = {}) => {
  const maxAttempts = Math.max(
    Number.parseInt(options.maxAttempts, 10) || env.JOB_WORKER_MAX_ATTEMPTS,
    1
  );
  const availableAt =
    options.availableAt instanceof Date ? options.availableAt : new Date();

  return {
    id: crypto.randomUUID(),
    name,
    payload: protectJobPayload(payload),
    status: "queued",
    attempts: 0,
    maxAttempts,
    availableAt,
  };
};

const enqueueJob = async (name, payload = {}, options = {}) => {
  const data = buildQueuedJobData(name, payload, options);
  const job = await prisma.backgroundJob.create({
    data,
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

const enqueueJobs = async (requests = []) => {
  if (!Array.isArray(requests) || requests.length === 0) return [];

  const jobs = requests.map(({ name, payload = {}, options = {} }) =>
    buildQueuedJobData(name, payload, options)
  );
  await prisma.backgroundJob.createMany({ data: jobs });

  logger.info("Background jobs enqueued", {
    count: jobs.length,
    jobNames: [...new Set(jobs.map((job) => job.name))],
  });

  return jobs.map((job) => ({
    accepted: true,
    jobId: job.id,
    name: job.name,
    availableAt: job.availableAt,
    maxAttempts: job.maxAttempts,
  }));
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
              payload: protectJobPayload(candidate.payload),
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

const markJobSucceeded = async (job) => {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      payload: scrubJobPayload(job.payload),
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
      ...(reachedMaxAttempts
        ? { payload: scrubJobPayload(job.payload) }
        : {}),
    },
  });
};

const processJobByName = async (job) => {
  switch (job.name) {
    case EMAIL_JOB_NAME:
      return processQueuedMailJob(job.payload);
    case FILE_CLEANUP_JOB_NAME:
      return processFileCleanupJob(job.payload);
    case TEAM_LOGO_CLEANUP_JOB_NAME:
      return processTeamLogoCleanupJob(job.payload, prisma);
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
      const processed = await processJobByName(job);
      if (processed === false) {
        throw new Error(`Background job ${job.name} did not complete.`);
      }
      await markJobSucceeded(job);
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
  if (workerRunning || workerStopping) {
    return;
  }

  workerRunning = true;
  activeWorkerTick = (async () => {
    try {
      await runJobWorkerTick();
    } catch (error) {
      logger.error("Background job worker tick failed", { error });
      captureException(error, {
        component: "background-job-worker",
      });
    } finally {
      workerRunning = false;
      activeWorkerTick = null;
    }
  })();
  await activeWorkerTick;
};

const startJobWorker = () => {
  if (!env.JOB_WORKER_ENABLED || workerInterval) {
    return false;
  }

  workerStopping = false;

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

const stopJobWorker = async ({ timeoutMs = 15000 } = {}) => {
  workerStopping = true;
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  if (activeWorkerTick) {
    let timeout;
    await Promise.race([
      activeWorkerTick,
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          logger.warn("Background job worker drain timed out", { timeoutMs });
          resolve();
        }, timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
  logger.info("Background job worker stopped");
};

module.exports = {
  enqueueJob,
  enqueueJobs,
  runJobWorkerTick,
  startJobWorker,
  stopJobWorker,
  suggestedJobBackends,
};
