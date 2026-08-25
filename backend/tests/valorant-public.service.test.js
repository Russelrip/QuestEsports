const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/valorant/valorant-public.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");

// Captures the `select` the service asks Prisma for, so the tests can assert on
// what is REQUESTED, not only on what comes back. A projection that fetches the
// PUUID and strips it afterwards is one refactor from leaking it; not selecting
// it is the actual guarantee. Same discipline as
// tests/player-profile.service.test.js.
const load = ({ series = null, seriesList = [], tournament = null } = {}, capture = {}) => {
  const prisma = {
    questValorantSeries: {
      findUnique: async (args) => {
        capture.findUnique = args;
        return series;
      },
      findMany: async (args) => {
        capture.findMany = args;
        return seriesList;
      },
    },
    tournament: {
      findUnique: async (args) => {
        capture.tournament = args;
        return tournament;
      },
    },
  };
  return loadModuleWithMocks(servicePath, { [prismaModulePath]: { prisma } });
};

const statRow = (over = {}) => ({
  displayName: "Quester",
  tagline: "QST",
  side: "red",
  agentId: "add6443a-41bd-e414-f6ad-e58d267f4e95",
  agentName: "Jett",
  scoreTotal: 5460,
  kills: 24,
  deaths: 13,
  assists: 4,
  damageDealt: 4368,
  damageReceived: 3010,
  headshots: 30,
  bodyshots: 62,
  legshots: 8,
  player: null,
  ...over,
});

const baseSeries = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  format: "bo1",
  status: "finalized",
  playedAt: new Date("2026-08-01T14:00:00Z"),
  bindingA: { savedTeam: { name: "Quest Alpha", teamTag: "QA" } },
  bindingB: { savedTeam: { name: "Quest Bravo", teamTag: "QB" } },
  tournament: { slug: "lus-sep", title: "Level Up Series", isPublished: true },
  games: [{
    gameNumber: 1,
    mapName: "Ascent",
    teamASide: "red",
    teamBSide: "blue",
    matchMap: {
      mapName: "Ascent",
      startedAt: new Date("2026-08-01T14:30:00Z"),
      durationMs: 2142000,
      redScore: 13,
      blueScore: 8,
      winningSide: "red",
      playerStats: [statRow()],
    },
  }],
  ...over,
});

test("the public series projection never asks Prisma for a PUUID", async () => {
  const capture = {};
  const { module: service, restore } = load({ series: baseSeries() }, capture);
  try {
    await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const serialized = JSON.stringify(capture.findUnique.select);
    assert.equal(serialized.includes("puuid"), false);
    // The link to a Quest profile travels as the public id, never the PUUID.
    const statSelect = capture.findUnique.select.games.select.matchMap.select.playerStats.select;
    assert.equal("puuid" in statSelect, false);
    assert.deepEqual(statSelect.player.select, { publicId: true, displayName: true });
  } finally {
    restore();
  }
});

test("getPublicSeries derives ACS, ADR and HS% from the stored counters", async () => {
  const { module: service, restore } = load({ series: baseSeries() });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const player = match.maps[0].players[0];
    // 21 rounds: 5460/21 = 260 ACS, 4368/21 = 208 ADR, 30/100 shots = 30%.
    assert.equal(player.acs, 260);
    assert.equal(player.adr, 208);
    assert.equal(player.headshotPercent, 30);
    assert.equal(player.plusMinus, 11);
  } finally {
    restore();
  }
});

test("getPublicSeries reports unreported counters as null rather than zero", async () => {
  const series = baseSeries();
  series.games[0].matchMap.playerStats = [statRow({
    scoreTotal: null,
    damageDealt: null,
    headshots: null,
    bodyshots: null,
    legshots: null,
    kills: null,
    deaths: null,
  })];
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const player = match.maps[0].players[0];
    assert.equal(player.acs, null);
    assert.equal(player.adr, null);
    assert.equal(player.headshotPercent, null);
    // A player with no kills and a player with no data must not render alike.
    assert.equal(player.plusMinus, null);
  } finally {
    restore();
  }
});

test("getPublicSeries links a scoreboard row to a Quest profile only when one resolved", async () => {
  const series = baseSeries();
  series.games[0].matchMap.playerStats = [
    statRow({ player: { publicId: "QPID-000006", displayName: "Russel" } }),
    statRow({ displayName: "Stranger", scoreTotal: 2100, player: null }),
  ];
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const [top, second] = match.maps[0].players;
    assert.deepEqual(top.profile, { publicId: "QPID-000006", displayName: "Russel" });
    // Most of a VALORANT lobby has never touched Quest. Unlinked is normal.
    assert.equal(second.profile, null);
  } finally {
    restore();
  }
});

test("getPublicSeries orders a scoreboard by ACS with unreported rows last", async () => {
  const series = baseSeries();
  series.games[0].matchMap.playerStats = [
    statRow({ displayName: "Unreported", scoreTotal: null }),
    statRow({ displayName: "Low", scoreTotal: 2100 }),
    statRow({ displayName: "High", scoreTotal: 5460 }),
  ];
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    assert.deepEqual(
      match.maps[0].players.map((player) => player.displayName),
      ["High", "Low", "Unreported"],
    );
  } finally {
    restore();
  }
});

test("getPublicSeries resolves scores and the winner per team, not per side", async () => {
  const series = baseSeries();
  // Team A defends on this map, so team A's score is the BLUE column.
  series.games[0].teamASide = "blue";
  series.games[0].teamBSide = "red";
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const map = match.maps[0];
    assert.equal(map.teamAScore, 8);
    assert.equal(map.teamBScore, 13);
    // winningSide is red, and red is team B on this map.
    assert.equal(map.winner, "b");
    assert.deepEqual(match.mapsWon, { a: 0, b: 1 });
  } finally {
    restore();
  }
});

test("getPublicSeries derives the series winner from maps won", async () => {
  const series = baseSeries();
  // Quest's series row has no winner column — the upstream owns the rating
  // engine — so the result is read from the maps, which is also the only
  // version a reader can check against the scoreboard in front of them.
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    assert.equal(match.winner, "a");
    assert.deepEqual(match.mapsWon, { a: 1, b: 0 });
  } finally {
    restore();
  }
});

test("getPublicSeries reports no winner when the maps do not decide one", async () => {
  const series = baseSeries();
  series.games[0].matchMap = null;
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    // No imported map means no evidence of a result. A guess would be worse.
    assert.equal(match.winner, null);
  } finally {
    restore();
  }
});

test("getPublicSeries hides a series that is not finalized", async () => {
  for (const status of ["draft", "orphaned", "reconciliation_required"]) {
    const { module: service, restore } = load({ series: baseSeries({ status }) });
    try {
      assert.equal(await service.getPublicSeries("11111111-1111-4111-8111-111111111111"), null, status);
    } finally {
      restore();
    }
  }
});

test("getPublicSeries hides a series belonging to an unpublished tournament", async () => {
  const series = baseSeries({
    tournament: { slug: "secret", title: "Staff Only", isPublished: false },
  });
  const { module: service, restore } = load({ series });
  try {
    // Leaking a draft event through a results page is a disclosure nobody
    // thinks to check for.
    assert.equal(await service.getPublicSeries("11111111-1111-4111-8111-111111111111"), null);
  } finally {
    restore();
  }
});

test("getPublicSeries reports a played map that has no imported scoreboard", async () => {
  const series = baseSeries();
  series.games[0].matchMap = null;
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    const map = match.maps[0];
    assert.equal(map.scoreboardAvailable, false);
    // Honest nulls rather than an invented 0-0.
    assert.equal(map.teamAScore, null);
    assert.equal(map.teamBScore, null);
    assert.deepEqual(map.players, []);
  } finally {
    restore();
  }
});

test("getPublicSeries renders a result whose team binding no longer resolves", async () => {
  const series = baseSeries({ bindingB: { savedTeam: null } });
  const { module: service, restore } = load({ series });
  try {
    const match = await service.getPublicSeries("11111111-1111-4111-8111-111111111111");
    // The series still happened; a deleted saved team must not erase it.
    assert.equal(match.teams.b.name, null);
    assert.equal(match.teams.a.name, "Quest Alpha");
  } finally {
    restore();
  }
});

test("getTournamentResults returns nothing for an unpublished tournament", async () => {
  const { module: service, restore } = load({
    tournament: { id: "t-1", slug: "secret", title: "Staff Only", isPublished: false },
  });
  try {
    assert.equal(await service.getTournamentResults("secret"), null);
  } finally {
    restore();
  }
});

test("getTournamentResults lists finalized series without shipping any scoreboards", async () => {
  const capture = {};
  const { module: service, restore } = load({
    tournament: { id: "t-1", slug: "lus-sep", title: "Level Up Series", isPublished: true },
    seriesList: [baseSeries()],
  }, capture);
  try {
    const payload = await service.getTournamentResults("LUS-Sep");
    // Slug lookup is normalized, so a link that shouts still resolves.
    assert.equal(capture.tournament.where.slug, "lus-sep");
    assert.equal(capture.findMany.where.tournamentId, "t-1");
    assert.deepEqual(capture.findMany.where.status, { in: ["finalized"] });

    assert.equal(payload.tournament.title, "Level Up Series");
    assert.equal(payload.results.length, 1);
    const result = payload.results[0];
    assert.equal(result.teams.a.name, "Quest Alpha");
    assert.equal(result.winner, "a");
    assert.deepEqual(result.mapsWon, { a: 1, b: 0 });
    assert.deepEqual(result.maps, [{
      gameNumber: 1,
      mapName: "Ascent",
      teamAScore: 13,
      teamBScore: 8,
      winner: "a",
    }]);
    // A list of scorelines must not carry a few hundred player rows with it.
    assert.equal("players" in result.maps[0], false);
  } finally {
    restore();
  }
});

test("getPublicSeries treats an unparseable id as no such match", async () => {
  const capture = {};
  const { module: service, restore } = load({ series: baseSeries() }, capture);
  try {
    // The id arrives straight from a URL. Postgres cannot cast these to uuid,
    // and letting Prisma raise would surface a 400 carrying a database message
    // where a public route owes a plain 404.
    for (const id of ["not-a-uuid", "", "1", "../../etc/passwd", "11111111-1111-4111-8111"]) {
      assert.equal(await service.getPublicSeries(id), null, id);
    }
    assert.equal(capture.findUnique, undefined);
  } finally {
    restore();
  }
});

test("getTournamentResults ignores a blank slug without querying", async () => {
  const capture = {};
  const { module: service, restore } = load({}, capture);
  try {
    assert.equal(await service.getTournamentResults(""), null);
    assert.equal(capture.tournament, undefined);
  } finally {
    restore();
  }
});
