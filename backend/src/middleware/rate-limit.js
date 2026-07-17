const crypto = require("crypto");
const { Prisma } = require("../generated/prisma");
const { prisma } = require("../lib/prisma");
const { HttpError } = require("../lib/http-error");
const { logger } = require("../lib/logger");

const MAX_OPERATION_RETRIES = 3;
const BUCKET_RETENTION_MULTIPLIER = 4;
const RETRYABLE_OPERATION_ERROR_CODES = new Set(["P2024", "P2028", "P2034", "P2037"]);

const hashRateLimitKey = (value) =>
  crypto.createHash("sha256").update(String(value || "unknown")).digest("hex");

const getClientIp = (req) => {
  const trustProxy = req.app?.get("trust proxy");

  if (trustProxy) {
    return req.ip || req.socket?.remoteAddress || "unknown";
  }

  return req.socket?.remoteAddress || req.ip || "unknown";
};

const pruneExpiredBuckets = async ({ cutoff }) => {
  try {
    await prisma.rateLimitBucket.deleteMany({
      where: {
        resetAt: {
          lt: cutoff,
        },
      },
    });
  } catch (error) {
    logger.warn("Failed to prune expired rate-limit buckets.", { error });
  }
};

const consumeRateLimit = async ({
  name,
  key,
  windowMs,
}) => {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + windowMs);

  for (let attempt = 1; attempt <= MAX_OPERATION_RETRIES; attempt += 1) {
    try {
      const [bucket] = await prisma.$queryRaw`
        INSERT INTO "rate_limit_buckets"
          ("id", "name", "key", "count", "reset_at", "created_at", "updated_at")
        VALUES
          (${crypto.randomUUID()}::uuid, ${name}, ${key}, 1, ${nextResetAt}, ${now}, ${now})
        ON CONFLICT ("name", "key") DO UPDATE SET
          "count" = CASE
            WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN 1
            ELSE "rate_limit_buckets"."count" + 1
          END,
          "reset_at" = CASE
            WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN ${nextResetAt}
            ELSE "rate_limit_buckets"."reset_at"
          END,
          "updated_at" = ${now}
        RETURNING
          "id", "name", "key", "count", "reset_at" AS "resetAt"
      `;

      if (!bucket) {
        throw new Error("The rate-limit bucket could not be updated.");
      }

      return bucket;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        RETRYABLE_OPERATION_ERROR_CODES.has(error.code) &&
        attempt < MAX_OPERATION_RETRIES
      ) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to apply the rate limit after retries.");
};

const createRateLimiter = ({
  name,
  windowMs,
  maxRequests,
  message,
  keyGenerator = getClientIp,
}) => {
  if (!name) {
    throw new Error("Rate limiter name is required.");
  }

  return async (req, res, next) => {
    try {
      const rawKey = keyGenerator(req);
      const key = hashRateLimitKey(rawKey);
      const bucket = await consumeRateLimit({
        name,
        key,
        windowMs,
      });

      const now = Date.now();
      const retryAfterSeconds = Math.max(
        Math.ceil((bucket.resetAt.getTime() - now) / 1000),
        1
      );
      const remaining = Math.max(maxRequests - bucket.count, 0);

      res.setHeader("RateLimit-Limit", String(maxRequests));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

      if (bucket.count > maxRequests) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        next(new HttpError(429, message));
        return;
      }

      if (Math.random() < 0.02) {
        const cutoff = new Date(
          Date.now() - windowMs * BUCKET_RETENTION_MULTIPLIER
        );
        void pruneExpiredBuckets({ cutoff });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  createRateLimiter,
  getClientIp,
};
