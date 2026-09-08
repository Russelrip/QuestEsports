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
        // No id clause: Tournament.id is @db.Uuid and PostgreSQL rejects the
        // whole statement when a slug is compared against it.
        { OR: [{ slug: "valorant-cup" }, { title: { contains: "valorant-cup", mode: "insensitive" } }] },
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

test("event registration summaries map only safe fields and isolate returned items to the requested event", async () => {
  const registrations = [
    {
      id: "registration-event-1",
      entryType: "team",
      teamName: "Event One Team",
      status: "approved",
      paymentStatus: "paid",
      verificationStatus: "verified",
      publicReference: "QES-EVENT1",
      createdAt: new Date("2026-08-17T10:00:00.000Z"),
      captainName: "Captain One",
      captainEmail: "one@example.com",
      tournament: { id: "tournament-event-1", slug: "event-one-valorant", title: "Event One Valorant", game: "Valorant", seriesId: "event-1" },
      members: [{ name: "Coach One", riotId: "Coach#001" }],
      _count: { members: 5 },
      adminSlotReservation: { note: "Private note" },
      paymentEvidence: { storedFilename: "private-proof.png" },
      adminNotes: "Internal note",
      payment: { provider: "bank_transfer", proof: "private" },
    },
    {
      id: "registration-event-2",
      entryType: "team",
      teamName: "Event Two Team",
      status: "pending",
      paymentStatus: "unpaid",
      verificationStatus: "pending",
      publicReference: "QES-EVENT2",
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
      captainName: "Captain Two",
      captainEmail: "two@example.com",
      tournament: { id: "tournament-event-2", slug: "event-two-valorant", title: "Event Two Valorant", game: "Valorant", seriesId: "event-2" },
      members: [],
      _count: { members: 5 },
    },
  ];
  const eventTournaments = [{ id: "tournament-event-1", slug: "event-one-valorant", title: "Event One Valorant", game: "Valorant", status: "registration_open", isPublished: true, waitlistEnabled: true }];
  const prisma = {
    teamRegistration: {
      count: async () => 1,
      findMany: async ({ where }) => {
        const eventFilter = where.tournament?.seriesId || where.tournament?.AND?.find((filter) => filter.seriesId)?.seriesId;
        return registrations
          .filter((registration) => registration.tournament.seriesId === eventFilter)
          .map((registration) => ({ ...registration, tournament: eventTournaments[0] }));
      },
    },
    tournament: { findMany: async ({ where }) => where.seriesId === "event-1" ? eventTournaments : [] },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = loadAdminService(prisma);

  try {
    const result = await service.listTeamRegistrations({ eventId: "event-1", page: "1", pageSize: "10" });
    assert.deepEqual(result.items.map((item) => item.id), ["registration-event-1"]);
    assert.deepEqual(result.tournaments.map((item) => item.id), ["tournament-event-1"]);
    assert.deepEqual(result.items[0], {
      id: "registration-event-1",
      entryType: "team",
      teamName: "Event One Team",
      status: "approved",
      paymentStatus: "paid",
      verificationStatus: "verified",
      waitlistPosition: null,
      publicReference: "QES-EVENT1",
      createdAt: new Date("2026-08-17T10:00:00.000Z"),
      tournament: eventTournaments[0],
      captain: { name: "Captain One", email: "one@example.com" },
      coachName: "Coach One",
      coachRiotId: "Coach#001",
      memberCount: 5,
    });
    assert.equal("adminSlotReservation" in result.items[0], false);
    assert.equal("paymentEvidence" in result.items[0], false);
    assert.equal("adminNotes" in result.items[0], false);
    assert.equal("payment" in result.items[0], false);
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
