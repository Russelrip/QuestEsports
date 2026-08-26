const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const anchors = require("./valorant-anchors.service");
const { discover } = require("./valorant.service");
const { parseRiotId } = require("./valorant.validation");

const getTournamentAnchors = asyncHandler(async (req, res) => {
  const derived = await anchors.deriveTournamentAnchors(req.params.tournamentId);
  if (!derived) throw new HttpError(404, "Tournament not found.");
  res.status(200).json({ success: true, ...derived });
});

const getTournamentFixtures = asyncHandler(async (req, res) => {
  const derived = await anchors.deriveTournamentFixtures(req.params.tournamentId);
  if (!derived) throw new HttpError(404, "Tournament not found.");
  res.status(200).json({ success: true, ...derived });
});

// Discovery for ONE fixture, using anchors derived from the roster rather than
// typed by an admin. One fixture per call on purpose: each call spends an
// upstream search, and a single endpoint that swept a whole bracket would turn
// one careless click into dozens of them.
//
// This PROPOSES. It imports nothing, attaches nothing and finalizes nothing —
// a wrongly attached map changes a rating and a public result, so a human
// confirms before any of that happens.
const discoverFixture = asyncHandler(async (req, res) => {
  const { tournamentId, matchId } = req.params;
  const derived = await anchors.deriveTournamentFixtures(tournamentId);
  if (!derived) throw new HttpError(404, "Tournament not found.");

  const fixture = derived.fixtures.find((entry) => entry.matchId === matchId);
  if (!fixture) throw new HttpError(404, "Fixture not found in this tournament.");
  if (!fixture.ready) {
    // The reason travels with the refusal. "Cannot search this fixture" without
    // saying which team has no anchor leaves an admin guessing.
    throw new HttpError(409, `Fixture cannot be searched yet: ${fixture.blockedReason}.`);
  }

  const pair = anchors.fixtureAnchorPair(fixture);
  if (!pair) throw new HttpError(409, "Fixture cannot be searched yet: anchor pair incomplete.");

  // `discover` takes { name, tag }, not "Name#Tag". Anchors are carried as the
  // display string because that is what a roster snapshot stores and what an
  // admin reads, so they are parsed at the boundary. Passing the string through
  // fails every call with "Invalid Riot ID" -- which is exactly what the first
  // real call to this endpoint did.
  const result = await discover({
    playerA: parseRiotId(pair.playerA),
    playerB: parseRiotId(pair.playerB),
    pageSize: Number(req.body?.pageSize) || 10,
    maxPages: Number(req.body?.maxPages) || 1,
    map: req.body?.map || null,
    // Defaults to the tournament start so a search does not walk history from
    // before the event, which is where false positives come from: the same two
    // teams may well have scrimmed each other a month earlier.
    from: req.body?.from || derived.tournament.startDate || null,
    actorUserId: req.user?.id || null,
    requestId: req.id || null,
  });

  res.status(200).json({
    success: true,
    fixture: {
      matchId: fixture.matchId,
      identifier: fixture.identifier,
      roundNumber: fixture.roundNumber,
      sides: fixture.sides,
    },
    anchors: pair,
    ...result,
  });
});

module.exports = { getTournamentAnchors, getTournamentFixtures, discoverFixture };
