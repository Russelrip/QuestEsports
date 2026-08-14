const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { normalizeText } = require("../../lib/validation");

const MATCH_STATUSES = new Set([
  "not_scheduled",
  "scheduled",
  "check_in_open",
  "veto_starting_soon",
  "veto_in_progress",
  "ready",
  "live",
  "delayed",
  "paused",
  "completed",
  "cancelled",
  "walkover",
]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "walkover"]);
const CHALLONGE_OPERATIONAL_STATUSES = new Set(["check_in_open", "veto_starting_soon", "veto_in_progress", "ready", "delayed", "paused"]);

const matchInclude = {
  tournament: {
    select: {
      id: true,
      slug: true,
      title: true,
      game: true,
      status: true,
      isPublished: true,
    },
  },
  participants: {
    orderBy: { slot: "asc" },
    include: {
      registration: {
        select: {
          id: true,
          teamName: true,
          captainName: true,
          entryType: true,
          teamLogoName: true,
          savedTeam: { select: { logoName: true } },
        },
      },
    },
  },
  assignedStaff: {
    select: { id: true, username: true, firstName: true, lastName: true },
  },
  vetoRoom: {
    select: {
      code: true,
      status: true,
      format: true,
      publishResult: true,
      tossCall: true,
      tossResult: true,
      tossWinnerSlot: true,
      teamASlot: true,
      completedAt: true,
      actions: {
        where: { invalidatedAt: null },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
        select: { sequence: true, kind: true, actorSlot: true, mapSlug: true, mapName: true, side: true, payload: true },
      },
    },
  },
};

const participantLogoUrl = (participant) => {
  const name = participant.registration?.savedTeam?.logoName || participant.registration?.teamLogoName;
  return name ? `/api/uploads/team-logos/${name}` : null;
};

const mapMatch = (match) => ({
  id: match.id,
  tournament: match.tournament,
  source: match.source,
  externalId: match.externalId,
  identifier: match.identifier || match.externalId || match.id.slice(0, 8),
  roundNumber: match.roundNumber,
  status: match.status,
  scheduledAt: match.scheduledAt,
  estimatedAt: match.estimatedAt,
  station: match.station,
  checkInDeadline: match.checkInDeadline,
  vetoStartAt: match.vetoStartAt,
  assignedStaff: match.assignedStaff || null,
  localNotes: match.localNotes,
  scoreData: match.scoreData || {},
  winnerSlot: match.winnerSlot,
  completedAt: match.completedAt,
  participants: match.participants.map((participant) => ({
    id: participant.id,
    slot: participant.slot,
    registrationId: participant.registrationId,
    externalParticipantId: participant.externalParticipantId,
    displayName: participant.displayName,
    seed: participant.seed,
    score: participant.score,
    result: participant.result,
    logoUrl: participantLogoUrl(participant),
  })),
  veto: match.vetoRoom?.status === "completed" && match.vetoRoom.publishResult
    ? {
        code: match.vetoRoom.code,
        status: match.vetoRoom.status,
        format: match.vetoRoom.format,
        toss: {
          call: match.vetoRoom.tossCall,
          result: match.vetoRoom.tossResult,
          winnerSlot: match.vetoRoom.tossWinnerSlot,
          teamASlot: match.vetoRoom.teamASlot,
        },
        actions: match.vetoRoom.actions,
        completedAt: match.vetoRoom.completedAt,
      }
    : null,
  updatedAt: match.updatedAt,
});

const parsePositiveInteger = (value, fallback, maximum = 100) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const parseOptionalDate = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `${label} must be a valid date and time.`);
  return parsed;
};

const buildPublicMatchWhere = (query = {}) => {
  const status = normalizeText(query.status).toLowerCase();
  if (status && !MATCH_STATUSES.has(status)) throw new HttpError(400, "Invalid match status filter.");
  const from = parseOptionalDate(query.from, "From");
  const to = parseOptionalDate(query.to, "To");
  return {
    tournament: {
      isPublished: true,
      ...(query.tournamentId ? { id: normalizeText(query.tournamentId) } : {}),
      ...(query.slug ? { slug: normalizeText(query.slug).toLowerCase() } : {}),
    },
    ...(status ? { status } : {}),
    ...((from || to)
      ? {
          OR: [
            { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
            { scheduledAt: null, estimatedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
          ],
        }
      : {}),
  };
};

const listPublicMatches = async (query = {}) => {
  const page = parsePositiveInteger(query.page, 1, 10_000);
  const pageSize = parsePositiveInteger(query.pageSize, 20, 50);
  const where = buildPublicMatchWhere(query);
  const [total, matches] = await prisma.$transaction([
    prisma.match.count({ where }),
    prisma.match.findMany({
      where,
      include: matchInclude,
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: matches.map(mapMatch),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
};

const getRelevantRegistrationIds = async (userId) => {
  if (!userId) return [];
  const rows = await prisma.teamRegistration.findMany({
    where: {
      OR: [
        { userId },
        { members: { some: { userId, inviteStatus: "accepted" } } },
      ],
    },
    select: { id: true },
    take: 250,
  });
  return rows.map((row) => row.id);
};

const getTournamentCapabilities = async ({ user, tournamentId, registrationIds = [] }) => {
  const base = {
    authenticated: Boolean(user),
    registeredPlayer: user?.role === "user",
    superAdmin: user?.role === "admin",
    participant: false,
    captain: false,
    tournamentRole: null,
    canManageTeam: false,
    canManageMatches: user?.role === "admin",
  };
  if (!user || !tournamentId) return base;
  const [registrations, assignment] = await Promise.all([
    prisma.teamRegistration.findMany({
      where: {
        tournamentId,
        ...(registrationIds.length ? { id: { in: registrationIds } } : {}),
        OR: [
          { userId: user.id },
          { savedTeam: { captainUserId: user.id } },
          { members: { some: { userId: user.id, inviteStatus: "accepted" } } },
          { savedTeam: { members: { some: { userId: user.id, inviteStatus: "accepted" } } } },
        ],
      },
      select: { userId: true, savedTeam: { select: { captainUserId: true } } },
      take: 10,
    }),
    prisma.tournamentStaffAssignment.findFirst({
      where: { tournamentId, userId: user.id },
      orderBy: { role: "asc" },
      select: { role: true },
    }),
  ]);
  const captain = registrations.some((registration) =>
    registration.userId === user.id || registration.savedTeam?.captainUserId === user.id
  );
  return {
    ...base,
    participant: registrations.length > 0,
    captain,
    tournamentRole: assignment?.role || null,
    canManageTeam: captain,
    canManageMatches: base.superAdmin || Boolean(assignment),
  };
};

const getNextMatch = async ({ user, scope = "public" } = {}) => {
  const relevantRegistrationIds = scope === "me" ? await getRelevantRegistrationIds(user?.id) : [];
  if (scope === "me" && !user) throw new HttpError(401, "Sign in to view your next match.");
  if (scope === "me" && relevantRegistrationIds.length === 0) return null;

  const match = await prisma.match.findFirst({
    where: {
      tournament: { isPublished: true },
      status: { notIn: [...TERMINAL_STATUSES] },
      ...(scope === "me"
        ? { participants: { some: { registrationId: { in: relevantRegistrationIds } } } }
        : {}),
    },
    include: matchInclude,
    orderBy: [
      { estimatedAt: { sort: "asc", nulls: "last" } },
      { scheduledAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });
  return match ? mapMatch(match) : null;
};

const getTournamentMatches = async (slug, query = {}) => {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: normalizeText(slug).toLowerCase(), isPublished: true },
    select: { id: true },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const result = await listPublicMatches({ ...query, tournamentId: tournament.id, pageSize: query.pageSize || 50 });
  return { ...result, tournamentId: tournament.id };
};

const getAdminTournamentMatches = async (tournamentId) => {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const matches = await prisma.match.findMany({
    where: { tournamentId },
    include: matchInclude,
    orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 250,
  });
  return matches.map(mapMatch);
};

const normalizeParticipantInput = (input, slot) => {
  const displayName = normalizeText(input?.displayName) || "TBD";
  return {
    id: crypto.randomUUID(),
    slot,
    registrationId: normalizeText(input?.registrationId) || null,
    displayName: displayName.slice(0, 160),
    score: normalizeText(input?.score).slice(0, 40) || null,
  };
};

const createMatch = async ({ tournamentId, body }) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const status = normalizeText(body.status).toLowerCase() || "not_scheduled";
  if (!MATCH_STATUSES.has(status)) throw new HttpError(400, "Invalid match status.");
  const scheduledAt = parseOptionalDate(body.scheduledAt, "Scheduled time") ?? null;
  const estimatedAt = parseOptionalDate(body.estimatedAt, "Estimated time") ?? null;
  const participants = [
    normalizeParticipantInput(body.participants?.[0], 1),
    normalizeParticipantInput(body.participants?.[1], 2),
  ];

  const match = await prisma.match.create({
    data: {
      id: crypto.randomUUID(),
      tournamentId,
      source: "quest",
      identifier: normalizeText(body.identifier).slice(0, 80) || null,
      roundNumber: Number.isInteger(Number(body.roundNumber)) ? Number(body.roundNumber) : null,
      status,
      scheduledAt,
      estimatedAt,
      station: normalizeText(body.station).slice(0, 120) || null,
      checkInDeadline: parseOptionalDate(body.checkInDeadline, "Check-in deadline") ?? null,
      vetoStartAt: parseOptionalDate(body.vetoStartAt, "Veto start") ?? null,
      assignedStaffId: normalizeText(body.assignedStaffId) || null,
      localNotes: normalizeText(body.localNotes).slice(0, 2000) || null,
      participants: { create: participants },
    },
    include: matchInclude,
  });
  return mapMatch(match);
};

const updateMatch = async ({ matchId, body }) => {
  const existing = await prisma.match.findUnique({ where: { id: matchId }, include: matchInclude });
  if (!existing) throw new HttpError(404, "Match not found.");
  const data = {};
  if (body.status !== undefined) {
    const status = normalizeText(body.status).toLowerCase();
    if (!MATCH_STATUSES.has(status)) throw new HttpError(400, "Invalid match status.");
    if (existing.source === "challonge" && status !== existing.status && !CHALLONGE_OPERATIONAL_STATUSES.has(status)) {
      throw new HttpError(409, "Challonge owns the upstream match state for linked fixtures.");
    }
    data.status = status;
    if (TERMINAL_STATUSES.has(status)) data.completedAt = new Date();
    else if (existing.completedAt) data.completedAt = null;
  }
  for (const [key, label] of [
    ["scheduledAt", "Scheduled time"],
    ["estimatedAt", "Estimated time"],
    ["checkInDeadline", "Check-in deadline"],
    ["vetoStartAt", "Veto start"],
  ]) {
    const value = parseOptionalDate(body[key], label);
    if (value !== undefined) data[key] = value;
  }
  if (body.station !== undefined) data.station = normalizeText(body.station).slice(0, 120) || null;
  if (body.assignedStaffId !== undefined) data.assignedStaffId = normalizeText(body.assignedStaffId) || null;
  if (body.localNotes !== undefined) data.localNotes = normalizeText(body.localNotes).slice(0, 2000) || null;
  if (body.winnerSlot !== undefined) {
    if (existing.source === "challonge") throw new HttpError(409, "Challonge owns the winner for linked fixtures.");
    const winnerSlot = body.winnerSlot === null || body.winnerSlot === "" ? null : Number(body.winnerSlot);
    if (winnerSlot !== null && ![1, 2].includes(winnerSlot)) throw new HttpError(400, "Winner slot must be 1 or 2.");
    data.winnerSlot = winnerSlot;
  }

  const updated = await prisma.match.update({ where: { id: matchId }, data, include: matchInclude });
  return { before: mapMatch(existing), after: mapMatch(updated), tournamentId: existing.tournamentId };
};

const getHomeFeed = async () => {
  const now = new Date();
  const sections = await Promise.allSettled([
    getNextMatch(),
    prisma.match.findMany({
      where: { tournament: { isPublished: true }, status: { in: ["completed", "walkover"] } },
      include: matchInclude,
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      take: 4,
    }),
    prisma.match.findMany({
      where: {
        tournament: { isPublished: true },
        status: { notIn: [...TERMINAL_STATUSES] },
        OR: [{ scheduledAt: { gte: now } }, { estimatedAt: { gte: now } }, { status: { in: ["live", "delayed", "paused", "ready"] } }],
      },
      include: matchInclude,
      orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }],
      take: 6,
    }),
    prisma.tournament.findMany({
      where: { isPublished: true },
      select: {
        id: true,
        slug: true,
        title: true,
        game: true,
        status: true,
        startDate: true,
        registrationOpenAt: true,
        registrationDeadline: true,
        maxTeams: true,
        prizePool: true,
        bannerImageName: true,
        isFeatured: true,
        sponsors: {
          select: { id: true, name: true, partnershipLabel: true, logoImageName: true, websiteUrl: true },
          orderBy: { displayOrder: "asc" },
        },
        _count: { select: { teamRegistrations: { where: { status: { in: ["pending", "approved"] } } } } },
      },
      orderBy: [{ isFeatured: "desc" }, { displayPriority: "asc" }, { startDate: "asc" }],
      take: 3,
    }),
    prisma.teamRegistration.findMany({
      where: {
        status: "approved",
        tournament: { isPublished: true },
      },
      select: {
        id: true,
        teamName: true,
        captainName: true,
        entryType: true,
        teamLogoName: true,
        savedTeam: { select: { logoName: true } },
        tournament: { select: { slug: true, title: true, game: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
  ]);
  const values = sections.map((section, index) => {
    if (section.status === "fulfilled") return section.value;
    logger.warn("Home feed section failed", { section: ["nextMatch", "recentResults", "upcomingMatches", "featuredTournaments", "featuredCompetitors"][index], error: section.reason });
    return index === 0 ? null : [];
  });
  const [nextMatch, recentResults, upcomingMatches, featuredTournaments, featuredCompetitors] = values;
  return {
    nextMatch,
    recentResults: recentResults.map(mapMatch),
    upcomingMatches: upcomingMatches.map(mapMatch),
    featuredTournaments: featuredTournaments.map((tournament) => ({
      id: tournament.id,
      slug: tournament.slug,
      title: tournament.title,
      game: tournament.game,
      status: tournament.status,
      startDate: tournament.startDate,
      registrationDeadline: tournament.registrationDeadline,
      prizePool: tournament.prizePool,
      isFeatured: tournament.isFeatured,
      registrationOpen: tournament.status === "registration_open"
        && (!tournament.registrationOpenAt || tournament.registrationOpenAt <= now)
        && (!tournament.registrationDeadline || tournament.registrationDeadline >= now)
        && tournament._count.teamRegistrations < tournament.maxTeams,
      bannerUrl: tournament.bannerImageName ? `/api/uploads/tournament-banners/${tournament.bannerImageName}` : null,
      sponsors: tournament.sponsors.map((sponsor) => ({
        id: sponsor.id,
        name: sponsor.name,
        partnershipLabel: sponsor.partnershipLabel,
        websiteUrl: sponsor.websiteUrl,
        logoUrl: sponsor.logoImageName ? `/api/uploads/sponsor-logos/${sponsor.logoImageName}` : null,
      })),
    })),
    featuredCompetitors: featuredCompetitors.map((registration) => {
      const logoName = registration.savedTeam?.logoName || registration.teamLogoName;
      return {
        id: registration.id,
        displayName: registration.entryType === "solo" ? registration.captainName : registration.teamName,
        entryType: registration.entryType,
        logoUrl: logoName ? `/api/uploads/team-logos/${logoName}` : null,
        tournament: registration.tournament,
      };
    }),
  };
};

module.exports = {
  MATCH_STATUSES,
  TERMINAL_STATUSES,
  CHALLONGE_OPERATIONAL_STATUSES,
  matchInclude,
  mapMatch,
  listPublicMatches,
  getTournamentMatches,
  getAdminTournamentMatches,
  getNextMatch,
  createMatch,
  updateMatch,
  getHomeFeed,
  getTournamentCapabilities,
};
