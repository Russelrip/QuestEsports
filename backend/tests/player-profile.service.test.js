const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/players/player-profile.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

// Captures the `select` the service asks Prisma for, so the tests can assert on
// what is REQUESTED, not only on what happens to be returned. A projection that
// filters sensitive fields after fetching them is one refactor away from
// leaking; not selecting them is the actual guarantee.
const load = (player, capture = {}) => {
  const prisma = {
    player: {
      findUnique: async (args) => {
        capture.args = args;
        return player;
      },
    },
  };
  return loadModuleWithMocks(servicePath, { [prismaModulePath]: { prisma } });
};

const publishedTournament = (over = {}) => ({
  slug: "lus-sep",
  title: "Level Up Series",
  game: "valorant",
  startDate: new Date("2026-09-19"),
  status: "completed",
  isPublished: true,
  gameRef: { slug: "valorant" },
  ...over,
});

const basePlayer = (over = {}) => ({
  publicId: "QPID-000006",
  displayName: "Russel",
  createdAt: new Date("2026-01-01"),
  gameAccounts: [
    {
      game: "valorant",
      username: "Russel",
      tagline: "LK1",
      region: "ap",
      verificationStatus: "user_confirmed",
    },
  ],
  discordIdentity: { id: "di-1" },
  savedTeamMembers: [
    { role: "CAPTAIN", team: { name: "Team QUEST", teamTag: "QST", game: "valorant" } },
  ],
  registrationMembers: [
    {
      role: "PLAYER",
      usernameSnapshot: "OldName",
      tagSnapshot: "OLD",
      registration: {
        teamName: "Team QUEST",
        status: "approved",
        tournament: publishedTournament(),
      },
    },
  ],
  ...over,
});

test("profile exposes competitive identity and nothing else", async () => {
  const { module: service, restore } = load(basePlayer());
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.publicId, "QPID-000006");
    assert.equal(profile.displayName, "Russel");
    assert.equal(profile.gameAccounts[0].username, "Russel");
    assert.equal(profile.teams[0].name, "Team QUEST");

    // Nothing personally identifying anywhere in the payload.
    const serialized = JSON.stringify(profile);
    for (const leak of ["@", "email", "phone", "userId", "user_id", "puuid", "externalId"]) {
      assert.ok(!serialized.includes(leak), `profile leaked ${leak}`);
    }
  } finally {
    restore();
  }
});

// A snowflake links a Quest player to an account outside Quest. "Reachable on
// Discord" is the useful public fact; the ID is not.
test("Discord is reported as presence, never as an ID", async () => {
  const capture = {};
  const { module: service, restore } = load(basePlayer(), capture);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.discordLinked, true);
    assert.equal(profile.discordUserId, undefined);
    assert.ok(!JSON.stringify(profile).includes("discordUserId"));
    // And the snowflake is never even selected.
    const selected = capture.args.select.discordIdentity.select;
    assert.deepEqual(Object.keys(selected), ["id"]);
  } finally {
    restore();
  }
});

// The PUUID is a stable cross-service key; the audit policy already treats it
// as sensitive, so the profile must not select it at all.
test("the PUUID is never selected from game accounts", async () => {
  const capture = {};
  const { module: service, restore } = load(basePlayer(), capture);
  try {
    await service.getPublicProfile("QPID-000006");
    const selected = Object.keys(capture.args.select.gameAccounts.select);
    assert.ok(!selected.includes("externalId"));
    assert.deepEqual(selected.sort(), [
      "game", "region", "tagline", "username", "verificationStatus",
    ]);
  } finally {
    restore();
  }
});

test("registration email, phone and invite tokens are never selected", async () => {
  const capture = {};
  const { module: service, restore } = load(basePlayer(), capture);
  try {
    await service.getPublicProfile("QPID-000006");
    const member = capture.args.select.registrationMembers.select;
    for (const field of ["email", "phone", "emailNormalized", "inviteTokenHash", "discord", "riotId"]) {
      assert.ok(!(field in member), `registration ${field} must not be selected`);
    }
  } finally {
    restore();
  }
});

// An unpublished event is staff-only. Leaking one through a player's history
// is a disclosure nobody would think to look for.
test("unpublished tournaments never appear", async () => {
  const player = basePlayer({
    registrationMembers: [
      {
        role: "PLAYER",
        registration: {
          teamName: "T",
          status: "approved",
          tournament: publishedTournament({ isPublished: false, slug: "secret-event" }),
        },
      },
    ],
  });
  const { module: service, restore } = load(player);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.tournaments.length, 0);
    assert.ok(!JSON.stringify(profile).includes("secret-event"));
  } finally {
    restore();
  }
});

test("only approved registrations count as history", async () => {
  const player = basePlayer({
    registrationMembers: ["pending", "rejected", "waitlisted", "approved"].map((status) => ({
      role: "PLAYER",
      registration: { teamName: "T", status, tournament: publishedTournament() },
    })),
  });
  const { module: service, restore } = load(player);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.tournaments.length, 1);
    assert.equal(profile.stats.tournamentsPlayed, 1);
  } finally {
    restore();
  }
});

// Coaching an event is real, but it is not "tournaments played".
test("a coached event is not counted as played", async () => {
  const player = basePlayer({
    registrationMembers: [
      { role: "COACH", registration: { teamName: "T", status: "approved", tournament: publishedTournament() } },
      { role: "SUBSTITUTE", registration: { teamName: "T", status: "approved", tournament: publishedTournament({ slug: "other" }) } },
    ],
  });
  const { module: service, restore } = load(player);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.deepEqual(profile.tournaments.map((t) => t.tournamentSlug), ["other"]);
  } finally {
    restore();
  }
});

// The frozen snapshot is the point: a later rename must not rewrite history.
test("history shows the name committed at the time, not today's", async () => {
  const { module: service, restore } = load(basePlayer());
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.deepEqual(profile.tournaments[0].playedAs, {
      username: "OldName",
      tagline: "OLD",
    });
    // The live account still reads as the current name.
    assert.equal(profile.gameAccounts[0].username, "Russel");
  } finally {
    restore();
  }
});

test("a row predating snapshots reports null rather than guessing", async () => {
  const player = basePlayer({
    registrationMembers: [
      {
        role: "PLAYER",
        usernameSnapshot: null,
        tagSnapshot: null,
        registration: { teamName: "T", status: "approved", tournament: publishedTournament() },
      },
    ],
  });
  const { module: service, restore } = load(player);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.tournaments[0].playedAs, null);
  } finally {
    restore();
  }
});

test("multi-game stats count distinct titles actually competed in", async () => {
  const player = basePlayer({
    registrationMembers: [
      { role: "PLAYER", registration: { teamName: "T", status: "approved", tournament: publishedTournament({ gameRef: { slug: "valorant" } }) } },
      { role: "PLAYER", registration: { teamName: "T", status: "approved", tournament: publishedTournament({ slug: "b", gameRef: { slug: "valorant" } }) } },
      { role: "PLAYER", registration: { teamName: "T", status: "approved", tournament: publishedTournament({ slug: "c", gameRef: { slug: "codm" } }) } },
    ],
  });
  const { module: service, restore } = load(player);
  try {
    const profile = await service.getPublicProfile("QPID-000006");
    assert.equal(profile.stats.tournamentsPlayed, 3);
    assert.equal(profile.stats.gamesPlayed, 2);
  } finally {
    restore();
  }
});

test("lookup is case-insensitive and trimmed", async () => {
  const capture = {};
  const { module: service, restore } = load(basePlayer(), capture);
  try {
    await service.getPublicProfile("  qpid-000006 ");
    assert.equal(capture.args.where.publicId, "QPID-000006");
  } finally {
    restore();
  }
});

test("an unknown or malformed id returns null rather than throwing", async () => {
  const { module: service, restore } = load(null);
  try {
    assert.equal(await service.getPublicProfile("QPID-999999"), null);
    assert.equal(await service.getPublicProfile(""), null);
    assert.equal(await service.getPublicProfile(null), null);
    assert.equal(await service.getPublicProfile(42), null);
  } finally {
    restore();
  }
});

test("only active game accounts are shown", async () => {
  const capture = {};
  const { module: service, restore } = load(basePlayer(), capture);
  try {
    await service.getPublicProfile("QPID-000006");
    assert.deepEqual(capture.args.select.gameAccounts.where, { status: "active" });
  } finally {
    restore();
  }
});
