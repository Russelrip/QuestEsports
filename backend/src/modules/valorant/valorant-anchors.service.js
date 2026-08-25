const { prisma } = require("../../lib/prisma");

// Roster-derived discovery anchors.
//
// `discover` needs two anchor Riot IDs, one player from each side, and today an
// admin types them from memory. That is the single reason match ingestion is
// manual. Quest now knows the rosters — RegistrationMember carries the game
// account committed to a tournament — so the anchors are DERIVABLE, and
// discovery can be driven from the bracket instead.
//
// This file only derives and proposes. It never calls the upstream, never
// writes, and never finalizes anything: a wrongly attached map changes a rating
// and a public result, so automation proposes and a human confirms.

// Only people who actually played. A coach is on the roster and is not in the
// match, so using one as an anchor would search for a lobby they were never in.
const PLAYING_ROLES = ["CAPTAIN", "PLAYER", "SUBSTITUTE"];

// Ordered by how much each source proves. The snapshot is what the team
// actually committed to THIS tournament and cannot be rewritten by a later
// rename, so it is always preferred. The live account is a good guess but
// reflects today. The free-text field was typed by a human and checked against
// nothing, which is precisely the input this work exists to stop relying on.
const ANCHOR_SOURCES = ["snapshot", "game_account", "legacy_text"];

const riotId = (username, tagline) => {
  const name = String(username || "").trim();
  const tag = String(tagline || "").trim().replace(/^#/, "");
  if (!name || !tag) return null;
  return `${name}#${tag}`;
};

// A legacy `riot_id` is free text. Accept it only when it already looks like a
// Riot ID; anything else is a note to a human, not an identifier.
const parseLegacyRiotId = (value) => {
  const raw = String(value || "").trim();
  if (!raw.includes("#")) return null;
  const [name, ...rest] = raw.split("#");
  return riotId(name, rest.join("#"));
};

const memberAnchors = (member) => {
  const found = [];

  const snapshot = riotId(member.usernameSnapshot, member.tagSnapshot);
  if (snapshot) {
    found.push({
      source: "snapshot",
      riotId: snapshot,
      puuid: member.externalIdSnapshot ?? null,
      verificationStatus: member.verificationStatusSnapshot ?? null,
    });
  }

  const account = member.player?.gameAccounts?.[0];
  const live = account ? riotId(account.username, account.tagline) : null;
  if (live && live !== snapshot) {
    found.push({
      source: "game_account",
      riotId: live,
      puuid: account.externalId ?? null,
      verificationStatus: account.verificationStatus ?? null,
    });
  }

  const legacy = parseLegacyRiotId(member.riotId);
  if (legacy && !found.some((entry) => entry.riotId === legacy)) {
    found.push({ source: "legacy_text", riotId: legacy, puuid: null, verificationStatus: null });
  }

  return found.map((entry) => ({ ...entry, memberName: member.name, role: member.role }));
};

const bySourceConfidence = (a, b) =>
  ANCHOR_SOURCES.indexOf(a.source) - ANCHOR_SOURCES.indexOf(b.source);

// Every usable anchor for one registration, best first. All of them are
// returned rather than only the best: an anchor is only useful if that person
// actually played the map being searched for, and a substitute who sat out is a
// dead end the caller may need to retry past.
const registrationAnchors = (registration) => {
  const members = (registration.members || [])
    .filter((member) => PLAYING_ROLES.includes(member.role))
    .sort((a, b) => a.memberOrder - b.memberOrder);

  const anchors = members.flatMap(memberAnchors).sort(bySourceConfidence);

  return {
    registrationId: registration.id,
    teamName: registration.teamName,
    anchors,
    // Stated plainly so a caller never has to infer it from an empty array.
    anchorSource: anchors[0]?.source ?? null,
  };
};

const registrationSelect = {
  id: true,
  teamName: true,
  members: {
    where: { role: { in: PLAYING_ROLES } },
    select: {
      name: true,
      role: true,
      memberOrder: true,
      riotId: true,
      usernameSnapshot: true,
      tagSnapshot: true,
      externalIdSnapshot: true,
      verificationStatusSnapshot: true,
      player: {
        select: {
          gameAccounts: {
            where: { game: "valorant", status: "active" },
            select: { username: true, tagline: true, externalId: true, verificationStatus: true },
          },
        },
      },
    },
  },
};

// Anchors for every approved team in a tournament. Approved only: a pending
// entry is not yet a fact and a rejected one never played.
const deriveTournamentAnchors = async (tournamentId) => {
  if (!tournamentId || typeof tournamentId !== "string") return null;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, slug: true, title: true, startDate: true, endDate: true },
  });
  if (!tournament) return null;

  const registrations = await prisma.teamRegistration.findMany({
    where: { tournamentId, status: "approved" },
    orderBy: { teamName: "asc" },
    select: registrationSelect,
  });

  const teams = registrations.map(registrationAnchors);

  return {
    tournament,
    teams,
    // The honest summary an admin needs before trusting any of this: which
    // teams cannot be searched for at all, and why.
    unanchored: teams.filter((team) => team.anchors.length === 0).map((team) => team.teamName),
  };
};


// A bracket fixture, joined to the anchors its two teams can be searched by.
//
// Pairs come from the BRACKET, never from every combination of teams: a 16-team
// event has 120 possible pairings and about 15 real ones, and searching the
// other 105 would spend an upstream rate limit proving that teams who never met
// never played.
//
// This is also where `match_maps.match_id` finally gets a value it can hold. A
// fixture proposed here already knows its bracket `Match`, so attaching a
// discovered map to it closes the linkage gap rather than deferring it again.
const fixtureSelect = {
  id: true,
  identifier: true,
  roundNumber: true,
  status: true,
  scheduledAt: true,
  completedAt: true,
  participants: {
    orderBy: { slot: "asc" },
    select: { slot: true, registrationId: true, displayName: true },
  },
};

// Why a fixture cannot be searched yet, stated as a reason rather than by
// silently omitting it. An admin needs to know which half of the bracket is
// invisible to automation and why, or they will assume it is all covered.
const fixtureBlocker = (participants, anchoredById) => {
  if (participants.length !== 2) return "fixture_has_no_opponent_pair";
  const unlinked = participants.filter((participant) => !participant.registrationId);
  if (unlinked.length > 0) return "participant_not_linked_to_registration";
  const missing = participants.filter((participant) => {
    const team = anchoredById.get(participant.registrationId);
    return !team || team.anchors.length === 0;
  });
  if (missing.length > 0) return "team_has_no_derivable_anchor";
  return null;
};

const deriveTournamentFixtures = async (tournamentId) => {
  const derived = await deriveTournamentAnchors(tournamentId);
  if (!derived) return null;

  const anchoredById = new Map(derived.teams.map((team) => [team.registrationId, team]));

  const matches = await prisma.match.findMany({
    where: { tournamentId },
    orderBy: [{ roundNumber: "asc" }, { identifier: "asc" }],
    select: fixtureSelect,
  });

  const fixtures = matches.map((match) => {
    const participants = match.participants || [];
    const blocker = fixtureBlocker(participants, anchoredById);
    const sides = blocker
      ? []
      : participants.map((participant) => {
        const team = anchoredById.get(participant.registrationId);
        return {
          slot: participant.slot,
          registrationId: participant.registrationId,
          teamName: team.teamName,
          displayName: participant.displayName,
          // Best anchor first, with the rest kept: an anchor only works if
          // that person actually played the map, and a substitute who sat out
          // is a dead end the caller has to be able to retry past.
          anchor: team.anchors[0],
          alternateAnchors: team.anchors.slice(1),
        };
      });

    return {
      matchId: match.id,
      identifier: match.identifier,
      roundNumber: match.roundNumber,
      status: match.status,
      scheduledAt: match.scheduledAt,
      completedAt: match.completedAt,
      ready: blocker === null,
      blockedReason: blocker,
      sides,
    };
  });

  return {
    tournament: derived.tournament,
    fixtures,
    summary: {
      total: fixtures.length,
      ready: fixtures.filter((fixture) => fixture.ready).length,
      blocked: fixtures.filter((fixture) => !fixture.ready).length,
    },
  };
};

// The anchor pair for one fixture, ready to hand to `discover`. Returns null
// rather than a partial pair: searching with one real anchor and one guess
// would return matches that merely include one of these players, which is a
// different and much worse question than "did these two teams play".
const fixtureAnchorPair = (fixture) => {
  if (!fixture?.ready || fixture.sides.length !== 2) return null;
  const [a, b] = fixture.sides;
  if (!a.anchor?.riotId || !b.anchor?.riotId) return null;
  return { playerA: a.anchor.riotId, playerB: b.anchor.riotId };
};

module.exports = {
  ANCHOR_SOURCES,
  PLAYING_ROLES,
  deriveTournamentAnchors,
  deriveTournamentFixtures,
  fixtureAnchorPair,
  memberAnchors,
  parseLegacyRiotId,
  registrationAnchors,
  riotId,
};
