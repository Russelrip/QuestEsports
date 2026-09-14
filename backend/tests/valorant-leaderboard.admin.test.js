const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");
const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");

const ADMIN_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

const upstreamRow = {
  puuid: "fe6c5224-dc61-5c3e-95eb-c29ad4f4acea",
  name: "Chamsy",
  tag: "0001",
  discord_username: "chamsy.",
  current_tier: "Gold 3",
  elo: 1128,
  last_played_match: null,
  update_source: "migration",
  updated_at: "2026-08-15T14:09:35+00:00",
  on_leaderboard: false,
};

const makeRes = () => {
  const calls = { status: 200, json: undefined };
  const res = {
    status(code) { calls.status = code; return res; },
    json(body) { calls.json = body; return res; },
  };
  return { res, calls };
};

const run = async (handler, req) => {
  const { res, calls } = makeRes();
  let error;
  await handler(req, res, (err) => { error = err; });
  return { calls, error };
};

const loadService = ({ client = {}, prisma = {}, warnings = [] } = {}) =>
  loadModuleWithMocks(servicePath, {
    [clientPath]: client,
    [prismaPath]: { prisma: { oAuthAccount: { findFirst: async () => null }, ...prisma } },
    [loggerPath]: { logger: { warn: (message) => warnings.push(message), info() {}, error() {} } },
  }).module;

const loadController = ({ service, audits = [] }) =>
  loadModuleWithMocks(controllerPath, {
    [servicePath]: service,
    [auditPath]: {
      recordAudit: async (entry) => { audits.push(entry); },
      requestAuditContext: (req) => ({ actorUserId: req.user?.id ?? null, requestId: null, ipAddress: null, source: "web" }),
    },
  }).module;

test("listAdminRegistrations maps upstream rows to camelCase and signs as the admin", async () => {
  let seen;
  const service = loadService({
    client: {
      listRegistrations: async (input) => {
        seen = input;
        return { entries: [upstreamRow], total: 1, page: 1, per_page: 50, total_pages: 1 };
      },
    },
  });

  const result = await service.listAdminRegistrations({ query: "chamsy", page: 1, perPage: 50, actorUserId: ADMIN_ID });

  assert.deepEqual(seen, { query: "chamsy", page: 1, perPage: 50, actorUserId: ADMIN_ID });
  assert.deepEqual(result.entries[0], {
    puuid: upstreamRow.puuid,
    name: "Chamsy",
    tag: "0001",
    discordUsername: "chamsy.",
    currentTier: "Gold 3",
    elo: 1128,
    lastPlayed: null,
    updateSource: "migration",
    updatedAt: "2026-08-15T14:09:35+00:00",
    onLeaderboard: false,
  });
  assert.equal(result.totalPages, 1);
});

test("removeAdminRegistration deletes upstream, then clears the linked player's cached rank", async () => {
  const order = [];
  let rankingWhere;
  const service = loadService({
    client: {
      removeRegistration: async ({ puuid, actorUserId }) => {
        order.push(["upstream", puuid, actorUserId]);
        return upstreamRow;
      },
    },
    prisma: {
      playerRanking: {
        deleteMany: async ({ where }) => {
          order.push(["rankings"]);
          rankingWhere = where;
          return { count: 1 };
        },
      },
    },
  });

  const result = await service.removeAdminRegistration({ puuid: upstreamRow.puuid, actorUserId: ADMIN_ID });

  assert.deepEqual(order, [["upstream", upstreamRow.puuid, ADMIN_ID], ["rankings"]]);
  assert.deepEqual(rankingWhere, {
    game: "valorant",
    player: { gameAccounts: { some: { game: "valorant", externalId: upstreamRow.puuid } } },
  });
  assert.equal(result.removed.name, "Chamsy");
  assert.equal(result.rankingsCleared, 1);
});

test("removeAdminRegistration still resolves when clearing the profile rank fails, so the removal is audited", async () => {
  const warnings = [];
  const service = loadService({
    warnings,
    client: { removeRegistration: async () => upstreamRow },
    prisma: { playerRanking: { deleteMany: async () => { throw new Error("database unavailable"); } } },
  });

  const result = await service.removeAdminRegistration({ puuid: upstreamRow.puuid, actorUserId: ADMIN_ID });

  assert.equal(result.removed.name, "Chamsy");
  assert.equal(result.rankingsCleared, null);
  assert.equal(warnings.length, 1);
});

test("removeAdminRegistration leaves Quest rankings alone when the upstream delete fails", async () => {
  let rankingsTouched = false;
  const service = loadService({
    client: {
      removeRegistration: async () => {
        throw new Error("leaderboard player not found");
      },
    },
    prisma: { playerRanking: { deleteMany: async () => { rankingsTouched = true; return { count: 0 }; } } },
  });

  await assert.rejects(service.removeAdminRegistration({ puuid: "ghost", actorUserId: ADMIN_ID }), /not found/);
  assert.equal(rankingsTouched, false);
});

test("removeRegistration requires a reason and never calls the service without one", async () => {
  let called = false;
  const controller = loadController({
    service: { removeAdminRegistration: async () => { called = true; } },
  });

  for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 42 }, { reason: "x".repeat(501) }]) {
    const { error } = await run(controller.removeRegistration, { params: { puuid: "p" }, body, user: { id: ADMIN_ID } });
    assert.equal(error?.statusCode, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(called, false);
});

test("removeRegistration audits who, why and which Riot ID, without the PUUID", async () => {
  const audits = [];
  let seen;
  const controller = loadController({
    audits,
    service: {
      removeAdminRegistration: async (input) => {
        seen = input;
        return {
          removed: {
            puuid: upstreamRow.puuid, name: "Chamsy", tag: "0001", discordUsername: "chamsy.",
            currentTier: "Gold 3", elo: 1128, lastPlayed: null, updateSource: "migration",
            updatedAt: "2026-08-15T14:09:35+00:00", onLeaderboard: false,
          },
          rankingsCleared: 0,
        };
      },
    },
  });

  const { calls, error } = await run(controller.removeRegistration, {
    params: { puuid: upstreamRow.puuid },
    body: { reason: "  Henrik 404s on every pass; account no longer exists  " },
    user: { id: ADMIN_ID },
  });

  assert.equal(error, undefined);
  assert.deepEqual(seen, { puuid: upstreamRow.puuid, actorUserId: ADMIN_ID });
  assert.equal(calls.status, 200);
  assert.equal(calls.json.data.removed.name, "Chamsy");

  assert.equal(audits.length, 1);
  const [audit] = audits;
  assert.equal(audit.action, "valorant.leaderboard_player.remove");
  assert.equal(audit.actorUserId, ADMIN_ID);
  assert.equal(audit.source, "admin");
  assert.equal(audit.reason, "Henrik 404s on every pass; account no longer exists");
  assert.equal(audit.beforeData.riotId, "Chamsy#0001");
  assert.equal(audit.targetId, null);
  assert.equal(JSON.stringify(audit).includes(upstreamRow.puuid), false);
});

test("listRegistrations trims the query and clamps paging", async () => {
  let seen;
  const controller = loadController({
    service: { listAdminRegistrations: async (input) => { seen = input; return { entries: [] }; } },
  });

  await run(controller.listRegistrations, { query: { q: "  chamsy ", page: "0", per_page: "5000" }, user: { id: ADMIN_ID } });

  assert.deepEqual(seen, { query: "chamsy", page: 1, perPage: 200, actorUserId: ADMIN_ID });
});

const REMOVAL_ID = "0b5c9a8e-2f4d-4b7e-9c1a-3d5e7f9a1b2c";

test("removeAdminRegistration passes on the removal id so the removal can be restored", async () => {
  const service = loadService({
    client: { removeRegistration: async () => ({ ...upstreamRow, removal_id: REMOVAL_ID }) },
    prisma: { playerRanking: { deleteMany: async () => ({ count: 0 }) } },
  });

  const result = await service.removeAdminRegistration({ puuid: upstreamRow.puuid, actorUserId: ADMIN_ID });

  assert.equal(result.removalId, REMOVAL_ID);
});

test("listAdminRemovals maps upstream rows and names the admins who acted", async () => {
  let seen;
  let userLookup;
  const service = loadService({
    client: {
      listRemovals: async (input) => {
        seen = input;
        return {
          entries: [
            {
              removal_id: REMOVAL_ID, puuid: upstreamRow.puuid, name: "CasperYT", tag: "1991",
              discord_username: "janithbokula.", current_tier: "Diamond 2", elo: 1621,
              last_played_match: "2026-09-12T20:56:09+00:00", removed_at: "2026-09-14T07:33:25+00:00",
              removed_by: ADMIN_ID, restored_at: null, restored_by: null,
              registered_again: false, superseded: false, restorable: true,
            },
            {
              removal_id: "r2", puuid: "p2", name: "Gone", tag: "0001", discord_username: "gone",
              current_tier: null, elo: null, last_played_match: null, removed_at: "2026-09-13T20:14:46+00:00",
              removed_by: "quest-leaderboard-system", restored_at: null, restored_by: null,
              registered_again: true, superseded: false, restorable: false,
            },
          ],
          total: 2, page: 1, per_page: 20, total_pages: 1,
        };
      },
    },
    prisma: {
      user: {
        findMany: async (args) => {
          userLookup = args;
          return [{ id: ADMIN_ID, username: "Russel" }];
        },
      },
    },
  });

  const result = await service.listAdminRemovals({ query: "casper", page: 1, perPage: 20, actorUserId: ADMIN_ID });

  assert.deepEqual(seen, { query: "casper", page: 1, perPage: 20, actorUserId: ADMIN_ID });
  // Only real user ids reach the uuid column.
  assert.deepEqual(userLookup.where, { id: { in: [ADMIN_ID] } });
  assert.deepEqual(result.entries[0], {
    removalId: REMOVAL_ID, puuid: upstreamRow.puuid, name: "CasperYT", tag: "1991",
    discordUsername: "janithbokula.", currentTier: "Diamond 2", elo: 1621,
    lastPlayed: "2026-09-12T20:56:09+00:00", removedAt: "2026-09-14T07:33:25+00:00",
    removedBy: { id: ADMIN_ID, username: "Russel" }, restoredAt: null, restoredBy: null,
    registeredAgain: false, superseded: false, restorable: true,
  });
  assert.deepEqual(result.entries[1].removedBy, { id: null, username: null });
  assert.equal(result.entries[1].restorable, false);
  assert.equal(result.totalPages, 1);
});

test("restoreAdminRemoval restores upstream as the admin and returns the registration", async () => {
  let seen;
  const service = loadService({
    client: {
      restoreRemoval: async (input) => {
        seen = input;
        return { ...upstreamRow, on_leaderboard: true, removal_id: REMOVAL_ID, removed_at: "2026-09-14T07:33:25+00:00", removed_by: ADMIN_ID };
      },
    },
  });

  const result = await service.restoreAdminRemoval({ removalId: REMOVAL_ID, actorUserId: ADMIN_ID });

  assert.deepEqual(seen, { removalId: REMOVAL_ID, actorUserId: ADMIN_ID });
  assert.equal(result.restored.name, "Chamsy");
  assert.equal(result.restored.onLeaderboard, true);
  assert.equal(result.removalId, REMOVAL_ID);
  assert.equal(result.removedAt, "2026-09-14T07:33:25+00:00");
});

test("restoreRemoval requires a reason and never calls the service without one", async () => {
  let called = false;
  const controller = loadController({
    service: { restoreAdminRemoval: async () => { called = true; } },
  });

  for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 42 }, { reason: "x".repeat(501) }]) {
    const { error } = await run(controller.restoreRemoval, { params: { removalId: REMOVAL_ID }, body, user: { id: ADMIN_ID } });
    assert.equal(error?.statusCode, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(called, false);
});

test("restoreRemoval audits the restore with the Riot ID and reason, without the PUUID", async () => {
  const audits = [];
  const controller = loadController({
    audits,
    service: {
      restoreAdminRemoval: async () => ({
        restored: {
          puuid: upstreamRow.puuid, name: "CasperYT", tag: "1991", discordUsername: "janithbokula.",
          currentTier: "Diamond 2", elo: 1621, lastPlayed: null, updateSource: "updater_service",
          updatedAt: "2026-09-14T06:47:06+00:00", onLeaderboard: true,
        },
        removalId: REMOVAL_ID,
        removedAt: "2026-09-14T07:33:25+00:00",
      }),
    },
  });

  const { calls, error } = await run(controller.restoreRemoval, {
    params: { removalId: REMOVAL_ID },
    body: { reason: " Removed the wrong CasperYT " },
    user: { id: ADMIN_ID },
  });

  assert.equal(error, undefined);
  assert.equal(calls.json.data.restored.name, "CasperYT");
  assert.equal(audits.length, 1);
  const [audit] = audits;
  assert.equal(audit.action, "valorant.leaderboard_player.restore");
  assert.equal(audit.reason, "Removed the wrong CasperYT");
  assert.equal(audit.source, "admin");
  assert.deepEqual(audit.beforeData, { removed: true, removalId: REMOVAL_ID, removedAt: "2026-09-14T07:33:25+00:00" });
  assert.equal(audit.afterData.riotId, "CasperYT#1991");
  assert.equal(JSON.stringify(audit).includes(upstreamRow.puuid), false);
});

test("restoreRemoval records nothing when upstream refuses the restore", async () => {
  const audits = [];
  const controller = loadController({
    audits,
    service: {
      restoreAdminRemoval: async () => {
        const error = new Error("this player is registered on the leaderboard again, so there is nothing to restore");
        error.statusCode = 409;
        throw error;
      },
    },
  });

  const { error } = await run(controller.restoreRemoval, {
    params: { removalId: REMOVAL_ID },
    body: { reason: "Mistake" },
    user: { id: ADMIN_ID },
  });

  assert.equal(error.statusCode, 409);
  assert.equal(audits.length, 0);
});

test("listRemovals trims the query and clamps paging", async () => {
  let seen;
  const controller = loadController({
    service: { listAdminRemovals: async (input) => { seen = input; return { entries: [] }; } },
  });

  await run(controller.listRemovals, { query: { q: "  casper ", page: "-2", per_page: "900" }, user: { id: ADMIN_ID } });

  assert.deepEqual(seen, { query: "casper", page: 1, perPage: 100, actorUserId: ADMIN_ID });
});
