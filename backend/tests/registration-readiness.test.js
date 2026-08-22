const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/registration-readiness.service.js",
);
const gameAccountServicePath = path.join(
  __dirname,
  "../src/modules/game-accounts/game-account.service.js",
);
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260823130000_add_player_links_to_rosters/migration.sql",
);

const fs = require("node:fs");
const rosterMigration = fs.readFileSync(migrationPath, "utf8");

const withAccount = (overrides = {}) => ({
  player: {
    gameAccounts: [
      {
        id: "account-1",
        game: "valorant",
        username: "Russel",
        tagline: "1234",
        region: "ap",
        verificationStatus: "user_confirmed",
        status: "active",
        linkedAt: new Date(),
        verifiedAt: null,
        lastSyncedAt: null,
      },
    ],
  },
  ...overrides,
});

const member = (overrides = {}) => ({
  id: "member-1",
  name: "Player One",
  role: "PLAYER",
  memberOrder: 1,
  userId: "user-2",
  riotId: null,
  inviteStatus: "accepted",
  player: null,
  ...overrides,
});

const CAPTAIN = { id: "captain-1", role: "user" };

const loadService = ({ team, tournament = null } = {}) =>
  loadModuleWithMocks(servicePath, {
    [gameAccountServicePath]: {
      publicView: (account) => ({ id: account.id, status: account.status }),
      VALORANT: "valorant",
    },
    [prismaPath]: {
      prisma: {
        savedTeam: { findUnique: async () => team },
        tournament: { findUnique: async () => tournament },
      },
    },
  });

const baseTeam = (members) => ({
  id: "team-1",
  name: "Example Team",
  captainUserId: CAPTAIN.id,
  game: "valorant",
  members,
});

const valorantTournament = (overrides = {}) => ({
  id: "tournament-1",
  game: "VALORANT",
  minRosterSize: 5,
  maxRosterSize: 7,
  ...overrides,
});

test("a fully linked roster is ready", async () => {
  const members = Array.from({ length: 5 }, (_, index) =>
    member({ id: `member-${index}`, memberOrder: index, player: withAccount().player }),
  );
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament(),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.ready, true);
    assert.ok(result.requirements.every((requirement) => requirement.status === "PASS"));
  } finally {
    restore();
  }
});

test("one unlinked player blocks the whole roster and is named", async () => {
  const members = [
    ...Array.from({ length: 4 }, (_, index) =>
      member({ id: `ok-${index}`, memberOrder: index, player: withAccount().player }),
    ),
    member({ id: "missing-1", memberOrder: 4, player: null }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament(),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.ready, false);
    const accounts = result.requirements.find((r) => r.type === "PLAYER_GAME_ACCOUNTS");
    assert.equal(accounts.status, "FAIL");
    // The captain has to know WHICH player to chase, not just that something
    // is wrong.
    assert.deepEqual(accounts.members, ["missing-1"]);
  } finally {
    restore();
  }
});

test("a pending invite is not a player", async () => {
  const members = [
    ...Array.from({ length: 4 }, (_, index) =>
      member({ id: `ok-${index}`, memberOrder: index, player: withAccount().player }),
    ),
    member({ id: "pending-1", memberOrder: 4, inviteStatus: "pending", player: withAccount().player }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament(),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.ready, false);
    const invites = result.requirements.find((r) => r.type === "INVITES_ACCEPTED");
    assert.equal(invites.status, "FAIL");
    // It must also not count toward the roster minimum.
    const size = result.requirements.find((r) => r.type === "ROSTER_SIZE");
    assert.equal(size.actual, 4);
    assert.equal(size.status, "FAIL");
  } finally {
    restore();
  }
});

test("a coach is on the roster but is never asked for a game account", async () => {
  const members = [
    ...Array.from({ length: 5 }, (_, index) =>
      member({ id: `ok-${index}`, memberOrder: index, player: withAccount().player }),
    ),
    member({ id: "coach-1", role: "COACH", memberOrder: 5, player: null }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament(),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    // A coach does not play, so requiring an account from them would block
    // real teams; they also do not fill a roster slot.
    assert.equal(result.ready, true);
    const coach = result.members.find((entry) => entry.id === "coach-1");
    assert.equal(coach.requiresGameAccount, false);
    assert.equal(result.requirements.find((r) => r.type === "ROSTER_SIZE").actual, 5);
  } finally {
    restore();
  }
});

test("a legacy typed Riot ID is shown but never satisfies the requirement", async () => {
  const members = [
    member({ id: "legacy-1", riotId: "Someone#0000", player: null }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1 }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    const entry = result.members[0];
    assert.equal(entry.legacyRiotId, "Someone#0000");
    // It was typed by a human and never checked against anything. Treating it
    // as a linked account is exactly the problem this work exists to fix.
    assert.equal(entry.ready, false);
    assert.equal(result.ready, false);
  } finally {
    restore();
  }
});

test("a title with no adapter imposes no game-account requirement", async () => {
  const members = [member({ id: "m-1", player: null })];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ game: "Call of Duty Mobile", minRosterSize: 1 }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    // Blocking registration on a check Quest cannot perform would break every
    // non-VALORANT tournament.
    assert.equal(result.requiredGame, null);
    assert.equal(result.requirements.some((r) => r.type === "PLAYER_GAME_ACCOUNTS"), false);
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

test("a locked account still counts as linked", async () => {
  const account = withAccount().player.gameAccounts[0];
  const members = [
    member({ id: "m-1", player: { gameAccounts: [{ ...account, status: "locked" }] } }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1 }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    // Locked means "committed to a tournament", not "unusable".
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

test("only the captain or an admin can read roster readiness", async (t) => {
  const members = [member({ id: "m-1", player: withAccount().player })];

  await t.test("another player is refused", async () => {
    const { module: service, restore } = loadService({ team: baseTeam(members) });
    try {
      await assert.rejects(
        () =>
          service.getRegistrationReadiness({
            teamId: "team-1",
            tournamentId: null,
            user: { id: "someone-else", role: "user" },
          }),
        (error) => error.statusCode === 403,
      );
    } finally {
      restore();
    }
  });

  await t.test("an admin is allowed", async () => {
    const { module: service, restore } = loadService({ team: baseTeam(members) });
    try {
      const result = await service.getRegistrationReadiness({
        teamId: "team-1",
        tournamentId: null,
        user: { id: "admin-1", role: "admin" },
      });
      assert.equal(result.teamId, "team-1");
    } finally {
      restore();
    }
  });
});

test("a missing team or tournament is a 404, not a silent pass", async (t) => {
  await t.test("team", async () => {
    const { module: service, restore } = loadService({ team: null });
    try {
      await assert.rejects(
        () =>
          service.getRegistrationReadiness({ teamId: "nope", tournamentId: null, user: CAPTAIN }),
        (error) => error.statusCode === 404,
      );
    } finally {
      restore();
    }
  });

  await t.test("tournament", async () => {
    const { module: service, restore } = loadService({
      team: baseTeam([member()]),
      tournament: null,
    });
    try {
      await assert.rejects(
        () =>
          service.getRegistrationReadiness({
            teamId: "team-1",
            tournamentId: "missing",
            user: CAPTAIN,
          }),
        (error) => error.statusCode === 404,
      );
    } finally {
      restore();
    }
  });
});

test("readiness never leaks a stable identifier to the captain", async () => {
  const members = [member({ id: "m-1", player: withAccount().player })];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1 }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    // A captain needs to know a teammate is ready, not their durable
    // cross-service handle.
    assert.doesNotMatch(JSON.stringify(result), /puuid|externalId/i);
  } finally {
    restore();
  }
});

test("the roster-link migration preserves every legacy identity column", () => {
  const statements = rosterMigration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(statements, /ALTER TABLE "saved_team_members" ADD COLUMN "player_id" UUID/);
  assert.match(statements, /ALTER TABLE "registration_members" ADD COLUMN "player_id" UUID/);

  // Roster history is sensitive. Nothing may be dropped, rewritten, or
  // probabilistically backfilled inside a migration.
  assert.doesNotMatch(statements, /DROP COLUMN|DROP TABLE|TRUNCATE/i);
  assert.doesNotMatch(statements, /^\s*(UPDATE|INSERT)\s+/im);
  assert.doesNotMatch(statements, /riot_id/);

  // Deleting a player must never delete roster or registration history.
  const foreignKeys = statements.match(/player_id_fkey[\s\S]*?ON DELETE (\w+ ?\w*)/g) || [];
  assert.equal(foreignKeys.length, 2);
  for (const clause of foreignKeys) {
    assert.match(clause, /ON DELETE SET NULL/);
  }
});
