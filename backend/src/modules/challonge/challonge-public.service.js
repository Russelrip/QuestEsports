const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");
const { resolveEffectiveTeamLogoName, getTeamLogoUrl } = require("../teams/team-logo");
const { overlayBracketLogos } = require("../tournaments/bracket.service");
const { extractChallongeIdentifier, normalizeChallongePublicUrl } = require("./challonge-api");
const { mapChallongeStatus, parseScores } = require("./challonge-sync.service");

const registrationLogoUrl = (registration) => {
  return getTeamLogoUrl(resolveEffectiveTeamLogoName(registration));
};

const buildPublicSnapshot = (snapshot, participantLinks = []) => {
  const linkByExternalId = new Map(participantLinks.map((link) => [link.externalParticipantId, link]));
  const participants = snapshot.participants.map((participant) => {
    const link = linkByExternalId.get(participant.id);
    return {
      ...participant,
      registrationId: link?.isConfirmed ? link.registrationId : null,
      teamName: link?.isConfirmed ? link.registration?.teamName || participant.name : participant.name,
      logoUrl: link?.isConfirmed ? registrationLogoUrl(link.registration) : null,
    };
  });
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const matches = snapshot.matches.map((match) => {
    const player1 = match.player1Id ? participantById.get(match.player1Id) : null;
    const player2 = match.player2Id ? participantById.get(match.player2Id) : null;
    const winner = match.winnerId ? participantById.get(match.winnerId) : null;
    const [score1, score2] = parseScores(match.scoresCsv);
    const status = mapChallongeStatus(match);
    return {
      id: match.id,
      identifier: match.identifier,
      roundNumber: match.round,
      status,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      location: match.location,
      scoresCsv: match.scoresCsv,
      scoreSets: match.scoresCsv ? match.scoresCsv.split(",").map((score) => score.trim()).filter(Boolean) : [],
      participants: [
        { id: player1?.id || null, name: player1?.teamName || "TBD", seed: player1?.seed ?? null, score: score1, result: match.winnerId ? (match.winnerId === player1?.id ? "win" : "loss") : null, logoUrl: player1?.logoUrl || null },
        { id: player2?.id || null, name: player2?.teamName || "TBD", seed: player2?.seed ?? null, score: score2, result: match.winnerId ? (match.winnerId === player2?.id ? "win" : "loss") : null, logoUrl: player2?.logoUrl || null },
      ],
      winner: winner ? { id: winner.id, name: winner.teamName, seed: winner.seed } : null,
      completedResult: status === "completed"
        ? `${player1?.teamName || "TBD"} ${score1 || "-"} - ${score2 || "-"} ${player2?.teamName || "TBD"}`
        : null,
    };
  });
  const completedMatches = matches.filter((match) => match.status === "completed").length;
  const standings = participants
    .filter((participant) => participant.finalRank !== null)
    .sort((left, right) => left.finalRank - right.finalRank || (left.seed ?? 9999) - (right.seed ?? 9999));
  const winner = standings.find((participant) => participant.finalRank === 1) ||
    [...matches].reverse().find((match) => match.winner)?.winner || null;
  const progressPercent = snapshot.tournament.progressMeter ??
    (matches.length ? Math.round((completedMatches / matches.length) * 100) : 0);
  return {
    tournament: {
      id: snapshot.tournament.id,
      name: snapshot.tournament.name,
      status: snapshot.tournament.state,
      tournamentType: snapshot.tournament.tournamentType,
      teams: snapshot.tournament.teams,
      startedAt: snapshot.tournament.startedAt,
      completedAt: snapshot.tournament.completedAt,
      updatedAt: snapshot.tournament.updatedAt,
      progressPercent,
    },
    participants,
    matches,
    progression: {
      completedMatches,
      totalMatches: matches.length,
      progressPercent,
      winner,
      standings,
    },
  };
};

const getPublicBracket = async (slug) => {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: normalizeText(slug).toLowerCase(), isPublished: true },
    include: {
      challongeIntegration: {
        include: {
          participantLinks: {
            include: {
              registration: {
                select: { id: true, teamName: true, teamLogoName: true, savedTeam: { select: { logoName: true } } },
              },
            },
          },
        },
      },
      teamRegistrations: {
        select: {
          id: true,
          teamLogoName: true,
          savedTeam: { select: { logoName: true } },
        },
      },
      bracket: true,
    },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const integration = tournament.challongeIntegration;
  const nativeBracketData = tournament.bracket
    ? overlayBracketLogos(tournament.bracket, [
        ...(tournament.teamRegistrations || []),
        ...(integration?.participantLinks || [])
          .map((link) => link.registration)
          .filter(Boolean),
      ]).bracketData
    : null;
  if (integration?.enabled) {
    const ageMs = integration.lastSuccessAt ? Date.now() - integration.lastSuccessAt.getTime() : Infinity;
    const staleAfterMs = (integration.syncFrequency === "one_minute" ? 3 : 10) * 60_000;
    const matchingLegacyUrl = extractChallongeIdentifier(tournament.bracketLink) === integration.identifier
      ? normalizeChallongePublicUrl(tournament.bracketLink)
      : null;
    if (!integration.snapshotData && tournament.bracket?.status === "published") {
      return {
        source: "native",
        requestedSource: "challonge",
        status: "fresh",
        data: nativeBracketData,
        syncedAt: tournament.bracket.lastUpdatedAt,
        error: integration.lastErrorCode
          ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
          : null,
        externalUrl: matchingLegacyUrl,
      };
    }
    const snapshot = integration.snapshotData;
    return {
      source: "challonge",
      status: snapshot ? (integration.lastErrorCode || ageMs > staleAfterMs ? "stale" : "fresh") : "unavailable",
      data: snapshot ? buildPublicSnapshot(snapshot, integration.participantLinks) : null,
      syncedAt: integration.lastSuccessAt,
      error: integration.lastErrorCode
        ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
        : null,
      externalUrl: normalizeChallongePublicUrl(snapshot?.tournament?.fullChallongeUrl) || matchingLegacyUrl,
    };
  }
  if (tournament.bracket?.status === "published") {
    return {
      source: "native",
      status: "fresh",
      data: nativeBracketData,
      syncedAt: tournament.bracket.lastUpdatedAt,
      error: null,
      externalUrl: normalizeChallongePublicUrl(tournament.bracketLink),
    };
  }
  return { source: "none", status: "unavailable", data: null, syncedAt: null, error: null, externalUrl: normalizeChallongePublicUrl(tournament.bracketLink) };
};

module.exports = {
  getPublicBracket,
};
