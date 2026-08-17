const { prisma } = require("../../lib/prisma");
const {
  buildActiveRegistrationWhere,
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

const deriveRegistrationState = (tournaments, now = new Date()) => {
  if (tournaments.length === 0) return "closed";

  if (tournaments.some((tournament) => {
    const capacityUsed = getChildCapacity(tournament);
    return tournament.status === "registration_open" &&
      !isFuture(tournament.registrationOpenAt, now) &&
      !isPast(tournament.registrationDeadline, now) &&
      capacityUsed < (tournament.maxTeams || 0);
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
  const availableSlots = tournaments.reduce((total, tournament) =>
    total + Math.max(0, (tournament.maxTeams || 0) - getChildCapacity(tournament)), 0);

  return {
    games: tournaments.length,
    teamsRegistered,
    playersRegistered,
    availableSlots,
    registrationState: deriveRegistrationState(tournaments),
  };
};

module.exports = {
  getEventAggregate,
  deriveRegistrationState,
  getChildCapacity,
};
