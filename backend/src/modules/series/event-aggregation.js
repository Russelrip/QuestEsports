const { prisma } = require("../../lib/prisma");
const {
  buildActiveRegistrationWhere,
  hasAvailableCapacity,
  hasUnlimitedCapacity,
  isRegistrationActive,
} = require("../tournaments/registration-eligibility");

const PLAYER_ROLES = ["CAPTAIN", "PLAYER", "SUBSTITUTE"];

const getVisibleTournamentWhere = ({ seriesId, includeDrafts }) => ({
  seriesId,
  ...(includeDrafts ? {} : { isPublished: true }),
});

const isFuture = (value, now) => value && new Date(value).getTime() > now.getTime();
const isPast = (value, now) => value && new Date(value).getTime() < now.getTime();

const getChildCapacity = (tournament) => {
  const activeRegistrations = tournament._count?.teamRegistrations || 0;
  const adminHolds = tournament._count?.adminSlotReservations || 0;
  const activeHeldRegistrations = (tournament.adminSlotReservations || [])
    .filter(({ registration }) => registration && isRegistrationActive(registration))
    .length;

  return activeRegistrations + adminHolds - activeHeldRegistrations;
};

// An event with an uncapped child has no meaningful slot count, so the
// aggregate reports NULL rather than a number that silently omits it.
const sumAvailableSlots = (tournaments) =>
  tournaments.some(hasUnlimitedCapacity)
    ? null
    : tournaments.reduce(
        (total, tournament) =>
          total + Math.max(0, (tournament.maxTeams || 0) - getChildCapacity(tournament)),
        0
      );

const deriveRegistrationState = (tournaments, now = new Date()) => {
  if (tournaments.length === 0) return "closed";

  if (tournaments.some((tournament) => {
    const capacityUsed = getChildCapacity(tournament);
    return tournament.status === "registration_open" &&
      !isFuture(tournament.registrationOpenAt, now) &&
      !isPast(tournament.registrationDeadline, now) &&
      (hasAvailableCapacity(tournament, capacityUsed) || tournament.waitlistEnabled);
  })) {
    return "open";
  }

  if (tournaments.every((tournament) => tournament.status === "completed" || isPast(tournament.endDate, now))) {
    return "completed";
  }

  if (tournaments.some((tournament) =>
    tournament.status === "upcoming" ||
    isFuture(tournament.registrationOpenAt, now) ||
    isFuture(tournament.startDate, now)
  )) {
    return "upcoming";
  }

  return "closed";
};

const getEventAggregate = async ({ seriesId, includeDrafts = false }) => {
  const tournamentWhere = getVisibleTournamentWhere({ seriesId, includeDrafts });
  const tournaments = await prisma.tournament.findMany({
    where: tournamentWhere,
    select: {
      id: true,
      maxTeams: true,
      status: true,
      registrationOpenAt: true,
      registrationDeadline: true,
      waitlistEnabled: true,
      startDate: true,
      endDate: true,
      _count: {
        select: {
          teamRegistrations: { where: buildActiveRegistrationWhere() },
          adminSlotReservations: true,
        },
      },
      adminSlotReservations: {
        select: {
          registration: {
            select: { status: true, paymentStatus: true, reservedUntil: true },
          },
        },
      },
    },
  });

  const playersRegistered = prisma.registrationMember?.count
    ? await prisma.registrationMember.count({
        where: {
          role: { in: PLAYER_ROLES },
          registration: {
            tournament: tournamentWhere,
            ...buildActiveRegistrationWhere(),
          },
        },
      })
    : 0;

  const teamsRegistered = tournaments.reduce(
    (total, tournament) => total + (tournament._count?.teamRegistrations || 0),
    0
  );
  const availableSlots = sumAvailableSlots(tournaments);

  return {
    games: tournaments.length,
    teamsRegistered,
    playersRegistered,
    availableSlots,
    registrationState: deriveRegistrationState(tournaments),
  };
};

const getEventAggregates = async ({ seriesIds, includeDrafts = false }) => {
  if (!seriesIds.length) return new Map();
  const tournamentWhere = { seriesId: { in: seriesIds }, ...(includeDrafts ? {} : { isPublished: true }) };
  const tournaments = await prisma.tournament.findMany({
    where: tournamentWhere,
    select: {
      id: true, seriesId: true, maxTeams: true, status: true, registrationOpenAt: true,
      waitlistEnabled: true,
      registrationDeadline: true, startDate: true, endDate: true,
      _count: { select: { teamRegistrations: { where: buildActiveRegistrationWhere() }, adminSlotReservations: true } },
      adminSlotReservations: { select: { registration: { select: { status: true, paymentStatus: true, reservedUntil: true } } } },
    },
  });
  const grouped = new Map(seriesIds.map((id) => [id, []]));
  tournaments.forEach((tournament) => grouped.get(tournament.seriesId)?.push(tournament));
  const playerRows = prisma.registrationMember?.findMany
    ? await prisma.registrationMember.findMany({
        where: { role: { in: PLAYER_ROLES }, registration: { tournament: tournamentWhere, ...buildActiveRegistrationWhere() } },
        select: { registration: { select: { tournament: { select: { seriesId: true } } } } },
      })
    : [];
  const playerCounts = new Map(seriesIds.map((id) => [id, 0]));
  playerRows.forEach((row) => { const id = row.registration?.tournament?.seriesId; if (id) playerCounts.set(id, (playerCounts.get(id) || 0) + 1); });
  return new Map(seriesIds.map((seriesId) => {
    const children = grouped.get(seriesId) || [];
    return [seriesId, {
      games: children.length,
      teamsRegistered: children.reduce((total, child) => total + (child._count?.teamRegistrations || 0), 0),
      playersRegistered: playerCounts.get(seriesId) || 0,
      availableSlots: sumAvailableSlots(children),
      registrationState: deriveRegistrationState(children),
    }];
  }));
};

module.exports = {
  getEventAggregate,
  getEventAggregates,
  deriveRegistrationState,
  getChildCapacity,
};
