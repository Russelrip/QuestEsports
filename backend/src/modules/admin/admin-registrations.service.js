const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly, removeTeamLogoIfUnreferenced } = require("../../lib/upload-cleanup");
const {
  EXCEL_CONTENT_TYPE,
  MAX_EXCEL_EXPORT_RECORDS,
  assertExportRecordLimit,
  buildExcelWorkbookBuffer,
  buildExportFilename,
  formatExportBoolean,
  formatExportTimestamp,
} = require("../../lib/excel-export");
const {
  bankTransferProofDirectory,
  persistTeamLogoUpload,
  teamLogoDirectory,
} = require("../../middleware/upload");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const { normalizeText } = require("../../lib/validation");
const {
  allocateLowestAvailableSlot,
  countTournamentCapacityUsage,
  hasAvailableCapacity,
} = require("../tournaments/registration-eligibility");
const { getBankTransferAmountForSlot } = require("../payments/bank-transfer.service");
const { recordAuditInTransaction } = require("../../lib/audit");
const {
  UUID_PATTERN,
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  VERIFICATION_STATUSES,
  runAdminSerializable,
  assertAdminRoleConflict,
  TOURNAMENT_SUMMARY_SELECT,
  TEAM_REGISTRATION_INCLUDE,
  TEAM_REGISTRATION_SUMMARY_SELECT,
  mapTeamRegistration,
  mapTeamRegistrationSummary,
  syncGameIdentityData,
} = require("./admin-shared");

const buildRegistrationWhere = ({
  eventId,
  game,
  search,
  tournamentId,
  tournament,
  status,
  paymentStatus,
  verificationStatus,
}) => {
  const normalizedEventId = normalizeText(eventId);
  const normalizedGame = normalizeText(game);
  const normalizedSearch = normalizeText(search);
  const normalizedTournament = normalizeText(tournament);
  const normalizedStatus = normalizeText(status).toLowerCase();
  const normalizedPaymentStatus = normalizeText(paymentStatus).toLowerCase();
  const normalizedVerificationStatus = normalizeText(verificationStatus).toLowerCase();

  const tournamentFilters = [
    ...(normalizedEventId ? [{ seriesId: normalizedEventId }] : []),
    ...(normalizedGame ? [{ game: { equals: normalizedGame, mode: "insensitive" } }] : []),
    ...(normalizedTournament
      ? [{
          OR: [
            // Tournament.id is @db.Uuid. The admin filter sends a slug, and
            // PostgreSQL rejects the whole statement with "invalid input syntax
            // for type uuid" when a non-uuid literal is compared against it --
            // so an unguarded id clause failed the entire request rather than
            // simply not matching. Slug and title still cover the filter.
            ...(UUID_PATTERN.test(normalizedTournament) ? [{ id: normalizedTournament }] : []),
            { slug: normalizedTournament },
            { title: { contains: normalizedTournament, mode: "insensitive" } },
          ],
        }]
      : []),
  ];

  return {
    ...(tournamentId ? { tournamentId } : {}),
    ...(tournamentFilters.length > 0
      ? { tournament: tournamentFilters.length === 1 ? tournamentFilters[0] : { AND: tournamentFilters } }
      : {}),
    ...(REGISTRATION_STATUSES.has(normalizedStatus) ? { status: normalizedStatus } : {}),
    ...(PAYMENT_STATUSES.has(normalizedPaymentStatus)
      ? { paymentStatus: normalizedPaymentStatus }
      : {}),
    ...(VERIFICATION_STATUSES.has(normalizedVerificationStatus)
      ? { verificationStatus: normalizedVerificationStatus }
      : {}),
    ...(normalizedSearch
      ? {
          OR: [
            { teamName: { contains: normalizedSearch, mode: "insensitive" } },
            { captainName: { contains: normalizedSearch, mode: "insensitive" } },
            { captainEmail: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };
};

const REGISTRATION_LIST_MAX_PAGE_SIZE = 100;

const listTeamRegistrations = async (query = {}) => {
  const pagination = buildPagination(query, { maxPageSize: REGISTRATION_LIST_MAX_PAGE_SIZE });
  const where = buildRegistrationWhere(query);

  const [total, registrations, tournaments] = await prisma.$transaction([
    prisma.teamRegistration.count({ where }),
    prisma.teamRegistration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: TEAM_REGISTRATION_SUMMARY_SELECT,
    }),
    prisma.tournament.findMany({
      ...(query.eventId ? { where: { seriesId: normalizeText(query.eventId) } } : {}),
      orderBy: { startDate: { sort: "desc", nulls: "last" } },
      select: TOURNAMENT_SUMMARY_SELECT,
    }),
  ]);

  return {
    ...buildPagedResponse({
      items: registrations.map(mapTeamRegistrationSummary),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }),
    tournaments,
  };
};

const getAdminTeamRegistrationById = async (registrationId) => {
  const registration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    include: TEAM_REGISTRATION_INCLUDE,
  });
  if (!registration) throw new HttpError(404, "Team registration not found.");
  return mapTeamRegistration(registration);
};

const updateTeamRegistrationGameIds = async (registrationId, body = {}, auditContext = {}) => {
  const captainGameId = normalizeText(body.captainGameId);
  const requestedMembers = Array.isArray(body.members) ? body.members : [];

  if (!captainGameId || captainGameId.length > 100) {
    throw new HttpError(400, "The captain needs a Game ID of 100 characters or fewer.");
  }
  if (requestedMembers.length > 20) {
    throw new HttpError(400, "A registration can include up to 20 roster members.");
  }

  const normalizedMembers = requestedMembers.map((member) => ({
    id: normalizeText(member.id),
    gameId: normalizeText(member.gameId),
  }));
  if (normalizedMembers.some((member) => !member.id || !member.gameId || member.gameId.length > 100)) {
    throw new HttpError(400, "Every roster member needs a Game ID of 100 characters or fewer.");
  }
  if (new Set(normalizedMembers.map((member) => member.id)).size !== normalizedMembers.length) {
    throw new HttpError(400, "Each roster member can only be updated once.");
  }

  await runAdminSerializable(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        additionalData: true,
        tournament: { select: { id: true, game: true, registrationFields: true } },
        members: {
          select: {
            id: true,
            role: true,
            additionalData: true,
            email: true,
            emailNormalized: true,
            riotId: true,
          },
        },
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");

    const memberById = new Map(registration.members.map((member) => [member.id, member]));
    if (normalizedMembers.length !== registration.members.length) {
      throw new HttpError(400, "Submit a Game ID for every roster member.");
    }
    if (normalizedMembers.some((member) => !memberById.has(member.id))) {
      throw new HttpError(400, "One or more roster members do not belong to this registration.");
    }

    await assertAdminRoleConflict({
      tx,
      tournamentId: registration.tournament.id,
      members: registration.members.map((member) => ({
        ...member,
        riotId: member.role === "CAPTAIN"
          ? captainGameId
          : normalizedMembers.find((requested) => requested.id === member.id)?.gameId || member.riotId,
      })),
      excludeRegistrationId: registrationId,
    });

    const entryData = syncGameIdentityData({
      additionalData: registration.additionalData,
      registrationFields: registration.tournament.registrationFields,
      scope: "entry",
      game: registration.tournament.game,
      gameId: captainGameId,
    });
    await tx.teamRegistration.update({
      where: { id: registrationId },
      data: {
        captainRiotId: captainGameId,
        ...(entryData.changed ? { additionalData: entryData.data } : {}),
      },
    });

    for (const member of normalizedMembers) {
      const existingMember = memberById.get(member.id);
      const gameId = existingMember.role === "CAPTAIN" ? captainGameId : member.gameId;
      const memberData = syncGameIdentityData({
        additionalData: existingMember.additionalData,
        registrationFields: registration.tournament.registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId,
      });
      await tx.registrationMember.update({
        where: { id: member.id },
        data: {
          riotId: gameId,
          ...(memberData.changed ? { additionalData: memberData.data } : {}),
        },
      });
    }
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
          actorUserId: auditContext.actorUserId || null,
          action: "team_registration.game_ids_updated",
          targetType: "TeamRegistration",
          targetId: registrationId,
          afterData: {
            captainUpdated: true,
            memberCount: normalizedMembers.length,
          },
          requestId: auditContext.requestId || null,
          ipAddress: auditContext.ipAddress || null,
      });
    }
  });

  return getAdminTeamRegistrationById(registrationId);
};

const exportTeamRegistrations = async (query = {}) => {
  const where = buildRegistrationWhere(query);
  const registrations = await prisma.teamRegistration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_EXCEL_EXPORT_RECORDS + 1,
    include: TEAM_REGISTRATION_INCLUDE,
  });
  assertExportRecordLimit({
    records: registrations,
    label: "Team registration",
  });
  const mappedRegistrations = registrations.map(mapTeamRegistration);
  const registrationRows = mappedRegistrations.map((registration) => ({
    tournamentTitle: registration.tournament?.title || "",
    tournamentSlug: registration.tournament?.slug || "",
    teamName: registration.teamName,
    country: registration.country || "",
    teamTag: registration.teamTag || "",
    organizationRequested: formatExportBoolean(
      registration.organizationRequested
    ),
    approvalStatus: registration.status,
    paymentStatus: registration.paymentStatus,
    verificationStatus: registration.verificationStatus,
    captainName: registration.captain.name,
    captainEmail: registration.captain.email,
    captainPhone: registration.captain.phone,
    captainDiscord: registration.captain.discord,
    captainRiotId: registration.captain.riotId,
    coachName: registration.coach?.name || "",
    coachEmail: registration.coach?.email || "",
    coachContact: registration.coach?.phone || "",
    coachDiscord: registration.coach?.discord || "",
    coachRiotId: registration.coach?.riotId || "",
    contactEmail: registration.contactEmail,
    rosterCount: registration.members.length,
    acceptedMembers: registration.members.filter((member) => member.inviteStatus === "accepted").length,
    submittedAt: formatExportTimestamp(registration.createdAt),
    logoUrl: registration.logoUrl || "",
  }));
  const memberRows = mappedRegistrations.flatMap((registration) =>
    registration.members
      .filter((member) => member.role !== "COACH")
      .map((member) => ({
        tournamentTitle: registration.tournament?.title || "",
        tournamentSlug: registration.tournament?.slug || "",
        teamName: registration.teamName,
        registrationId: registration.id,
        role: member.role,
        order: member.order,
        name: member.name,
        email: member.email || "",
        discord: member.discord || "",
        riotId: member.riotId || "",
        inviteStatus: member.inviteStatus,
        inviteRespondedAt: formatExportTimestamp(member.inviteRespondedAt),
        accountUsername: member.account?.username || "",
        accountEmail: member.account?.email || "",
      }))
  );

  const buffer = await buildExcelWorkbookBuffer({
    sheets: [
      {
        name: "Registrations",
        columns: [
          { header: "Tournament", key: "tournamentTitle", width: 28 },
          { header: "Tournament Slug", key: "tournamentSlug", width: 24 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Country", key: "country", width: 18 },
          { header: "Team Tag", key: "teamTag", width: 14 },
          {
            header: "Organization Requested",
            key: "organizationRequested",
            width: 22,
          },
          { header: "Approval", key: "approvalStatus", width: 16 },
          { header: "Payment", key: "paymentStatus", width: 16 },
          { header: "Verification", key: "verificationStatus", width: 16 },
          { header: "Captain Name", key: "captainName", width: 24 },
          { header: "Captain Email", key: "captainEmail", width: 28 },
          { header: "Captain Phone", key: "captainPhone", width: 18 },
          { header: "Captain Discord", key: "captainDiscord", width: 22 },
          { header: "Captain Riot ID", key: "captainRiotId", width: 22 },
          { header: "Coach Name", key: "coachName", width: 24 },
          { header: "Coach Email", key: "coachEmail", width: 28 },
          { header: "Coach Contact", key: "coachContact", width: 18 },
          { header: "Coach Discord", key: "coachDiscord", width: 22 },
          { header: "Coach Riot ID", key: "coachRiotId", width: 22 },
          { header: "Contact Email", key: "contactEmail", width: 28 },
          { header: "Roster Count", key: "rosterCount", width: 14 },
          { header: "Accepted Members", key: "acceptedMembers", width: 18 },
          { header: "Submitted At", key: "submittedAt", width: 26 },
          { header: "Logo URL", key: "logoUrl", width: 32 },
        ],
        rows: registrationRows,
      },
      {
        name: "Roster Members",
        columns: [
          { header: "Tournament", key: "tournamentTitle", width: 28 },
          { header: "Tournament Slug", key: "tournamentSlug", width: 24 },
          { header: "Team Name", key: "teamName", width: 24 },
          { header: "Registration ID", key: "registrationId", width: 38 },
          { header: "Role", key: "role", width: 16 },
          { header: "Order", key: "order", width: 10 },
          { header: "Name", key: "name", width: 24 },
          { header: "Email", key: "email", width: 28 },
          { header: "Discord", key: "discord", width: 22 },
          { header: "Riot ID", key: "riotId", width: 22 },
          { header: "Invite Status", key: "inviteStatus", width: 16 },
          { header: "Invite Responded At", key: "inviteRespondedAt", width: 26 },
          { header: "Account Username", key: "accountUsername", width: 22 },
          { header: "Account Email", key: "accountEmail", width: 28 },
        ],
        rows: memberRows,
      },
    ],
  });

  return {
    buffer,
    contentType: EXCEL_CONTENT_TYPE,
    filename: buildExportFilename("team-registrations"),
    recordCount: mappedRegistrations.length,
  };
};

const getRegistrationsByTournament = async (tournamentId, query = {}) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: TOURNAMENT_SUMMARY_SELECT,
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const result = await listTeamRegistrations({
    ...query,
    tournamentId,
  });

  return {
    tournament,
    ...result,
  };
};

const deleteTeamRegistration = async (registrationId, auditContext = {}) => {
  const registrationSnapshot = {
    teamLogoName: true,
    payments: {
      select: {
        bankTransferProof: {
          select: { storedFilename: true },
        },
      },
    },
  };
  const transaction = typeof prisma.$transaction === "function"
    ? prisma.$transaction.bind(prisma)
    : async (work) => work(prisma);
  const { registration } = await transaction(async (tx) => {
    const current = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: registrationSnapshot,
    });
    if (!current) throw new HttpError(404, "Team registration not found.");
    const result = await tx.teamRegistration.deleteMany({ where: { id: registrationId } });
    if (result.count === 0) throw new HttpError(404, "Team registration not found.");
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.deleted",
        targetType: "TeamRegistration",
        targetId: registrationId,
        beforeData: {
          teamLogoName: current.teamLogoName,
          paymentProofCount: current.payments.filter((payment) => payment.bankTransferProof?.storedFilename).length,
        },
        afterData: { deleted: true },
      });
    }
    return { deleted: result, registration: current };
  });

  const uploads = registration.payments
    .map((payment) => payment.bankTransferProof?.storedFilename)
    .filter(Boolean)
    .map((filename) => ({ directory: bankTransferProofDirectory, filename }));
  await removeUploadsQuietly(
    uploads,
    {
      operation: "deleteTeamRegistration",
      registrationId,
    }
  );
  if (registration.teamLogoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: registration.teamLogoName,
      context: { operation: "deleteTeamRegistration", registrationId },
    });
  }
};

// Manages the logo of a registration that is not linked to a saved team. A
// linked registration takes its logo from `SavedTeam.logoName`, which stays
// authoritative, so writing one here would be silently invisible; those are
// refused and pointed at the saved-team editor instead.
const updateTeamRegistrationLogo = async (registrationId, { file, removeLogo } = {}, auditContext = {}) => {
  const registration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, teamName: true, teamLogoName: true, savedTeamId: true },
  });
  if (!registration) throw new HttpError(404, "Team registration not found.");
  if (registration.savedTeamId) {
    throw new HttpError(
      409,
      "This registration is linked to a saved team. Manage its logo on the saved team so every linked entry stays in sync.",
    );
  }
  if (!file && !removeLogo) {
    throw new HttpError(400, "Upload a team logo or ask for the current one to be removed.");
  }

  const persistedLogo = file ? await persistTeamLogoUpload(file) : null;
  const nextLogoName = persistedLogo ? persistedLogo.filename : null;
  const previousLogoName = registration.teamLogoName || null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.teamRegistration.update({
        where: { id: registrationId },
        data: { teamLogoName: nextLogoName },
      });
      if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
        await recordAuditInTransaction(tx, {
          ...auditContext,
          action: "team_registration.logo_updated",
          targetType: "TeamRegistration",
          targetId: registrationId,
          beforeData: { teamLogoName: previousLogoName },
          afterData: { teamLogoName: nextLogoName },
        });
      }
    });
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "updateTeamRegistrationLogoRollback", registrationId },
      );
    }
    throw error;
  }

  // Only after the write commits, and only if nothing else still points at it:
  // logo files are shared between registrations and saved teams.
  if (previousLogoName && previousLogoName !== nextLogoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: previousLogoName,
      context: { operation: "updateTeamRegistrationLogo", registrationId },
    });
  }

  return getAdminTeamRegistrationById(registrationId);
};

const reserveAdminRegistrationSlot = async ({ registrationId, adminUserId, body, auditContext = {} }) => {
  const note = normalizeText(body?.note) || null;
  if (note && note.length > 300) throw new HttpError(400, "Reservation note must be 300 characters or fewer.");
  return prisma.$transaction(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: {
          select: {
            id: true,
            maxTeams: true,
            paymentMethod: true,
            registrationFeeAmount: true,
            registrationFeeCurrency: true,
            registrationFeeTiers: true,
          },
        },
        members: { select: { inviteStatus: true } },
        adminSlotReservation: true,
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");
    if (registration.paymentStatus === "paid" || registration.status === "rejected") throw new HttpError(409, "This registration does not need a reserved slot.");
    if (!registration.members.some((member) => member.inviteStatus === "pending")) throw new HttpError(409, "Only teams with pending member invitations can receive an admin hold.");
    if (registration.adminSlotReservation) throw new HttpError(409, "This team already has an admin-reserved slot.");
    const used = await countTournamentCapacityUsage({ tx, tournamentId: registration.tournamentId, excludeRegistrationId: registration.id });
    if (!hasAvailableCapacity(registration.tournament, used)) throw new HttpError(409, "The tournament has no slot available to reserve.");
    const assignedSlotNumber = await allocateLowestAvailableSlot({
      tx,
      tournamentId: registration.tournamentId,
      maxTeams: registration.tournament.maxTeams,
      excludeRegistrationId: registration.id,
    });
    const quotedFeeAmount = registration.tournament.paymentMethod === "bank_transfer"
      ? getBankTransferAmountForSlot(registration.tournament, assignedSlotNumber)
      : Number(registration.tournament.registrationFeeAmount);
    const reservation = await tx.adminSlotReservation.create({
      data: {
        tournamentId: registration.tournamentId,
        registrationId,
        createdById: adminUserId,
        assignedSlotNumber,
        quotedFeeAmount,
        quotedFeeCurrency: registration.tournament.registrationFeeCurrency,
        note,
      },
    });
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.slot_reserved",
        targetType: "AdminSlotReservation",
        targetId: reservation.id,
        afterData: {
          registrationId,
          assignedSlotNumber: reservation.assignedSlotNumber,
          quotedFeeAmount: reservation.quotedFeeAmount,
          quotedFeeCurrency: reservation.quotedFeeCurrency,
        },
      });
    }
    return reservation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const releaseAdminRegistrationSlot = async (registrationId, auditContext = {}) => {
  if (!auditContext.actorUserId && !auditContext.requestId && !auditContext.ipAddress) {
    const removed = await prisma.adminSlotReservation.deleteMany({ where: { registrationId } });
    if (!removed.count) throw new HttpError(404, "Admin slot reservation not found.");
    return;
  }
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.adminSlotReservation.findUnique({ where: { registrationId } });
    if (!reservation) throw new HttpError(404, "Admin slot reservation not found.");
    await tx.adminSlotReservation.delete({ where: { id: reservation.id } });
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "team_registration.slot_released",
        targetType: "AdminSlotReservation",
        targetId: reservation.id,
        beforeData: {
          registrationId,
          assignedSlotNumber: reservation.assignedSlotNumber,
          quotedFeeAmount: reservation.quotedFeeAmount,
          quotedFeeCurrency: reservation.quotedFeeCurrency,
        },
      });
    }
  });
};

module.exports = {
  listTeamRegistrations,
  getAdminTeamRegistrationById,
  updateTeamRegistrationGameIds,
  exportTeamRegistrations,
  getRegistrationsByTournament,
  deleteTeamRegistration,
  updateTeamRegistrationLogo,
  reserveAdminRegistrationSlot,
  releaseAdminRegistrationSlot,
};
