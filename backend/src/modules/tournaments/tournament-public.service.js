const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { buildPagination } = require("../../lib/pagination");
const { normalizeEmail, normalizeText, normalizeSlug } = require("../../lib/validation");
const { buildActiveRegistrationWhere } = require("./registration-eligibility");
const { expireTournamentRegistrationReservation } = require("../payments/payment.service");
const { ensureTeamRegistrationSaved } = require("../teams/team.service");
const { countOutstandingInvites } = require("../teams/roster-invite-counts");
const {
  PUBLIC_PARTICIPANT_PAGE_SIZE,
  buildRegistrationCountInclude,
} = require("./tournament-shared");
const {
  withRegistrationCount,
  mapTournament,
  mapTournamentWithPublicTeams,
  sortPublicTournaments,
} = require("./tournament-mapping");

const listPublicTournaments = async ({ game } = {}) => {
  const normalizedGame = normalizeText(game).toLowerCase();
  const tournaments = await prisma.tournament.findMany({
    where: {
      isPublished: true,
      ...(normalizedGame && normalizedGame !== "all"
        ? {
            OR: [
              { gameCategory: { slug: normalizedGame, isPublished: true } },
              { game: normalizedGame },
            ],
          }
        : {}),
    },
    orderBy: [
      { displayPriority: "asc" },
      { isFeatured: "desc" },
      { startDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: buildRegistrationCountInclude(),
  });

  return sortPublicTournaments(tournaments.map(mapTournament));
};

const getPublicTournamentBySlug = async (slug, query = {}) => {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const hasParticipantPaginationQuery =
    query.participantPage !== undefined || query.participantPageSize !== undefined;
  const participantPagination = buildPagination({
    page: query.participantPage,
    pageSize: hasParticipantPaginationQuery
      ? query.participantPageSize
      : PUBLIC_PARTICIPANT_PAGE_SIZE,
  });
  const tournament = await prisma.tournament.findFirst({
    where: {
      slug: normalizedSlug,
      isPublished: true,
    },
    include: {
      ...buildRegistrationCountInclude(),
      teamRegistrations: {
        where: {
          ...buildActiveRegistrationWhere({ approvedOnly: true }),
        },
        orderBy: [{ teamName: "asc" }, { id: "asc" }],
        skip: (participantPagination.page - 1) * participantPagination.pageSize,
        take: participantPagination.pageSize,
        select: {
          id: true,
          teamName: true,
          captainName: true,
          entryType: true,
          teamLogoName: true,
          savedTeam: { select: { logoName: true } },
          status: true,
          user: { select: { avatarImageName: true } },
          members: {
            select: { id: true, role: true },
          },
        },
      },
      bracket: true,
      challongeIntegration: {
        select: {
          enabled: true,
          snapshotData: true,
          participantLinks: {
            select: {
              externalParticipantId: true,
              displayName: true,
              isConfirmed: true,
              registration: {
                select: {
                  teamName: true,
                  teamLogoName: true,
                  savedTeam: { select: { logoName: true } },
                },
              },
            },
          },
        },
      },
      posters: {
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          createdAt: true,
          imageAsset: { select: { storedFilename: true } },
        },
      },
      eventAlbums: {
        where: { isPublished: true },
        orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          location: true,
          eventDate: true,
          _count: { select: { photos: true } },
          photos: {
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            take: 5,
            select: { id: true, caption: true },
          },
        },
      },
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const total = await prisma.teamRegistration.count({
    where: {
      tournamentId: tournament.id,
      ...buildActiveRegistrationWhere({ approvedOnly: true }),
    },
  });
  const capacityUsed = withRegistrationCount(tournament).capacityUsed;
  const tournamentWithPublicTotals = {
    ...tournament,
    registrationCount: total,
    capacityUsed,
  };

  // The participant projection is bounded on every path, so a published
  // bracket must resolve its live team names and logos from its own read.
  // Falling back to the bounded participant page would serve stale bracket
  // names for any tournament with more approved teams than one page.
  const bracketRegistrations = tournament.bracket?.status === "published"
    ? await prisma.teamRegistration.findMany({
        where: {
          tournamentId: tournament.id,
          ...buildActiveRegistrationWhere({ approvedOnly: true }),
        },
        select: {
          id: true,
          teamName: true,
          teamLogoName: true,
          savedTeam: { select: { logoName: true } },
        },
      })
    : null;

  if (!hasParticipantPaginationQuery) {
    return mapTournamentWithPublicTeams(tournamentWithPublicTotals, { bracketRegistrations });
  }

  return mapTournamentWithPublicTeams(
    tournamentWithPublicTotals,
    {
      participantPagination: {
        page: participantPagination.page,
        pageSize: participantPagination.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / participantPagination.pageSize)),
      },
      bracketRegistrations,
    },
  );
};

const getTournamentRegistrationStatus = async ({ slug, user }) => {
  const tournamentSlug = normalizeSlug(slug);

  if (!tournamentSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug: tournamentSlug },
    select: {
      id: true,
      registrationFeeAmount: true,
      contactLink: true,
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const loadExistingRegistration = () => prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      AND: [
        {
          OR: [
            { userId: user.id },
            { userId: null, captainEmail: normalizeEmail(user.email) },
          ],
        },
      ],
    },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      verificationStatus: true,
      reservedUntil: true,
      assignedSlotNumber: true,
      members: {
        select: { role: true, inviteStatus: true, inviteExpiresAt: true },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          providerOrderId: true,
          provider: true,
          status: true,
        },
      },
    },
  });
  let existingRegistration = await loadExistingRegistration();

  if (
    existingRegistration?.paymentStatus === "pending" &&
    existingRegistration.reservedUntil &&
    existingRegistration.reservedUntil <= new Date()
  ) {
    await expireTournamentRegistrationReservation({
      registrationId: existingRegistration.id,
    });
    existingRegistration = await loadExistingRegistration();
  }

  if (existingRegistration) {
    await ensureTeamRegistrationSaved(existingRegistration.id);
  }

  const registrationMembers = existingRegistration?.members || [];
  const rosterRegistrationMembers = registrationMembers.filter(
    (member) => member.role !== "CAPTAIN"
  );
  const effectiveVerificationStatus = rosterRegistrationMembers.some(
    (member) => member.inviteStatus === "declined"
  )
    ? "flagged"
    : registrationMembers.length > 0 && rosterRegistrationMembers.every(
        (member) => member.inviteStatus === "accepted"
      )
      ? "verified"
      : existingRegistration?.verificationStatus;

  return {
    isRegistered: Boolean(existingRegistration),
    registration: existingRegistration
      ? {
          id: existingRegistration.id,
          status: existingRegistration.status,
          paymentStatus: existingRegistration.paymentStatus,
          verificationStatus: effectiveVerificationStatus,
          ...countOutstandingInvites(registrationMembers),
          reservedUntil: existingRegistration.reservedUntil,
          assignedSlotNumber: existingRegistration.assignedSlotNumber,
          contactLink: tournament.contactLink,
          payment: existingRegistration.payments[0]
            ? {
                orderId: existingRegistration.payments[0].providerOrderId,
                provider: existingRegistration.payments[0].provider,
                status: existingRegistration.payments[0].status,
              }
            : null,
        }
      : null,
  };
};

module.exports = {
  listPublicTournaments,
  getPublicTournamentBySlug,
  getTournamentRegistrationStatus,
};
