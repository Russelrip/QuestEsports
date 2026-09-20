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
const httpErrorModulePath = path.join(__dirname, "../src/lib/http-error.js");

const createPrismaMock = () => {
  const buckets = new Map();

  const getCompositeKey = (name, key) => `${name}:${key}`;

  const rateLimitBucket = {
    deleteMany: async ({ where }) => {
        let count = 0;

        if (where.name && where.key) {
          if (buckets.delete(getCompositeKey(where.name, where.key))) {
            count += 1;
          }
          return { count };
        }

        for (const [key, bucket] of buckets.entries()) {
          if (bucket.resetAt < where.resetAt.lt) {
            buckets.delete(key);
            count += 1;
          }
        }
        return { count };
    },
  };

  return {
    prisma: {
      rateLimitBucket,
      $queryRaw: async (_queryParts, ...values) => {
        const id = values[0];
        const name = values[1];
        const key = values[2];
        const nextResetAt = values[3];
        const now = values[6];
        const compositeKey = getCompositeKey(name, key);
        const existing = buckets.get(compositeKey);
        const record = existing
          ? {
              ...existing,
              count: existing.resetAt <= now ? 1 : existing.count + 1,
              resetAt: existing.resetAt <= now ? nextResetAt : existing.resetAt,
              updatedAt: now,
            }
          : {
              id,
              name,
              key,
              count: 1,
              resetAt: nextResetAt,
              createdAt: now,
              updatedAt: now,
            };
        buckets.set(compositeKey, record);
        return [record];
      },
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

// The loader evicts the module under test and its children from the require
// cache, so http-error is pinned to this file's copy of HttpError. Without it,
// whichever test happens to run second gets a fresh class and `instanceof`
// silently stops matching.
const loadRateLimit = (prismaMock, { PrismaClientKnownRequestError } = {}) =>
  loadModuleWithMocks(rateLimitPath, {
    [prismaModulePath]: { prisma: prismaMock.prisma },
    [generatedPrismaPath]: {
      Prisma: {
        TransactionIsolationLevel: {
          Serializable: "Serializable",
        },
        PrismaClientKnownRequestError:
          PrismaClientKnownRequestError ||
          class PrismaClientKnownRequestError extends Error {},
      },
    },
    [loggerModulePath]: {
      logger: {
        warn: () => {},
        info: () => {},
        error: () => {},
      },
    },
    [httpErrorModulePath]: { HttpError },
  });

test("clearRateLimit drops the bucket a request consumed so the next one starts fresh", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadRateLimit(prismaMock);

  try {
    const middleware = rateLimit.createRateLimiter({
      name: "auth-login-password-identity",
      windowMs: 60_000,
      maxRequests: 3,
      message: "Too many login attempts.",
    });

    // Two wrong guesses, both inside the budget.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { req, res, next } = createReqResNext();
      await middleware(req, res, next);
      assert.equal(req._nextError, null);
    }

    // The third attempt is the one that succeeds, and clears its own bucket.
    const success = createReqResNext();
    await middleware(success.req, success.res, success.next);
    assert.equal(success.req._nextError, null);
    assert.equal(
      await rateLimit.clearRateLimit(success.req, "auth-login-password-identity"),
      true
    );
    assert.equal(prismaMock.buckets.size, 0);

    // Without the clear, the next two requests would be the fourth and fifth in
    // the window and the second of them would be rejected. They now start over.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { req, res, next } = createReqResNext();
      await middleware(req, res, next);
      assert.equal(req._nextError, null);
    }
    assert.equal(Array.from(prismaMock.buckets.values())[0].count, 2);
  } finally {
    restore();
  }
});

test("clearRateLimit leaves other limiters' buckets alone", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadRateLimit(prismaMock);

  try {
    const ipMiddleware = rateLimit.createRateLimiter({
      name: "auth-login-password-ip",
      windowMs: 60_000,
      maxRequests: 50,
      message: "Too many login attempts from this network.",
    });
    const identityMiddleware = rateLimit.createRateLimiter({
      name: "auth-login-password-identity",
      windowMs: 60_000,
      maxRequests: 5,
      message: "Too many login attempts.",
    });

    const { req, res, next } = createReqResNext();
    await ipMiddleware(req, res, next);
    await identityMiddleware(req, res, next);
    assert.equal(prismaMock.buckets.size, 2);

    await rateLimit.clearRateLimit(req, "auth-login-password-identity");

    const remaining = Array.from(prismaMock.buckets.values());
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].name, "auth-login-password-ip");
  } finally {
    restore();
  }
});

test("clearRateLimit is a no-op when the limiter never ran, and survives database failures", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadRateLimit(prismaMock);

  try {
    const middleware = rateLimit.createRateLimiter({
      name: "auth-login-password-identity",
      windowMs: 60_000,
      maxRequests: 5,
      message: "Too many login attempts.",
    });

    assert.equal(await rateLimit.clearRateLimit({}, "auth-login-password-identity"), false);

    const { req, res, next } = createReqResNext();
    await middleware(req, res, next);

    prismaMock.prisma.rateLimitBucket.deleteMany = async () => {
      throw new Error("connection lost");
    };

    // A login that already succeeded must not fail because of the cleanup.
    assert.equal(
      await rateLimit.clearRateLimit(req, "auth-login-password-identity"),
      false
    );
  } finally {
    restore();
  }
});

test("createRateLimiter persists hashed keys and blocks after the configured threshold", async () => {
  const prismaMock = createPrismaMock();
  const { module: rateLimit, restore } = loadRateLimit(prismaMock);

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
  const { module: rateLimit, restore } = loadRateLimit(prismaMock);

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

test("createRateLimiter retries transient atomic-operation timeouts", async () => {
  class PrismaClientKnownRequestError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const prismaMock = createPrismaMock();
  const baseQueryRaw = prismaMock.prisma.$queryRaw;
  let queryCalls = 0;

  prismaMock.prisma.$queryRaw = async (...args) => {
    queryCalls += 1;
    if (queryCalls === 1) {
      throw new PrismaClientKnownRequestError(
        "Unable to acquire a database connection in time.",
        "P2024"
      );
    }

    return baseQueryRaw(...args);
  };

  const { module: rateLimit, restore } = loadRateLimit(prismaMock, {
    PrismaClientKnownRequestError,
  });

  try {
    const middleware = rateLimit.createRateLimiter({
      name: "tournament-registration-submit",
      windowMs: 60_000,
      maxRequests: 10,
      message: "Too many registrations.",
    });

    const { req, res, next } = createReqResNext("192.0.2.9");
    await middleware(req, res, next);

    assert.equal(req._nextError, null);
    assert.equal(queryCalls, 2);
    assert.equal(res.getHeader("RateLimit-Limit"), "10");
    assert.equal(prismaMock.buckets.size, 1);
  } finally {
    restore();
  }
});
