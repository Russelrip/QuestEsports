const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/auth/discord-link.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

// One place answers "what is this user's Discord?", and it answers from
// `OAuthAccount`. Registration, recruitment and the leaderboard all route
// through here, so the cases below are the ones that decide whether a captain
// can submit a roster and whether a coach shows up as reachable.
const load = ({ findFirst, findMany } = {}) => {
  const calls = [];
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        oAuthAccount: {
          findFirst: async (args) => {
            calls.push({ operation: "findFirst", args });
            return findFirst ? findFirst(args) : null;
          },
          findMany: async (args) => {
            calls.push({ operation: "findMany", args });
            return findMany ? findMany(args) : [];
          },
        },
      },
    },
  });

  return { service, restore, calls };
};

test("a linked account resolves to its snowflake and cached username", async () => {
  const { service, restore, calls } = load({
    findFirst: () => ({
      providerUserId: "900000000000000001",
      user: { discordTag: "questcaptain" },
    }),
  });

  try {
    assert.deepEqual(await service.getLinkedDiscord("user-1"), {
      discordId: "900000000000000001",
      discordUsername: "questcaptain",
    });
    // Only the Discord provider counts. A Google link is still an OAuthAccount
    // row, and matching it here would report an unreachable player as reachable.
    assert.deepEqual(calls[0].args.where, {
      userId: "user-1",
      provider: "discord",
    });
  } finally { restore(); }
});

test("a missing cached username still resolves, with an empty name", async () => {
  // The snowflake is the identity; the name is a display snapshot that can be
  // absent. Refusing to resolve here would block a linked player over a
  // cosmetic field.
  const { service, restore } = load({
    findFirst: () => ({ providerUserId: "900000000000000002", user: null }),
  });

  try {
    assert.deepEqual(await service.getLinkedDiscord("user-2"), {
      discordId: "900000000000000002",
      discordUsername: "",
    });
  } finally { restore(); }
});

test("an unlinked user resolves to null without inventing a handle", async () => {
  const { service, restore } = load();

  try {
    assert.equal(await service.getLinkedDiscord("user-3"), null);
  } finally { restore(); }
});

test("a blank user id never reaches the database", async () => {
  const { service, restore, calls } = load();

  try {
    assert.equal(await service.getLinkedDiscord(""), null);
    assert.equal(await service.getLinkedDiscord(null), null);
    assert.equal(await service.getLinkedDiscord("   "), null);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test("requireLinkedDiscord raises a typed 403 the client can act on", async () => {
  const { service, restore } = load();

  try {
    await assert.rejects(
      () => service.requireLinkedDiscord("user-4", "Connect Discord before registering."),
      (error) => {
        // The code is what lets a client route the user into the connect flow
        // instead of showing a generic permission error.
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, "DISCORD_LINK_REQUIRED");
        assert.equal(error.message, "Connect Discord before registering.");
        return true;
      },
    );
  } finally { restore(); }
});

test("requireLinkedDiscord returns the identity when the link exists", async () => {
  const { service, restore } = load({
    findFirst: () => ({
      providerUserId: "900000000000000005",
      user: { discordTag: "coach" },
    }),
  });

  try {
    assert.deepEqual(await service.requireLinkedDiscord("user-5"), {
      discordId: "900000000000000005",
      discordUsername: "coach",
    });
  } finally { restore(); }
});

test("roster resolution reads every member in one query", async () => {
  const { service, restore, calls } = load({
    findMany: () => [
      {
        userId: "user-a",
        providerUserId: "900000000000000010",
        user: { discordTag: "player-a" },
      },
    ],
  });

  try {
    const linked = await service.getLinkedDiscordForUsers([
      "user-a",
      "user-b",
      // Duplicates and blanks come straight off a roster and must not turn into
      // extra round trips or an `in: [""]` that matches nothing usefully.
      "user-a",
      "",
      null,
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.where.userId, { in: ["user-a", "user-b"] });
    assert.deepEqual(linked.get("user-a"), {
      discordId: "900000000000000010",
      discordUsername: "player-a",
    });
    // An unlinked member is simply absent. Callers treat that as "no handle",
    // which is a normal roster state rather than an error.
    assert.equal(linked.has("user-b"), false);
  } finally { restore(); }
});

test("an empty roster never reaches the database", async () => {
  const { service, restore, calls } = load();

  try {
    assert.equal((await service.getLinkedDiscordForUsers([])).size, 0);
    assert.equal((await service.getLinkedDiscordForUsers(null)).size, 0);
    assert.equal((await service.getLinkedDiscordForUsers(["", null])).size, 0);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});
