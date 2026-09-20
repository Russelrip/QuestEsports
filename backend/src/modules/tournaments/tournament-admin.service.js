const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { recordAuditInTransaction } = require("../../lib/audit");
const { removeUploadsQuietly, removeTeamLogoIfUnreferenced } = require("../../lib/upload-cleanup");
const {
  persistTournamentScheduleUpload,
  bankTransferProofDirectory,
  tournamentScheduleDirectory,
  sponsorLogoDirectory,
} = require("../../middleware/upload");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const { normalizeText, normalizeInteger } = require("../../lib/validation");
const {
  TOURNAMENT_STATUSES,
  buildRegistrationCountInclude,
  adminRegistrationSummarySelect,
  tournamentAssetFields,
  normalizeBooleanFlag,
  ensureSlugAvailable,
  getUploadedFile,
} = require("./tournament-shared");
const {
  mapTournament,
  mapAdminTournament,
  mapTournamentWithRegistrations,
} = require("./tournament-mapping");
const { buildScheduleData, parseEditableScheduleData } = require("./tournament-schedule");
const {
  normalizeTournamentInput,
  ensureRulebookMatchesTournamentGame,
} = require("./tournament-input");

const listAdminTournaments = async ({ page, pageSize, search, status, isPublished } = {}) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const normalizedStatus = normalizeText(status).toLowerCase();
  if (normalizedStatus && !TOURNAMENT_STATUSES.has(normalizedStatus)) {
    throw new HttpError(400, "Tournament status is invalid.");
  }
  const visibilityFilter =
    typeof isPublished === "string" && isPublished.length > 0
      ? normalizeBooleanFlag(isPublished)
      : undefined;
  const where = {
    ...(normalizedSearch
      ? {
          OR: [
            { title: { contains: normalizedSearch, mode: "insensitive" } },
            { slug: { contains: normalizedSearch, mode: "insensitive" } },
            { game: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    ...(typeof visibilityFilter === "boolean" ? { isPublished: visibilityFilter } : {}),
  };

  const [total, tournaments] = await prisma.$transaction([
    prisma.tournament.count({ where }),
    prisma.tournament.findMany({
      where,
      orderBy: [
        { displayPriority: "asc" },
        { startDate: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: buildRegistrationCountInclude(),
    }),
  ]);

  return buildPagedResponse({
    items: tournaments.map(mapTournament),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminTournamentById = async (tournamentId) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      bracket: true,
      ...buildRegistrationCountInclude(),
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const registrations = await prisma.teamRegistration.findMany({
    where: { tournamentId },
    orderBy: { createdAt: "desc" },
    select: adminRegistrationSummarySelect,
  });

  return mapTournamentWithRegistrations(tournament, registrations);
};

const getReplacedTournamentUploads = ({ existingTournament, assetUpdates }) => {
  const uploads = [];
  const collect = ({ field, directory }) => {
    if (!Object.prototype.hasOwnProperty.call(assetUpdates, field)) {
      return;
    }

    const previousFilename = existingTournament[field];
    const nextFilename = assetUpdates[field];

    if (previousFilename && previousFilename !== nextFilename) {
      uploads.push({
        directory,
        filename: previousFilename,
      });
    }
  };

  tournamentAssetFields.forEach(collect);
  collect({
    field: "scheduleFileName",
    directory: tournamentScheduleDirectory,
  });

  return uploads;
};

const buildTournamentAssetUpdates = async ({ body, files }) => {
  const data = {};
  const uploadedFiles = [];

  try {
    for (const assetField of tournamentAssetFields) {
      const upload = await assetField.persist(
        getUploadedFile(files, assetField.uploadKey)
      );

      if (upload) {
        data[assetField.field] = upload.filename;
        uploadedFiles.push({
          directory: assetField.directory,
          filename: upload.filename,
        });
        continue;
      }

      if (normalizeBooleanFlag(body[assetField.removeFlag])) {
        data[assetField.field] = null;
      }
    }

    const scheduleFile = getUploadedFile(files, "scheduleFile");
    const editableScheduleData = parseEditableScheduleData(body.scheduleData);
    const persistedSchedule = await persistTournamentScheduleUpload(scheduleFile);

    if (persistedSchedule) {
      uploadedFiles.push({
        directory: tournamentScheduleDirectory,
        filename: persistedSchedule.filename,
      });
      const scheduleData = editableScheduleData === undefined
        ? await buildScheduleData(scheduleFile)
        : editableScheduleData;
      data.scheduleFileName = persistedSchedule.filename;
      data.scheduleData = scheduleData || Prisma.JsonNull;
    } else if (editableScheduleData !== undefined) {
      data.scheduleData = editableScheduleData || Prisma.JsonNull;
    } else if (normalizeBooleanFlag(body.removeScheduleFile)) {
      data.scheduleFileName = null;
      data.scheduleData = Prisma.JsonNull;
    }

    return {
      data,
      uploadedFiles,
    };
  } catch (error) {
    await removeUploadsQuietly(uploadedFiles, {
      operation: "buildTournamentAssetUpdates",
    });
    throw error;
  }
};

const createAdminTournament = async ({ body, files, auditContext = {} }) => {
  const payload = normalizeTournamentInput({ body });
  await ensureSlugAvailable(payload.slug);
  await ensureRulebookMatchesTournamentGame(payload);
  const assetUpdates = await buildTournamentAssetUpdates({ body, files });

  let tournament;

  try {
    const persist = (database) => database.tournament.create({
      data: {
        id: crypto.randomUUID(),
        ...payload,
        ...assetUpdates.data,
      },
      include: buildRegistrationCountInclude(),
    });
    tournament = auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress
      ? await prisma.$transaction(async (tx) => {
        const created = await persist(tx);
        await recordAuditInTransaction(tx, {
          ...auditContext,
          action: "tournament.created",
          targetType: "Tournament",
          targetId: created.id,
          afterData: {
            slug: created.slug,
            status: created.status,
            isPublished: created.isPublished,
            seriesId: created.seriesId,
            seriesOrder: created.seriesOrder,
          },
        });
        return created;
      })
      : await persist(prisma);
  } catch (error) {
    await removeUploadsQuietly(assetUpdates.uploadedFiles, {
      operation: "createAdminTournament",
    });
    throw error;
  }

  return mapAdminTournament(tournament);
};

const updateAdminTournament = async ({ tournamentId, body, files, auditContext = {} }) => {
  const existingTournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!existingTournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const payload = normalizeTournamentInput({ body, existingTournament });
  await ensureSlugAvailable(payload.slug, tournamentId);
  await ensureRulebookMatchesTournamentGame(payload);
  const assetUpdates = await buildTournamentAssetUpdates({
    body,
    files,
  });

  let tournament;

  try {
    const persist = (database) => database.tournament.update({
      where: { id: tournamentId },
      data: {
        ...payload,
        ...assetUpdates.data,
      },
      include: buildRegistrationCountInclude(),
    });
    tournament = auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress
      ? await prisma.$transaction(async (tx) => {
        const before = await tx.tournament.findUnique({ where: { id: tournamentId } });
        if (!before) throw new HttpError(404, "Tournament not found.");
        const updated = await persist(tx);
        await recordAuditInTransaction(tx, {
          ...auditContext,
          action: "tournament.updated",
          targetType: "Tournament",
          targetId: updated.id,
          beforeData: { slug: before.slug, status: before.status, isPublished: before.isPublished },
          afterData: { slug: updated.slug, status: updated.status, isPublished: updated.isPublished },
        });
        return updated;
      })
      : await persist(prisma);
  } catch (error) {
    await removeUploadsQuietly(assetUpdates.uploadedFiles, {
      operation: "updateAdminTournament",
      tournamentId,
    });
    throw error;
  }

  await removeUploadsQuietly(
    getReplacedTournamentUploads({
      existingTournament,
      assetUpdates: assetUpdates.data,
    }),
    {
      operation: "updateAdminTournament",
      tournamentId,
    }
  );

  return mapAdminTournament(tournament);
};

const attachTournamentToSeries = async ({ tournamentId, seriesId, seriesOrder, auditContext = {} }) => {
  const normalizedOrder = normalizeInteger(seriesOrder);
  const persist = (database) => database.tournament.update({
    where: { id: tournamentId },
    data: {
      seriesId,
      ...(normalizedOrder === null ? {} : { seriesOrder: normalizedOrder }),
    },
    include: buildRegistrationCountInclude(),
  });
  const tournament = auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress
    ? await prisma.$transaction(async (tx) => {
      const existingTournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!existingTournament) throw new HttpError(404, "Tournament not found.");
      const updated = await persist(tx);
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "tournament.series_attached",
        targetType: "Tournament",
        targetId: updated.id,
        beforeData: { seriesId: existingTournament.seriesId, seriesOrder: existingTournament.seriesOrder },
        afterData: { seriesId: updated.seriesId, seriesOrder: updated.seriesOrder },
      });
      return updated;
    })
    : await prisma.$transaction(async (tx) => {
      const existingTournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
      if (!existingTournament) throw new HttpError(404, "Tournament not found.");
      return persist(tx);
    });
  return mapAdminTournament(tournament);
};

const deleteAdminTournament = async (tournamentId, auditContext = {}) => {
  const deleteMutation = async (database) => database.tournament.deleteMany({ where: { id: tournamentId } });
  const { deleted, existingTournament } = await prisma.$transaction(async (tx) => {
    const before = await tx.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        sponsors: { select: { logoImageName: true } },
        teamRegistrations: {
          select: {
            teamLogoName: true,
            payments: {
              select: {
                bankTransferProof: { select: { storedFilename: true } },
              },
            },
          },
        },
      },
    });
    if (!before) throw new HttpError(404, "Tournament not found.");

    const result = await deleteMutation(tx);
    if (result.count && (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress)) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "tournament.deleted",
        targetType: "Tournament",
        targetId: tournamentId,
        beforeData: { slug: before.slug, status: before.status, isPublished: before.isPublished },
      });
    }
    return { deleted: result, existingTournament: before };
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Tournament not found.");
  }

  await removeUploadsQuietly(
    getReplacedTournamentUploads({
      existingTournament,
      assetUpdates: {
        bannerImageName: null,
        heroImageName: null,
        completedPosterImageName: null,
        firstPlaceImageName: null,
        secondPlaceImageName: null,
        thirdPlaceImageName: null,
        scheduleFileName: null,
      },
    }).concat((existingTournament.sponsors || []).filter((sponsor) => sponsor.logoImageName).map((sponsor) => ({ directory: sponsorLogoDirectory, filename: sponsor.logoImageName }))),
    {
      operation: "deleteAdminTournament",
      tournamentId,
    }
  );

  const bankProofUploads = existingTournament.teamRegistrations
    .flatMap((registration) => registration.payments)
    .map((payment) => payment.bankTransferProof?.storedFilename)
    .filter(Boolean)
    .map((filename) => ({ directory: bankTransferProofDirectory, filename }));
  await removeUploadsQuietly(bankProofUploads, {
    operation: "deleteAdminTournamentBankProofs",
    tournamentId,
  });

  const teamLogoNames = new Set(
    existingTournament.teamRegistrations
      .map((registration) => registration.teamLogoName)
      .filter(Boolean)
  );
  for (const filename of teamLogoNames) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename,
      context: { operation: "deleteAdminTournamentTeamLogo", tournamentId },
    });
  }
};

module.exports = {
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  attachTournamentToSeries,
  deleteAdminTournament,
};
