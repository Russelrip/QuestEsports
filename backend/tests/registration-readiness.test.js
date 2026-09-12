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
  // A linked Discord identity lives on OAuthAccount, never on the mutable
  // User.discordTag.
  user: { oauthAccounts: [{ id: "oauth-1" }] },
  ...overrides,
});

const withoutDiscord = (overrides = {}) =>
  member({ user: { oauthAccounts: [] }, ...overrides });

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

test("an unlinked player does not block the roster", async () => {
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
    // Connecting Riot is each player's own act, for the leaderboard and the
    // approval snapshot. A captain cannot do it for them, so holding the whole
    // registration on it kept real teams out of events.
    assert.equal(result.ready, true);
    assert.equal(
      result.requirements.some((r) => r.type === "PLAYER_GAME_ACCOUNTS"),
      false,
    );
    const unlinked = result.members.find((entry) => entry.id === "missing-1");
    assert.equal(unlinked.gameAccount, null);
    assert.equal(unlinked.ready, true);
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

test("a coach is on the roster but does not fill a slot", async () => {
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
    // A coach does not play, so they must not be counted toward the minimum
    // the five players already meet.
    assert.equal(result.ready, true);
    assert.equal(result.requirements.find((r) => r.type === "ROSTER_SIZE").actual, 5);
  } finally {
    restore();
  }
});

test("a typed Riot ID is reported for what it is", async () => {
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
    // Typed by a human and never checked against anything, so it is surfaced
    // as text and never as a linked account.
    assert.equal(entry.legacyRiotId, "Someone#0000");
    assert.equal(entry.gameAccount, null);
    assert.equal(entry.ready, true);
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

test("a title with no adapter reports no tracked game", async () => {
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
    // There is nothing to show and nothing to snapshot for a title Quest has
    // no adapter for.
    assert.equal(result.game, null);
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
    // Locked means "committed to a tournament", not "unusable", so it is still
    // the account shown for that player.
    assert.equal(result.ready, true);
    assert.equal(result.members[0].gameAccount.status, "locked");
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


test("Discord status is reported even when a tournament does not require it", async () => {
  const members = [withoutDiscord({ id: "m-1", player: withAccount().player })];
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
    // A captain should always be able to see who is reachable, whether or not
    // this particular event insists on it.
    assert.equal(result.members[0].hasDiscord, false);
    assert.equal(result.discordRequired, false);
    assert.equal(result.requirements.some((r) => r.type === "DISCORD_CONNECTED"), false);
    // And it must not block.
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

test("a tournament that requires Discord blocks and names who is missing it", async () => {
  const members = [
    member({ id: "ok-1", player: withAccount().player }),
    withoutDiscord({ id: "missing-1", memberOrder: 2, player: withAccount().player }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1, discordRequired: true }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.discordRequired, true);
    const requirement = result.requirements.find((r) => r.type === "DISCORD_CONNECTED");
    assert.equal(requirement.status, "FAIL");
    assert.deepEqual(requirement.members, ["missing-1"]);
    assert.equal(result.ready, false);
  } finally {
    restore();
  }
});

test("a coach must be reachable too when Discord is required", async () => {
  const members = [
    member({ id: "ok-1", player: withAccount().player }),
    withoutDiscord({ id: "coach-1", role: "COACH", memberOrder: 5 }),
  ];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1, discordRequired: true }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    // Unlike a game account, this is about being contactable during the event
    // — a coach needs that as much as a player.
    const requirement = result.requirements.find((r) => r.type === "DISCORD_CONNECTED");
    assert.deepEqual(requirement.members, ["coach-1"]);
    assert.equal(result.ready, false);
  } finally {
    restore();
  }
});

test("a fully connected roster passes the Discord requirement", async () => {
  const members = [member({ id: "ok-1", player: withAccount().player })];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    tournament: valorantTournament({ minRosterSize: 1, discordRequired: true }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.requirements.find((r) => r.type === "DISCORD_CONNECTED").status, "PASS");
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

test("existing tournaments are unaffected by the new setting", async () => {
  const members = [withoutDiscord({ id: "m-1", player: withAccount().player })];
  const { module: service, restore } = loadService({
    team: baseTeam(members),
    // A tournament row created before the column existed reads as false.
    tournament: valorantTournament({ minRosterSize: 1, discordRequired: undefined }),
  });
  try {
    const result = await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
    assert.equal(result.discordRequired, false);
    assert.equal(result.ready, true);
  } finally {
    restore();
  }
});

// --- Roster limits count active players and substitutes separately ---------
//
// A 5v5 carrying one substitute is six people, and the old check compared that
// six against `maxRosterSize` and failed a legal roster. `maxRosterSize` sizes
// the ACTIVE lineup and `maxSubstitutes` sizes the bench, which is how the
// registration form has always scored a fresh entry. These pin the saved-team
// path to the same rule.

const fiveVFive = (overrides = {}) =>
  valorantTournament({ minRosterSize: 5, maxRosterSize: 5, maxSubstitutes: 2, ...overrides });

const roster = ({ players, substitutes = 0 }) => [
  member({ id: "captain-member", role: "CAPTAIN", memberOrder: 0, player: withAccount().player }),
  ...Array.from({ length: players }, (_, index) =>
    member({ id: `player-${index}`, role: "PLAYER", memberOrder: index + 1, player: withAccount().player }),
  ),
  ...Array.from({ length: substitutes }, (_, index) =>
    member({ id: `sub-${index}`, role: "SUBSTITUTE", memberOrder: players + 1 + index, player: withAccount().player }),
  ),
];

const readiness = async (team, tournament) => {
  const { module: service, restore } = loadService({ team: baseTeam(team), tournament });
  try {
    return await service.getRegistrationReadiness({
      teamId: "team-1",
      tournamentId: "tournament-1",
      user: CAPTAIN,
    });
  } finally {
    restore();
  }
};

const requirement = (result, type) => result.requirements.find((item) => item.type === type);

test("a 5v5 roster carrying a substitute is ready", async () => {
  // Captain + 4 players is the five active; the substitute sits on the bench
  // within maxSubstitutes. This is the roster that reported "1 requirement
  // still to sort out" with every member marked Ready.
  const result = await readiness(roster({ players: 4, substitutes: 1 }), fiveVFive());
  assert.equal(requirement(result, "ROSTER_SIZE").actual, 5);
  assert.equal(requirement(result, "ROSTER_SIZE").status, "PASS");
  assert.equal(requirement(result, "SUBSTITUTE_LIMIT").actual, 1);
  assert.equal(requirement(result, "SUBSTITUTE_LIMIT").status, "PASS");
  assert.equal(result.ready, true);
});

test("a substitute does not fill an empty playing slot", async () => {
  // Four active plus a sub is five people but cannot field five, so the
  // minimum must fail. The old lumped count called this ready.
  const result = await readiness(roster({ players: 3, substitutes: 1 }), fiveVFive());
  const size = requirement(result, "ROSTER_SIZE");
  assert.equal(size.actual, 4);
  assert.equal(size.status, "FAIL");
  assert.equal(result.ready, false);
});

test("one substitute too many fails the substitute limit, not the roster size", async () => {
  const result = await readiness(
    roster({ players: 4, substitutes: 2 }),
    fiveVFive({ maxSubstitutes: 1 }),
  );
  assert.equal(requirement(result, "ROSTER_SIZE").status, "PASS");
  const subs = requirement(result, "SUBSTITUTE_LIMIT");
  assert.equal(subs.status, "FAIL");
  assert.equal(subs.actual, 2);
  assert.equal(subs.maximum, 1);
});

test("too many active players fails the roster maximum", async () => {
  const result = await readiness(roster({ players: 5 }), fiveVFive());
  const size = requirement(result, "ROSTER_SIZE");
  assert.equal(size.status, "FAIL");
  assert.equal(size.actual, 6);
  assert.equal(size.maximum, 5);
});

test("a tournament with no substitute allowance rejects a bench", async () => {
  const result = await readiness(
    roster({ players: 4, substitutes: 1 }),
    fiveVFive({ maxSubstitutes: 0 }),
  );
  assert.equal(requirement(result, "ROSTER_SIZE").status, "PASS");
  assert.equal(requirement(result, "SUBSTITUTE_LIMIT").status, "FAIL");
  assert.equal(result.ready, false);
});
