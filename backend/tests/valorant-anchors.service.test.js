const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/valorant/valorant-anchors.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

const load = ({ tournament = null, registrations = [], matches = [] } = {}, capture = {}) => {
  const prisma = {
    tournament: {
      findUnique: async (args) => {
        capture.tournament = args;
        return tournament;
      },
    },
    teamRegistration: {
      findMany: async (args) => {
        capture.registrations = args;
        return registrations;
      },
    },
    match: {
      findMany: async (args) => {
        capture.matches = args;
        return matches;
      },
    },
  };
  return loadModuleWithMocks(servicePath, { [prismaModulePath]: { prisma } });
};

const member = (over = {}) => ({
  name: "Quester",
  role: "PLAYER",
  memberOrder: 1,
  riotId: null,
  usernameSnapshot: null,
  tagSnapshot: null,
  externalIdSnapshot: null,
  verificationStatusSnapshot: null,
  player: null,
  ...over,
});

const registration = (over = {}) => ({
  id: "reg-a",
  teamName: "Quest Alpha",
  members: [member()],
  ...over,
});

const theTournament = { id: "t-1", slug: "cup", title: "Cup", startDate: new Date("2026-08-01"), endDate: null };

test("a roster snapshot is preferred over every other anchor source", () => {
  const { module: service, restore } = load();
  try {
    const anchors = service.memberAnchors(member({
      usernameSnapshot: "Committed",
      tagSnapshot: "QST",
      externalIdSnapshot: "puuid-1",
      riotId: "Typed#OLD",
      player: { gameAccounts: [{ username: "RenamedToday", tagline: "NEW", externalId: "puuid-1", verificationStatus: "resolved" }] },
    }));
    // The snapshot is what this team actually committed to this tournament and
    // a later rename cannot rewrite it.
    assert.equal(anchors[0].source, "snapshot");
    assert.equal(anchors[0].riotId, "Committed#QST");
    assert.deepEqual(anchors.map((a) => a.source), ["snapshot", "game_account", "legacy_text"]);
  } finally {
    restore();
  }
});

test("a live account is used when no snapshot exists", () => {
  const { module: service, restore } = load();
  try {
    const anchors = service.memberAnchors(member({
      player: { gameAccounts: [{ username: "Live", tagline: "EU", externalId: "puuid-2", verificationStatus: "resolved" }] },
    }));
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].source, "game_account");
    assert.equal(anchors[0].riotId, "Live#EU");
  } finally {
    restore();
  }
});

test("an unchanged name is not offered twice", () => {
  const { module: service, restore } = load();
  try {
    const anchors = service.memberAnchors(member({
      usernameSnapshot: "Same",
      tagSnapshot: "QST",
      player: { gameAccounts: [{ username: "Same", tagline: "QST", externalId: "p", verificationStatus: "resolved" }] },
    }));
    assert.equal(anchors.length, 1);
  } finally {
    restore();
  }
});

test("free text is accepted only when it already looks like a Riot ID", () => {
  const { module: service, restore } = load();
  try {
    assert.equal(service.parseLegacyRiotId("Player#NA1"), "Player#NA1");
    assert.equal(service.parseLegacyRiotId("  Spaced#EU  "), "Spaced#EU");
    // A note to a human is not an identifier.
    assert.equal(service.parseLegacyRiotId("ask captain"), null);
    assert.equal(service.parseLegacyRiotId("NoTag#"), null);
    assert.equal(service.parseLegacyRiotId(null), null);
  } finally {
    restore();
  }
});

test("a coach is never used as an anchor", () => {
  const { module: service, restore } = load();
  try {
    const team = service.registrationAnchors(registration({
      members: [
        member({ name: "Coach", role: "COACH", memberOrder: 1, usernameSnapshot: "Coach", tagSnapshot: "C" }),
        member({ name: "Starter", role: "PLAYER", memberOrder: 2, usernameSnapshot: "Starter", tagSnapshot: "S" }),
      ],
    }));
    // A coach is on the roster and was not in the lobby, so searching by one
    // asks about a match they never played.
    assert.deepEqual(team.anchors.map((a) => a.memberName), ["Starter"]);
  } finally {
    restore();
  }
});

test("deriveTournamentAnchors reads approved registrations only, and names the teams it cannot anchor", async () => {
  const capture = {};
  const { module: service, restore } = load({
    tournament: theTournament,
    registrations: [
      registration({ id: "reg-a", teamName: "Anchored", members: [member({ usernameSnapshot: "A", tagSnapshot: "1" })] }),
      registration({ id: "reg-b", teamName: "Rosterless", members: [] }),
    ],
  }, capture);
  try {
    const derived = await service.deriveTournamentAnchors("t-1");
    // A pending entry is not yet a fact; a rejected one never played.
    assert.equal(capture.registrations.where.status, "approved");
    assert.equal(capture.registrations.where.tournamentId, "t-1");
    assert.equal(derived.teams[0].anchorSource, "snapshot");
    assert.equal(derived.teams[1].anchorSource, null);
    // Named, not silently dropped: an admin must know which half of the bracket
    // automation cannot see.
    assert.deepEqual(derived.unanchored, ["Rosterless"]);
  } finally {
    restore();
  }
});

test("deriveTournamentAnchors returns nothing for a tournament that does not exist", async () => {
  const { module: service, restore } = load({ tournament: null });
  try {
    assert.equal(await service.deriveTournamentAnchors("missing"), null);
    assert.equal(await service.deriveTournamentAnchors(""), null);
  } finally {
    restore();
  }
});

test("fixtures pair teams from the bracket and mark the searchable ones ready", async () => {
  const { module: service, restore } = load({
    tournament: theTournament,
    registrations: [
      registration({ id: "reg-a", teamName: "Alpha", members: [member({ name: "A1", usernameSnapshot: "A", tagSnapshot: "1" })] }),
      registration({ id: "reg-b", teamName: "Bravo", members: [member({ name: "B1", usernameSnapshot: "B", tagSnapshot: "2" })] }),
    ],
    matches: [{
      id: "match-1", identifier: "QF1", roundNumber: 1, status: "completed",
      scheduledAt: null, completedAt: null,
      participants: [
        { slot: 1, registrationId: "reg-a", displayName: "Alpha" },
        { slot: 2, registrationId: "reg-b", displayName: "Bravo" },
      ],
    }],
  });
  try {
    const derived = await service.deriveTournamentFixtures("t-1");
    const [fixture] = derived.fixtures;
    assert.equal(fixture.ready, true);
    assert.equal(fixture.blockedReason, null);
    assert.deepEqual(derived.summary, { total: 1, ready: 1, blocked: 0 });
    assert.deepEqual(service.fixtureAnchorPair(fixture), { playerA: "A#1", playerB: "B#2" });
  } finally {
    restore();
  }
});

test("a fixture states why it cannot be searched rather than disappearing", async () => {
  const { module: service, restore } = load({
    tournament: theTournament,
    registrations: [
      registration({ id: "reg-a", teamName: "Alpha", members: [member({ usernameSnapshot: "A", tagSnapshot: "1" })] }),
      registration({ id: "reg-c", teamName: "NoAnchor", members: [] }),
    ],
    matches: [
      { id: "m-bye", identifier: "R1", roundNumber: 1, status: "not_scheduled", scheduledAt: null, completedAt: null,
        participants: [{ slot: 1, registrationId: "reg-a", displayName: "Alpha" }] },
      { id: "m-unlinked", identifier: "R2", roundNumber: 1, status: "not_scheduled", scheduledAt: null, completedAt: null,
        participants: [
          { slot: 1, registrationId: "reg-a", displayName: "Alpha" },
          { slot: 2, registrationId: null, displayName: "TBD" },
        ] },
      { id: "m-noanchor", identifier: "R3", roundNumber: 1, status: "not_scheduled", scheduledAt: null, completedAt: null,
        participants: [
          { slot: 1, registrationId: "reg-a", displayName: "Alpha" },
          { slot: 2, registrationId: "reg-c", displayName: "NoAnchor" },
        ] },
    ],
  });
  try {
    const derived = await service.deriveTournamentFixtures("t-1");
    assert.deepEqual(
      derived.fixtures.map((fixture) => fixture.blockedReason),
      ["fixture_has_no_opponent_pair", "participant_not_linked_to_registration", "team_has_no_derivable_anchor"],
    );
    assert.deepEqual(derived.summary, { total: 3, ready: 0, blocked: 3 });
  } finally {
    restore();
  }
});

test("fixtureAnchorPair refuses a half-known pair", async () => {
  const { module: service, restore } = load();
  try {
    // One real anchor and one guess answers "did this player play", which is a
    // different and much worse question than "did these two teams play".
    assert.equal(service.fixtureAnchorPair(null), null);
    assert.equal(service.fixtureAnchorPair({ ready: false, sides: [] }), null);
    assert.equal(
      service.fixtureAnchorPair({ ready: true, sides: [{ anchor: { riotId: "A#1" } }] }),
      null,
    );
  } finally {
    restore();
  }
});

test("a derived anchor parses into the { name, tag } shape discover requires", () => {
  const { module: service, restore } = load();
  const { parseRiotId } = require("../src/modules/valorant/valorant.validation");
  try {
    const fixture = {
      ready: true,
      sides: [
        { anchor: { riotId: "Logger#lh44" } },
        { anchor: { riotId: "Dimeth#short" } },
      ],
    };
    const pair = service.fixtureAnchorPair(fixture);

    // Anchors are carried as the display string, because that is what a roster
    // snapshot stores and what an admin reads. `discover` takes { name, tag },
    // and handing it the string fails every call with "Invalid Riot ID" — which
    // is exactly what the first real call to the fixture endpoint did. The
    // controller parses at the boundary; this asserts the strings it produces
    // can actually survive that parse.
    assert.deepEqual(parseRiotId(pair.playerA), { name: "Logger", tag: "lh44" });
    assert.deepEqual(parseRiotId(pair.playerB), { name: "Dimeth", tag: "short" });
  } finally {
    restore();
  }
});

test("an anchor built from a snapshot round-trips through the Riot ID parser", () => {
  const { module: service, restore } = load();
  const { parseRiotId } = require("../src/modules/valorant/valorant.validation");
  try {
    const [anchor] = service.memberAnchors({
      name: "Quester",
      role: "PLAYER",
      memberOrder: 1,
      riotId: null,
      usernameSnapshot: "Logger",
      tagSnapshot: "lh44",
      externalIdSnapshot: null,
      verificationStatusSnapshot: null,
      player: null,
    });
    assert.deepEqual(parseRiotId(anchor.riotId), { name: "Logger", tag: "lh44" });
  } finally {
    restore();
  }
});
