const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { HttpError } = require("../src/lib/http-error");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const generatedPrismaPath = path.join(__dirname, "../src/generated/prisma/index.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");

const createPrismaMock = () => {
  const buckets = new Map();

  const getCompositeKey = (name, key) => `${name}:${key}`;

  const tx = {
    rateLimitBucket: {
      findUnique: async ({ where }) =>
        buckets.get(getCompositeKey(where.name_key.name, where.name_key.key)) || null,
      create: async ({ data }) => {
        const record = {
          ...data,
          createdAt: data.createdAt || new Date(),
          updatedAt: data.updatedAt || new Date(),
        };
        buckets.set(getCompositeKey(data.name, data.key), record);
        return record;
      },
      update: async ({ where, data }) => {
        const existing = Array.from(buckets.values()).find((bucket) => bucket.id === where.id);
        if (!existing) {
          throw new Error("Missing rate-limit bucket.");
        }

        const nextRecord = {
          ...existing,
          ...(data.resetAt ? { resetAt: data.resetAt } : {}),
          ...(typeof data.count === "number" ? { count: data.count } : {}),
          ...(data.count && data.count.increment
            ? { count: existing.count + data.count.increment }
            : {}),
          updatedAt: new Date(),
        };

        buckets.set(getCompositeKey(nextRecord.name, nextRecord.key), nextRecord);
        return nextRecord;
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [key, bucket] of buckets.entries()) {
          if (bucket.resetAt < where.resetAt.lt) {
            buckets.delete(key);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return {
    prisma: {
      rateLimitBucket: tx.rateLimitBucket,
      $transaction: async (callback) => callback(tx),
    },
    buckets,
  };
};

const createReqResNext = (ip = "203.0.113.42") => {
  const headers = new Map();
  const req = {
    ip,
    socket: { remoteAddress: ip },
    app: {
      get: () => false,
    },
  };
  const res = {
    setHeader: (name, value) => headers.set(name, value),
    getHeader: (name) => headers.get(name),
  };

  return {
    req,
    res,
    headers,
    nextError: null,
    next: (error) => {
      req._nextError = error || null;
    },
  };
};

test("createRateLimiter persists hashed keys and blocks after the configured threshold", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadModuleWithMocks(rateLimitPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: {
          Serializable: "Serializable",
        },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [loggerModulePath]: {
      logger: {
        warn: () => {},
        info: () => {},
        error: () => {},
      },
    },
  });

  try {
    const middleware = rateLimit.createRateLimiter({
      name: "auth-login",
      windowMs: 60_000,
      maxRequests: 2,
      message: "Too many login attempts.",
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { req, res, next } = createReqResNext();
      await middleware(req, res, next);

      if (attempt < 2) {
        assert.equal(req._nextError, null);
        assert.equal(res.getHeader("RateLimit-Limit"), "2");
      } else {
        assert.ok(req._nextError instanceof HttpError);
        assert.equal(req._nextError.statusCode, 429);
        assert.equal(req._nextError.message, "Too many login attempts.");
        assert.ok(Number(res.getHeader("Retry-After")) >= 1);
      }
    }

    assert.equal(prismaMock.buckets.size, 1);
    const bucket = Array.from(prismaMock.buckets.values())[0];
    const expectedHash = crypto.createHash("sha256").update("203.0.113.42").digest("hex");
    assert.equal(bucket.key, expectedHash);
    assert.equal(bucket.count, 3);
  } finally {
    restore();
  }
});

test("createRateLimiter resets counts after the window expires", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadModuleWithMocks(rateLimitPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: {
          Serializable: "Serializable",
        },
        PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
      },
    },
    [loggerModulePath]: {
      logger: {
        warn: () => {},
        info: () => {},
        error: () => {},
      },
    },
  });

  try {
    const middleware = rateLimit.createRateLimiter({
      name: "contact-submit",
      windowMs: 60_000,
      maxRequests: 1,
      message: "Too many submissions.",
    });

    const first = createReqResNext("198.51.100.5");
    await middleware(first.req, first.res, first.next);
    assert.equal(first.req._nextError, null);

    const bucket = Array.from(prismaMock.buckets.values())[0];
    bucket.resetAt = new Date(Date.now() - 1_000);

    const second = createReqResNext("198.51.100.5");
    await middleware(second.req, second.res, second.next);
    assert.equal(second.req._nextError, null);
    assert.equal(Array.from(prismaMock.buckets.values())[0].count, 1);
  } finally {
    restore();
  }
});
