const crypto = require("crypto");
const { Prisma } = require("../generated/prisma");
const { prisma } = require("../lib/prisma");
const { HttpError } = require("../lib/http-error");
const { logger } = require("../lib/logger");

const MAX_TRANSACTION_RETRIES = 3;
const BUCKET_RETENTION_MULTIPLIER = 4;

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

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.rateLimitBucket.findUnique({
            where: {
              name_key: {
                name,
                key,
              },
            },
          });

          if (!existing) {
            return tx.rateLimitBucket.create({
              data: {
                id: crypto.randomUUID(),
                name,
                key,
                count: 1,
                resetAt: nextResetAt,
              },
            });
          }

          if (existing.resetAt.getTime() <= now.getTime()) {
            return tx.rateLimitBucket.update({
              where: { id: existing.id },
              data: {
                count: 1,
                resetAt: nextResetAt,
              },
            });
          }

          return tx.rateLimitBucket.update({
            where: { id: existing.id },
            data: {
              count: {
                increment: 1,
              },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034") &&
        attempt < MAX_TRANSACTION_RETRIES
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to apply rate limit after retries.");
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
