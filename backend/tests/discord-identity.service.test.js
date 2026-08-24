const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/players/discord-identity.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260824234500_add_discord_identity/migration.sql",
);

const load = (prisma) => loadModuleWithMocks(servicePath, {
  [prismaModulePath]: { prisma },
});

const stub = ({ identities = [], players = [], oauth = [] } = {}) => {
  const upserts = [];
  return {
    upserts,
    prisma: {
      discordIdentity: {
        findUnique: async ({ where }) =>
          identities.find(
            (i) =>
              (where.playerId && i.playerId === where.playerId) ||
              (where.discordUserId && i.discordUserId === where.discordUserId),
          ) ?? null,
        upsert: async (args) => { upserts.push(args); return args.create ?? args.update; },
      },
      player: {
        findUnique: async ({ where }) => players.find((p) => p.id === where.id) ?? null,
      },
      oAuthAccount: {
        findFirst: async ({ where }) =>
          oauth.find((o) => o.userId === where.userId && o.provider === where.provider) ?? null,
      },
    },
  };
};

test("a Discord username is never accepted as an identity key", () => {
  const { prisma } = stub();
  const { module: service, restore } = load(prisma);
  try {
    assert.equal(service.isSnowflake("111111111111111111"), true);
    assert.equal(service.isSnowflake("senumii"), false);
    assert.equal(service.isSnowflake("user#1234"), false);
    assert.equal(service.isSnowflake(""), false);
    assert.equal(service.isSnowflake(null), false);
  } finally {
    restore();
  }
});

test("linkDiscordIdentity refuses a username outright", async () => {
  const { prisma } = stub();
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      () => service.linkDiscordIdentity({ playerId: "p1", discordUserId: "senumii" }),
      /snowflake, not a username/,
    );
  } finally {
    restore();
  }
});

test("findPlayerByDiscordUserId resolves a snowflake to a player", async () => {
  const { prisma } = stub({
    identities: [{ playerId: "p1", discordUserId: "111111111111111111" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    assert.equal(await service.findPlayerByDiscordUserId("111111111111111111"), "p1");
    assert.equal(await service.findPlayerByDiscordUserId("222222222222222222"), null);
    assert.equal(await service.findPlayerByDiscordUserId("senumii"), null);
  } finally {
    restore();
  }
});

// One Discord account belongs to one player. Silently reassigning it would hand
// a tournament role to the wrong person.
test("a snowflake cannot be moved to another player silently", async () => {
  const { prisma } = stub({
    identities: [{ playerId: "p1", discordUserId: "111111111111111111" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      () => service.linkDiscordIdentity({
        playerId: "p2",
        discordUserId: "111111111111111111",
      }),
      (e) => e.code === "DISCORD_IDENTITY_CONFLICT",
    );
  } finally {
    restore();
  }
});

test("re-linking the same account is idempotent, not a second row", async () => {
  const { prisma, upserts } = stub({
    identities: [{ playerId: "p1", discordUserId: "111111111111111111" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    await service.linkDiscordIdentity({
      playerId: "p1",
      discordUserId: "111111111111111111",
      username: "senumii",
    });
    assert.equal(upserts.length, 1);
    assert.deepEqual(upserts[0].where, { playerId: "p1" });
    assert.equal(upserts[0].update.username, "senumii");
  } finally {
    restore();
  }
});

// A link made after deploy but before the linking path is cut over exists only
// on OAuthAccount. Reporting that player as unreachable would be wrong.
test("getForPlayer falls back to OAuthAccount during the expand phase", async () => {
  const { prisma } = stub({
    players: [{ id: "p1", userId: "u1" }],
    oauth: [{
      userId: "u1",
      provider: "discord",
      providerUserId: "111111111111111111",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    }],
  });
  const { module: service, restore } = load(prisma);
  try {
    const identity = await service.getForPlayer("p1");
    assert.equal(identity.discordUserId, "111111111111111111");
    assert.equal(identity.viaOAuthFallback, true);
  } finally {
    restore();
  }
});

test("getForPlayer prefers the identity row over the fallback", async () => {
  const { prisma } = stub({
    identities: [{
      playerId: "p1",
      discordUserId: "111111111111",
      username: "cached",
      source: "oauth",
    }],
    players: [{ id: "p1", userId: "u1" }],
    oauth: [{ userId: "u1", provider: "discord", providerUserId: "222222222222" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    const identity = await service.getForPlayer("p1");
    assert.equal(identity.discordUserId, "111111111111");
    assert.equal(identity.viaOAuthFallback, undefined);
  } finally {
    restore();
  }
});

test("getForPlayer returns null for an unclaimed player", async () => {
  const { prisma } = stub({ players: [{ id: "p1", userId: null }] });
  const { module: service, restore } = load(prisma);
  try {
    assert.equal(await service.getForPlayer("p1"), null);
    assert.equal(await service.getForPlayer(null), null);
  } finally {
    restore();
  }
});

test("migration enforces the identity boundaries in the database", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  // One Discord per player, one player per Discord.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "discord_identities_player_id_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "discord_identities_discord_user_id_key"/);
  // A snowflake is digits: storing a username must be impossible, not discouraged.
  assert.match(sql, /discord_identities_snowflake_check/);
  assert.match(sql, /\^\[0-9\]\{5,32\}\$/);
  // Backfill only from completed OAuth flows, and only real snowflakes.
  assert.match(sql, /WHERE o\."provider" = 'discord'/);
  assert.doesNotMatch(sql, /DROP\s+(COLUMN|TABLE)/i);
});

// A snowflake plus a display name is directly personally identifying and links
// a Quest player to an account outside Quest, so this table must be as
// unreachable from the Supabase Data API roles as players and game_accounts.
// scripts/verify-database-security.js enforces this in CI; asserting it here
// too means the migration fails review rather than the pipeline.
test("migration hardens the table against the Supabase Data API", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /ALTER TABLE public\."discord_identities" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\."discord_identities" FROM PUBLIC/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
});
