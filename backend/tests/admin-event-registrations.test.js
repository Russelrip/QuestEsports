const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/admin/admin.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const authServicePath = path.join(__dirname, "../src/modules/auth/auth.service.js");
const legacyImportPath = path.join(__dirname, "../src/modules/media/legacy-import.service.js");
const mediaServicePath = path.join(__dirname, "../src/modules/media/media.service.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const secretBoxPath = path.join(__dirname, "../src/lib/secret-box.js");
const bankTransferPath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");

const loadAdminService = (prisma) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [authServicePath]: { mapUserForResponse: (user) => user, validateUserBasics: () => ({}) },
  [legacyImportPath]: { importLegacyPosters: async () => ({}) },
  [mediaServicePath]: { migrateImageAssetsToFilesystem: async () => ({}) },
  [uploadPath]: { bankTransferProofDirectory: "private/bank-transfer-proofs", teamLogoDirectory: "uploads/team-logos" },
  [loggerPath]: { logger: { warn: () => {} } },
  [teamServicePath]: { activatePaidTeamRegistration: async () => undefined },
  [secretBoxPath]: { decryptSecret: (value) => value },
  [bankTransferPath]: { getBankTransferAmountForSlot: () => 0 },
});

test("event registration filtering combines event, game, status, search, and database pagination", async () => {
  const calls = [];
  const prisma = {
    teamRegistration: {
      count: async (args) => calls.push(["count", args]),
      findMany: async (args) => calls.push(["findMany", args]) && [],
    },
    tournament: { findMany: async (args) => calls.push(["tournaments", args]) && [] },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadAdminService(prisma);

  try {
    const result = await service.listTeamRegistrations({ eventId: "event-1", game: "Valorant", tournament: "valorant-cup", status: "waitlisted", search: "captain", page: "2", pageSize: "2" });
    const where = calls.find(([type]) => type === "count")[1].where;
    assert.deepEqual(where.tournament, {
      AND: [
        { seriesId: "event-1" },
        { game: { equals: "Valorant", mode: "insensitive" } },
        { OR: [{ id: "valorant-cup" }, { slug: "valorant-cup" }, { title: { contains: "valorant-cup", mode: "insensitive" } }] },
      ],
    });
    assert.equal(where.status, "waitlisted");
    assert.equal(where.OR[0].teamName.contains, "captain");
    const registrationQuery = calls.find(([type]) => type === "findMany")[1];
    assert.equal(registrationQuery.skip, 2);
    assert.equal(registrationQuery.take, 2);
    assert.deepEqual(calls.find(([type]) => type === "tournaments")[1].where, { seriesId: "event-1" });
    assert.equal(result.pagination.page, 2);
  } finally {
    restore();
  }
});

test("event registration route remains admin-only and points at the series controller alias", () => {
  const routesPath = path.join(__dirname, "../src/modules/series/series.routes.js");
  const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
  const uploadPathForRoutes = path.join(__dirname, "../src/middleware/upload.js");
  const cachePath = path.join(__dirname, "../src/middleware/response-cache.js");
  const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const controllerPath = path.join(__dirname, "../src/modules/series/series.controller.js");
  const requireAdmin = function requireAdmin(_req, _res, next) { next(); };
  const registrationHandler = function getEventRegistrations(_req, _res, next) { next(); };
  const controller = new Proxy({}, { get: (target, key) => key === "getEventRegistrations" ? registrationHandler : (target[key] || (() => {})) });
  const { module: router, restore } = loadModuleWithMocks(routesPath, {
    [authPath]: { requireAdmin },
    [uploadPathForRoutes]: { tournamentBannerUpload: { fields: () => (_req, _res, next) => next(), single: () => (_req, _res, next) => next() } },
    [cachePath]: { cacheJson: () => (_req, _res, next) => next(), invalidateCache: () => (_req, _res, next) => next() },
    [cacheControlPath]: { cachePublicData: () => (_req, _res, next) => next() },
    [envPath]: { env: { CACHE_TTL_SECONDS: 60 } },
    [controllerPath]: controller,
  });

  try {
    const route = router.stack.find((layer) => layer.route?.path === "/admin/events/:eventId/registrations");
    assert.ok(route);
    assert.equal(route.route.methods.get, true);
    const handlers = route.route.stack.map((layer) => layer.handle);
    assert.ok(handlers.includes(requireAdmin));
    assert.ok(handlers.includes(registrationHandler));
  } finally {
    restore();
  }
});

test("non-admin event registration requests are rejected by the existing middleware", () => {
  const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
  const sessionPath = path.join(__dirname, "../src/modules/auth/session.service.js");
  const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
  const errorPath = path.join(__dirname, "../src/lib/http-error.js");
  const loggerPathForAuth = path.join(__dirname, "../src/lib/logger.js");
  const { module: auth, restore } = loadModuleWithMocks(authPath, {
    [sessionPath]: { getSessionFromRequest: async () => null },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [errorPath]: { HttpError: class HttpError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; } } },
    [loggerPathForAuth]: { logger: { warn: () => {} } },
  });

  try {
    let nextError;
    auth.requireAdmin({ user: { id: "user-1", role: "user" }, method: "GET", originalUrl: "/api/admin/events/event-1/registrations", ip: "127.0.0.1" }, {}, (error) => { nextError = error; });
    assert.equal(nextError.statusCode, 403);
  } finally {
    restore();
  }
});
