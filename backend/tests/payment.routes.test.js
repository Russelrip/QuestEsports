const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const routesPath = path.join(__dirname, "../src/modules/payments/payment.routes.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const controllerPath = path.join(__dirname, "../src/modules/payments/payment.controller.js");

const pass = (_req, _res, next) => next();
const controller = new Proxy({}, { get: () => pass });

test("payment routes use conditional projection invalidation and skip ticket-only cash reconciliation", () => {
  const invalidations = [];
  const invalidationMiddleware = function paymentInvalidation(_req, _res, next) { next(); };
  const upload = { single: () => pass };
  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: { requireAdmin: pass },
    [uploadPath]: { paymentProofUpload: upload },
    [rateLimitPath]: { createRateLimiter: () => pass },
    [responseCachePath]: {
      invalidateCache: (...tags) => {
        invalidations.push(tags);
        return invalidationMiddleware;
      },
    },
    [controllerPath]: controller,
  });

  try {
    assert.equal(invalidations.length, 1);
    assert.ok(invalidations.every((tags) => tags.length === 1 && typeof tags[0] === "function"));
    const statusRoute = router.stack.find(
      (layer) => layer.route?.path === "/payments/:orderId",
    );
    assert.ok(statusRoute);
    assert.equal(
      statusRoute.route.stack.some((layer) => layer.handle === invalidationMiddleware),
      true,
    );
    const cashRoute = router.stack.find(
      (layer) => layer.route?.path === "/admin/payments/:transactionId/cash-reconciliation",
    );
    assert.ok(cashRoute);
    assert.equal(
      cashRoute.route.stack.some((layer) => layer.handle === invalidationMiddleware),
      false,
    );
  } finally {
    restore();
  }
});
