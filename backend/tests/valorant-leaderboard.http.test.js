const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const path = require("node:path");

const { HttpError } = require("../src/lib/http-error");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const v1Path = path.join(__dirname, "../src/routes/v1.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const authRoutesPath = path.join(__dirname, "../src/modules/auth/auth.routes.js");
const supportRoutesPath = path.join(__dirname, "../src/modules/support/support.routes.js");
const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const rateLimitPath = path.join(__dirname, "../src/middleware/rate-limit.js");
const tournamentServicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const matchControllerPath = path.join(__dirname, "../src/modules/matches/match.controller.js");
const challongeControllerPath = path.join(__dirname, "../src/modules/challonge/challonge.controller.js");
const staffControllerPath = path.join(__dirname, "../src/modules/permissions/staff.controller.js");
const realtimeControllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const permissionMiddlewarePath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");
const valorantControllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");
const gameAccountControllerPath = path.join(__dirname, "../src/modules/game-accounts/game-account.controller.js");
const leaderboardControllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");
const leaderboardServicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const leaderboardClientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const pass = (_req, _res, next) => next();
const controllerMock = new Proxy({}, { get: () => pass });
const permissionScopes = {
  TOURNAMENT_READ: "tournament.read",
  TOURNAMENT_ADMINISTRATION: "tournament.administration",
  STAFF_ROSTER_MANAGEMENT: "staff.roster.management",
  MATCH_OPERATIONS: "match.operations",
  VETO_OPERATIONS: "veto.operations",
  VETO_CATALOG_CONFIG: "veto.catalog.config",
};

const endpoints = [
  "/api/v1/valorant/leaderboard/register/check-puuid",
  "/api/v1/valorant/leaderboard/register/preview",
  "/api/v1/valorant/leaderboard/register/submit",
];

const request = (server, method, requestPath, { body, userId } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const requestOptions = {
      method,
      port: server.address().port,
      hostname: "127.0.0.1",
      path: requestPath,
      headers: {
        ...(userId ? { "x-test-user": userId } : {}),
        ...(body === undefined ? {} : {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        }),
      },
    };
    const clientRequest = http.request(requestOptions, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
        });
      });
    });
    clientRequest.on("error", reject);
    if (payload) clientRequest.write(payload);
    clientRequest.end();
  });

const buildMountedApp = () => {
  let discordLinked = true;
  const upstreamCalls = [];
  const clientMock = {
    getLeaderboard: async () => ({ entries: [], total: 0, page: 1, per_page: 50, total_pages: 1 }),
    searchLeaderboard: async () => null,
    checkPuuid: async (puuid) => {
      upstreamCalls.push({ operation: "checkPuuid", payload: puuid });
      return { exists: false };
    },
    previewRegistration: async (puuid) => {
      upstreamCalls.push({ operation: "previewRegistration", payload: puuid });
      return { puuid };
    },
    submitRegistration: async (payload) => {
      upstreamCalls.push({ operation: "submitRegistration", payload });
      return { success: true, player: { puuid: payload.puuid } };
    },
  };
  const { module: service, restore: restoreService } = loadModuleWithMocks(leaderboardServicePath, {
    [leaderboardClientPath]: clientMock,
    [prismaPath]: {
      prisma: {
        oAuthAccount: {
          findFirst: async () => discordLinked
            ? { providerUserId: "canonical-discord-id", user: { discordTag: "stored-discord-name" } }
            : null,
        },
      },
    },
  });
  const { module: controller, restore: restoreController } = loadModuleWithMocks(leaderboardControllerPath, {
    [leaderboardServicePath]: service,
  });
  const { module: router, restore: restoreRouter } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: {
      attachSession: (req, _res, next) => {
        req.user = req.headers["x-test-user"] ? { id: req.headers["x-test-user"] } : null;
        next();
      },
      requireAuth: (req, _res, next) => {
        if (!req.user) {
          next(new HttpError(401, "You must be logged in to access this resource."));
          return;
        }
        next();
      },
      requireAdmin: pass,
    },
    [authRoutesPath]: { oauthLinkRoutes: express.Router() },
    [supportRoutesPath]: express.Router(),
    [cacheControlPath]: { cachePublicData: () => pass },
    [responseCachePath]: { cacheJson: () => pass, invalidateCache: () => pass },
    [rateLimitPath]: { createRateLimiter: () => pass, getClientIp: () => "127.0.0.1" },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: pass },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => pass,
      requirePermission: () => pass,
      requireVetoRoomCode: pass,
      requireVetoRoomCredential: pass,
      PERMISSION_SCOPES: permissionScopes,
    },
    [valorantControllerPath]: controllerMock,
    [gameAccountControllerPath]: controllerMock,
    [leaderboardControllerPath]: controller,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      success: false,
      error: {
        code: error.code || "request_failed",
        message: error.message,
      },
    });
  });
  const server = app.listen(0, "127.0.0.1");

  return {
    server,
    upstreamCalls,
    unlinkDiscord: () => { discordLinked = false; },
    restore: () => {
      server.close();
      restoreRouter();
      restoreController();
      restoreService();
    },
  };
};

test("mounted registration routes enforce session, linked Discord, and derived identity", async () => {
  const mounted = buildMountedApp();
  try {
    await new Promise((resolve) => mounted.server.once("listening", resolve));

    for (const endpoint of endpoints) {
      const anonymous = await request(mounted.server, "POST", endpoint, { body: { puuid: "p-1" } });
      assert.equal(anonymous.status, 401, `${endpoint} must reject anonymous callers`);
    }

    mounted.unlinkDiscord();
    for (const endpoint of endpoints) {
      const unlinked = await request(mounted.server, "POST", endpoint, {
        userId: "user-1",
        body: { puuid: "p-1", discord_id: "forged-id", discord_username: "forged-name" },
      });
      assert.equal(unlinked.status, 403, `${endpoint} must reject an unlinked user`);
      assert.equal(unlinked.body.error.code, "DISCORD_LINK_REQUIRED");
    }

    const linkedMounted = buildMountedApp();
    try {
      await new Promise((resolve) => linkedMounted.server.once("listening", resolve));
      for (const endpoint of endpoints) {
        const linked = await request(linkedMounted.server, "POST", endpoint, {
          userId: "user-1",
          body: { puuid: "p-1", discord_id: "forged-id", discord_username: "forged-name" },
        });
        assert.equal(linked.status, 200, `${endpoint} must allow a linked user`);
      }
      assert.deepEqual(linkedMounted.upstreamCalls, [
        { operation: "checkPuuid", payload: "p-1" },
        { operation: "previewRegistration", payload: "p-1" },
        {
          operation: "submitRegistration",
          payload: {
            puuid: "p-1",
            discord_id: "canonical-discord-id",
            discord_username: "stored-discord-name",
          },
        },
      ]);

      linkedMounted.unlinkDiscord();
      for (const endpoint of endpoints) {
        const afterUnlink = await request(linkedMounted.server, "POST", endpoint, {
          userId: "user-1",
          body: { puuid: "p-1" },
        });
        assert.equal(afterUnlink.status, 403, `${endpoint} must deny after unlink`);
        assert.equal(afterUnlink.body.error.code, "DISCORD_LINK_REQUIRED");
      }
    } finally {
      linkedMounted.restore();
    }
  } finally {
    mounted.restore();
  }
});
