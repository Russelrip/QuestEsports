const crypto = require("crypto");
const { parse: parseCsv } = require("csv-parse/sync");
const { readSheet: readXlsxFile } = require("read-excel-file/node");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  removeUploadsQuietly,
  removeTeamLogoIfUnreferenced,
} = require("../../lib/upload-cleanup");
const {
  persistTournamentBannerUpload,
  persistTournamentScheduleUpload,
  bankTransferProofDirectory,
  tournamentBannerDirectory,
  tournamentScheduleDirectory,
  sponsorLogoDirectory,
} = require("../../middleware/upload");
const {
  buildPagination,
  buildPagedResponse,
} = require("../../lib/pagination");
const {
  normalizeEmail,
  normalizeText,
  normalizeSlug,
  normalizeInteger,
  normalizeOptionalUrl,
} = require("../../lib/validation");
const {
  buildShortCode,
  mapPublicBracket,
} = require("./bracket.service");
const {
  buildActiveRegistrationWhere,
  isRegistrationActive,
} = require("./registration-eligibility");
const {
  expireTournamentRegistrationReservation,
  isPayHereConfigured,
} = require("../payments/payment.service");
const { ensureTeamRegistrationSaved } = require("../teams/team.service");

const TOURNAMENT_STATUSES = new Set([
  "draft",
  "upcoming",
  "registration_open",
  "ongoing",
  "completed",
  "cancelled",
]);
const REGISTRATION_MODES = new Set(["open_entry", "slot_based"]);
const ENTRY_TYPES = new Set(["team", "solo"]);
const PAYMENT_METHODS = new Set(["free", "payhere", "bank_transfer"]);
const TOURNAMENT_DATE_STATUSES = new Set(["scheduled", "tba", "tbd"]);
const REGISTRATION_FIELD_TYPES = new Set(["text", "number", "select"]);
const REGISTRATION_FIELD_SCOPES = new Set(["entry", "member"]);
const buildRegistrationCountInclude = (now = new Date()) => ({
  _count: {
    select: {
      teamRegistrations: {
        where: buildActiveRegistrationWhere({ now }),
      },
      adminSlotReservations: true,
    },
  },
  teamRegistrations: {
    where: buildActiveRegistrationWhere({ now }),
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      reservedUntil: true,
    },
  },
  adminSlotReservations: {
    select: {
      registrationId: true,
      registration: {
        select: {
          status: true,
          paymentStatus: true,
          reservedUntil: true,
        },
      },
    },
  },
  rulebook: {
    select: {
      id: true,
      slug: true,
      title: true,
      game: true,
      variant: true,
    },
  },
  series: {
    select: {
      id: true,
      slug: true,
      title: true,
    },
  },
  gameCategory: true,
  sponsors: {
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  },
});
const adminRegistrationSummarySelect = {
  id: true,
  teamName: true,
  captainName: true,
  captainEmail: true,
  captainPhone: true,
  captainDiscord: true,
  captainRiotId: true,
  contactEmail: true,
  teamLogoName: true,
  savedTeam: { select: { logoName: true } },
  status: true,
  paymentStatus: true,
  verificationStatus: true,
  createdAt: true,
};
const tournamentAssetFields = [
  {
    field: "bannerImageName",
    uploadKey: "bannerImage",
    removeFlag: "removeBannerImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
  {
    field: "heroImageName",
    uploadKey: "heroImage",
    removeFlag: "removeHeroImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
  {
    field: "completedPosterImageName",
    uploadKey: "completedPosterImage",
    removeFlag: "removeCompletedPosterImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
  {
    field: "firstPlaceImageName",
    uploadKey: "firstPlaceImage",
    removeFlag: "removeFirstPlaceImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
  {
    field: "secondPlaceImageName",
    uploadKey: "secondPlaceImage",
    removeFlag: "removeSecondPlaceImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
  {
    field: "thirdPlaceImageName",
    uploadKey: "thirdPlaceImage",
    removeFlag: "removeThirdPlaceImage",
    directory: tournamentBannerDirectory,
    persist: persistTournamentBannerUpload,
  },
];
const normalizeBooleanFlag = (value) =>
  value === true || value === "true" || value === "on" || value === 1 || value === "1";

const parseDateValue = (value, fieldLabel) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new HttpError(400, `${fieldLabel} is required.`);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${fieldLabel} must be a valid date.`);
  }

  return parsed;
};

const parseOptionalDateValue = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseTournamentDateValue = ({
  body,
  existingTournament,
  valueKey,
  statusKey,
  fieldLabel,
}) => {
  const status = normalizeText(
    body[statusKey] ?? existingTournament?.[statusKey] ?? "scheduled"
  ).toLowerCase();

  if (!TOURNAMENT_DATE_STATUSES.has(status)) {
    throw new HttpError(400, `${fieldLabel} status must be Scheduled, TBA, or TBD.`);
  }

  if (status !== "scheduled") {
    return { status, value: null };
  }

  const rawValue = Object.prototype.hasOwnProperty.call(body, valueKey)
    ? body[valueKey]
    : existingTournament?.[valueKey];

  return {
    status,
    value: parseDateValue(rawValue, fieldLabel),
  };
};

const parseTournamentStatus = (value) => {
  const normalized = normalizeText(value).toLowerCase();

  if (!TOURNAMENT_STATUSES.has(normalized)) {
    throw new HttpError(400, "Invalid tournament status.");
  }

  return normalized;
};

const ensureSlugAvailable = async (slug, excludedTournamentId) => {
  const existingTournament = await prisma.tournament.findFirst({
    where: {
      slug,
      ...(excludedTournamentId ? { id: { not: excludedTournamentId } } : {}),
    },
    select: { id: true },
  });

  if (existingTournament) {
    throw new HttpError(400, "A tournament with this slug already exists.");
  }
};

const getTournamentBannerUrl = (bannerImageName) =>
  bannerImageName ? `/api/uploads/tournament-banners/${bannerImageName}` : null;

const getTeamLogoUrl = (teamLogoName) =>
  teamLogoName ? `/api/uploads/team-logos/${teamLogoName}` : null;

const getCurrentTeamLogoName = (registration) =>
  registration.savedTeam ? registration.savedTeam.logoName : registration.teamLogoName;

const getShowcaseImageUrl = (imageName) =>
  imageName ? `/api/uploads/tournament-banners/${imageName}` : null;

const mapGameCategory = (category) => category ? ({
  id: category.id,
  slug: category.slug,
  displayName: category.displayName,
  artworkUrl: category.artworkName ? `/api/uploads/game-assets/${category.artworkName}` : null,
  logoUrl: category.logoName ? `/api/uploads/game-assets/${category.logoName}` : null,
}) : null;

const mapSponsor = (sponsor) => ({
  id: sponsor.id,
  name: sponsor.name,
  partnershipLabel: sponsor.partnershipLabel,
  logoUrl: sponsor.logoImageName
    ? `/api/uploads/sponsor-logos/${sponsor.logoImageName}`
    : null,
  websiteUrl: sponsor.websiteUrl,
  displayOrder: sponsor.displayOrder,
});

const normalizeChallongeUrl = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (host !== "challonge.com" && !host.endsWith(".challonge.com"))
    ) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.at(-1)?.toLowerCase() === "module") segments.pop();
    if (segments.length === 0) return null;
    url.pathname = `/${segments.join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const buildChallongeEmbedUrl = (value) => {
  const normalized = normalizeChallongeUrl(value);
  return normalized ? `${normalized}/module` : null;
};

const getUploadedFile = (files, key) =>
  Array.isArray(files?.[key]) ? files[key][0] : null;

const normalizeScheduleCellValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }

    if ("result" in value && value.result !== undefined) {
      return String(value.result);
    }
  }

  return String(value);
};

const buildScheduleDataFromMatrix = ({ sheetName, matrix }) => {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return null;
  }

  const nonEmptyRows = matrix.filter((row) =>
    Array.isArray(row) && row.some((cell) => String(cell || "").trim().length > 0)
  );

  if (nonEmptyRows.length === 0) {
    return null;
  }

  const headerRow = nonEmptyRows[0];
  const headers = headerRow.map((header, index) =>
    String(header || `Column ${index + 1}`)
  );
  const rows = nonEmptyRows.slice(1).map((row) => {
    const record = {};

    headers.forEach((header, index) => {
      record[header] = String(row[index] || "");
    });

    return record;
  });

  return {
    sheetName,
    headers,
    rows,
  };
};

const buildScheduleData = async (file) => {
  if (!file?.buffer) {
    return null;
  }

  const extension = String(file.originalname || "")
    .split(".")
    .pop()
    ?.toLowerCase();

  if (extension === "csv") {
    const records = parseCsv(file.buffer, {
      bom: true,
      skip_empty_lines: true,
    });

    return buildScheduleDataFromMatrix({
      sheetName: "Schedule",
      matrix: records,
    });
  }

  if (extension === "xlsx") {
    const matrix = await readXlsxFile(file.buffer);

    return buildScheduleDataFromMatrix({
      sheetName: "Schedule",
      matrix: matrix.map((row) => row.map(normalizeScheduleCellValue)),
    });
  }

  throw new HttpError(400, "Only XLSX and CSV schedule files are supported.");
};

const parseEditableScheduleData = (value) => {
  if (value === undefined) {
    return undefined;
  }

  let schedule;
  try {
    schedule = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new HttpError(400, "Schedule data must be valid JSON.");
  }

  if (schedule === null) {
    return null;
  }

  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new HttpError(400, "Schedule data must be a valid schedule object.");
  }

  const sheetName = normalizeText(schedule.sheetName || "Tournament Schedule").slice(0, 120);
  if (!Array.isArray(schedule.headers) || schedule.headers.length === 0 || schedule.headers.length > 12) {
    throw new HttpError(400, "A schedule must have between 1 and 12 columns.");
  }

  const headers = schedule.headers.map((header) => normalizeText(header).slice(0, 60));
  if (headers.some((header) => !header)) {
    throw new HttpError(400, "Schedule column names cannot be empty.");
  }

  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new HttpError(400, "Schedule column names must be unique.");
  }

  if (!Array.isArray(schedule.rows) || schedule.rows.length > 500) {
    throw new HttpError(400, "A schedule can contain up to 500 rows.");
  }

  const rows = schedule.rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new HttpError(400, "Every schedule row must be a valid object.");
      }

      return Object.fromEntries(
        headers.map((header) => [header, String(row[header] ?? "").trim().slice(0, 300)])
      );
    })
    .filter((row) => headers.some((header) => row[header].length > 0));

  return { sheetName, headers, rows };
};

const withRegistrationCount = (tournament) => {
  if (tournament.registrationCount !== undefined) {
    return {
      ...tournament,
      capacityUsed: tournament.capacityUsed ?? tournament.registrationCount,
    };
  }

  const registrations = tournament.teamRegistrations || [];
  const confirmedRegistrationCount = registrations
    .filter(({ status }) => status === "approved")
    .length;
  const activeRegistrationCount = Number.isInteger(tournament._count?.teamRegistrations)
    ? tournament._count.teamRegistrations
    : registrations.filter((registration) => isRegistrationActive(registration)).length;
  const adminHoldCount = tournament._count?.adminSlotReservations || 0;
  const activeHeldRegistrationCount = (tournament.adminSlotReservations || [])
    .filter(({ registration }) => isRegistrationActive(registration))
    .length;
  const capacityUsed = activeRegistrationCount + adminHoldCount - activeHeldRegistrationCount;

  return {
    ...tournament,
    registrationCount: confirmedRegistrationCount,
    capacityUsed: tournament.capacityUsed ?? capacityUsed,
  };
};

const getRegistrationState = (tournament) => {
  const now = new Date();
  const registrationCount = tournament.capacityUsed ?? tournament.registrationCount ?? 0;

  if (tournament.registrationOpenAt && tournament.registrationOpenAt > now) {
    return "registration_closed";
  }

  if (registrationCount >= tournament.maxTeams) {
    return "slots_full";
  }

  if (tournament.registrationDeadline && tournament.registrationDeadline < now) {
    return "registration_closed";
  }

  if (tournament.status !== "registration_open") {
    return "registration_closed";
  }

  return "registration_open";
};

const mapTournament = (tournament) => {
  const tournamentWithRegistrationCount = withRegistrationCount(tournament);
  const registrationState = getRegistrationState(tournamentWithRegistrationCount);

  return {
    id: tournamentWithRegistrationCount.id,
    slug: tournamentWithRegistrationCount.slug,
    title: tournamentWithRegistrationCount.title,
    game: tournamentWithRegistrationCount.game,
    gameCategory: mapGameCategory(tournamentWithRegistrationCount.gameCategory),
    organizer: tournamentWithRegistrationCount.organizer || "Quest E-sports",
    country: tournamentWithRegistrationCount.country || "Sri Lanka",
    location: tournamentWithRegistrationCount.location || "TBA",
    series: tournamentWithRegistrationCount.series || null,
    seriesOrder: tournamentWithRegistrationCount.seriesOrder,
    displayPriority: tournamentWithRegistrationCount.displayPriority,
    bannerUrl: getTournamentBannerUrl(tournamentWithRegistrationCount.bannerImageName),
    heroUrl: getTournamentBannerUrl(
      tournamentWithRegistrationCount.heroImageName || tournamentWithRegistrationCount.bannerImageName
    ),
    shortDescription: tournamentWithRegistrationCount.shortDescription,
    fullDescription: tournamentWithRegistrationCount.fullDescription,
    rules: tournamentWithRegistrationCount.rules,
    rulebook: tournamentWithRegistrationCount.rulebook || null,
    registrationOpenAt: tournamentWithRegistrationCount.registrationOpenAt,
    startDate: tournamentWithRegistrationCount.startDate,
    startDateStatus: tournamentWithRegistrationCount.startDateStatus || "scheduled",
    endDate: tournamentWithRegistrationCount.endDate,
    endDateStatus: tournamentWithRegistrationCount.endDateStatus || "scheduled",
    registrationDeadline: tournamentWithRegistrationCount.registrationDeadline,
    registrationDeadlineStatus:
      tournamentWithRegistrationCount.registrationDeadlineStatus || "scheduled",
    format: tournamentWithRegistrationCount.format,
    registrationMode: tournamentWithRegistrationCount.registrationMode,
    entryType: tournamentWithRegistrationCount.entryType || "team",
    teamSize: tournamentWithRegistrationCount.teamSize,
    minRosterSize: tournamentWithRegistrationCount.minRosterSize || tournamentWithRegistrationCount.teamSize,
    maxRosterSize: tournamentWithRegistrationCount.maxRosterSize || tournamentWithRegistrationCount.teamSize,
    maxSubstitutes: tournamentWithRegistrationCount.maxSubstitutes || 0,
    registrationFields: tournamentWithRegistrationCount.registrationFields || [],
    paymentMethod: tournamentWithRegistrationCount.paymentMethod ||
      (Number(tournamentWithRegistrationCount.registrationFeeAmount || 0) > 0
        ? "payhere"
        : "free"),
    registrationFee: {
      amount: Number(tournamentWithRegistrationCount.registrationFeeAmount || 0),
      currency: tournamentWithRegistrationCount.registrationFeeCurrency || "LKR",
    },
    registrationFeeTiers: Array.isArray(tournamentWithRegistrationCount.registrationFeeTiers)
      ? tournamentWithRegistrationCount.registrationFeeTiers
      : [],
    registrationPaymentAvailable:
      Number(tournamentWithRegistrationCount.registrationFeeAmount || 0) === 0 ||
      tournamentWithRegistrationCount.paymentMethod === "bank_transfer" ||
      (tournamentWithRegistrationCount.paymentMethod === "payhere" && isPayHereConfigured()),
    reservationMinutes: tournamentWithRegistrationCount.reservationMinutes || 1440,
    bankTransferReviewMinutes:
      tournamentWithRegistrationCount.bankTransferReviewMinutes || 1440,
    maxTeams: tournamentWithRegistrationCount.maxTeams,
    registrationCount: tournamentWithRegistrationCount.registrationCount,
    capacityUsed: tournamentWithRegistrationCount.capacityUsed,
    prizePool: tournamentWithRegistrationCount.prizePool,
    status: tournamentWithRegistrationCount.status,
    isPublished: tournamentWithRegistrationCount.isPublished,
    bracketLink: tournamentWithRegistrationCount.bracketLink,
    challongeEmbedUrl: buildChallongeEmbedUrl(tournamentWithRegistrationCount.bracketLink),
    bracketSource: tournamentWithRegistrationCount.challongeIntegration?.enabled
      ? "challonge"
      : tournamentWithRegistrationCount.bracket?.status === "published"
        ? "native"
        : "none",
    sponsors: (tournamentWithRegistrationCount.sponsors || []).map(mapSponsor),
    contactLink: tournamentWithRegistrationCount.contactLink,
    isFeatured: tournamentWithRegistrationCount.isFeatured,
    scheduleData: tournamentWithRegistrationCount.scheduleData || null,
    isCompleted: tournamentWithRegistrationCount.status === "completed",
    showcase: {
      posterUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.completedPosterImageName),
      firstPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.firstPlaceImageName),
      secondPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.secondPlaceImageName),
      thirdPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.thirdPlaceImageName),
    },
    registrationState,
    isRegistrationOpen: registrationState === "registration_open",
    isSlotsFull: registrationState === "slots_full",
    isRegistrationClosed: registrationState === "registration_closed",
    createdAt: tournamentWithRegistrationCount.createdAt,
    updatedAt: tournamentWithRegistrationCount.updatedAt,
  };
};

const mapAdminTournament = (tournament) => ({
  ...mapTournament(tournament),
  bankName: tournament.bankName,
  bankBranch: tournament.bankBranch,
  bankAccountName: tournament.bankAccountName,
  bankAccountNumber: tournament.bankAccountNumber,
});

const mapTournamentWithRegistrations = (
  tournament,
  registrations = tournament.teamRegistrations || []
) => ({
  ...mapAdminTournament(tournament),
  bracket: tournament.bracket || null,
  registrations: registrations.map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    contactEmail: registration.contactEmail,
    logoUrl: getTeamLogoUrl(getCurrentTeamLogoName(registration)),
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    verificationStatus: registration.verificationStatus,
    createdAt: registration.createdAt,
    captain: {
      name: registration.captainName,
      email: registration.captainEmail,
      phone: registration.captainPhone,
      discord: registration.captainDiscord,
      riotId: registration.captainRiotId,
    },
  })),
});

const mapCompletedChallongeResult = (integration) => {
  if (!integration?.enabled || !integration.snapshotData) return null;

  const snapshot = integration.snapshotData;
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];
  const matches = Array.isArray(snapshot.matches) ? snapshot.matches : [];
  const links = new Map(
    (integration.participantLinks || []).map((link) => [
      String(link.externalParticipantId),
      link,
    ])
  );
  const mapStanding = (participant, rank) => {
    const link = links.get(String(participant.id));
    const registration = link?.isConfirmed ? link.registration : null;
    return {
      rank,
      name: registration?.teamName || link?.displayName || participant.name || "Participant",
      seed: Number.isInteger(participant.seed) ? participant.seed : null,
      logoUrl: registration
        ? getTeamLogoUrl(getCurrentTeamLogoName(registration))
        : null,
    };
  };

  const standings = participants
    .filter((participant) => Number.isInteger(participant.finalRank) && participant.finalRank >= 1 && participant.finalRank <= 3)
    .sort((left, right) => left.finalRank - right.finalRank)
    .map((participant) => mapStanding(participant, participant.finalRank));

  if (!standings.some((standing) => standing.rank === 1)) {
    const finalWinnerId = [...matches].reverse().find((match) => match.winnerId)?.winnerId;
    const winner = participants.find((participant) => String(participant.id) === String(finalWinnerId));
    if (winner) standings.unshift(mapStanding(winner, 1));
  }

  return {
    status: snapshot.tournament?.state || "complete",
    completedAt: snapshot.tournament?.completedAt || null,
    standings,
  };
};

const mapTournamentWithPublicTeams = (tournament) => ({
  ...mapTournament(tournament),
  ...mapPublicBracket(tournament.bracket, tournament.teamRegistrations),
  resultSummary: mapCompletedChallongeResult(tournament.challongeIntegration),
  registeredTeams: (tournament.teamRegistrations || [])
    .filter((registration) => (registration.entryType || "team") === "team")
    .map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    logoUrl: getTeamLogoUrl(getCurrentTeamLogoName(registration)),
    shortCode: buildShortCode(registration.teamName),
    memberCount: registration.members?.length || 0,
    status: registration.status,
    captainName: registration.captainName,
    })),
  registeredParticipants: (tournament.teamRegistrations || []).map((registration) => ({
    id: registration.id,
    entryType: registration.entryType || "team",
    displayName:
      (registration.entryType || "team") === "solo"
        ? registration.captainName
        : registration.teamName,
    logoUrl: getTeamLogoUrl(getCurrentTeamLogoName(registration)),
    avatarUrl:
      (registration.entryType || "team") === "solo" && registration.user?.avatarImageName
        ? `/api/uploads/avatars/${registration.user.avatarImageName}`
        : null,
    captainName: registration.captainName,
    shortCode: buildShortCode(registration.teamName),
    memberCount: registration.members?.length || 0,
  })),
});

const sortPublicTournaments = (tournaments) =>
  [...tournaments].sort((left, right) => {
    const priorityDifference = left.displayPriority - right.displayPriority;

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (left.isRegistrationOpen !== right.isRegistrationOpen) {
      return left.isRegistrationOpen ? -1 : 1;
    }

    if (left.isFeatured !== right.isFeatured) {
      return left.isFeatured ? -1 : 1;
    }

    const leftStartDate = left.startDate
      ? new Date(left.startDate).getTime()
      : Number.POSITIVE_INFINITY;
    const rightStartDate = right.startDate
      ? new Date(right.startDate).getTime()
      : Number.POSITIVE_INFINITY;
    const startDateDifference =
      leftStartDate === rightStartDate ? 0 : leftStartDate - rightStartDate;

    if (startDateDifference !== 0) {
      return startDateDifference;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

const parseTournamentPayload = ({ body, existingTournament }) => {
  const title = normalizeText(body.title);
  const titleFallback = existingTournament?.title || "";
  const slug =
    normalizeSlug(body.slug) ||
    normalizeSlug(title) ||
    normalizeSlug(titleFallback);
  const game = normalizeText(body.game).toLowerCase();
  const gameCategoryId = normalizeText(body.gameCategoryId) || null;
  const organizer = normalizeText(body.organizer ?? existingTournament?.organizer) || "Quest E-sports";
  const country = normalizeText(body.country ?? existingTournament?.country) || "Sri Lanka";
  const location = normalizeText(body.location ?? existingTournament?.location) || "TBA";
  const normalizedDisplayPriority = normalizeInteger(body.displayPriority);
  const displayPriority =
    normalizedDisplayPriority ?? existingTournament?.displayPriority ?? 100;
  const shortDescription = normalizeText(body.shortDescription);
  const fullDescription = normalizeText(body.fullDescription);
  const rules = normalizeText(body.rules);
  const rulebookId = normalizeText(body.rulebookId) || null;
  const format = normalizeText(body.format);
  const registrationMode = normalizeText(
    body.registrationMode || existingTournament?.registrationMode || "open_entry"
  ).toLowerCase();
  const entryType = normalizeText(
    body.entryType || existingTournament?.entryType || "team"
  ).toLowerCase();
  const seriesId = normalizeText(body.seriesId) || null;
  const seriesOrder =
    normalizeInteger(body.seriesOrder) ?? existingTournament?.seriesOrder ?? 100;
  const prizePool = normalizeText(body.prizePool);
  const teamSize = normalizeInteger(body.teamSize);
  const maxTeams = normalizeInteger(body.maxTeams);
  const minRosterSize =
    normalizeInteger(body.minRosterSize) ??
    existingTournament?.minRosterSize ??
    teamSize ??
    1;
  const maxRosterSize =
    normalizeInteger(body.maxRosterSize) ??
    existingTournament?.maxRosterSize ??
    teamSize ??
    1;
  const maxSubstitutes =
    normalizeInteger(body.maxSubstitutes) ??
    existingTournament?.maxSubstitutes ??
    0;
  const reservationMinutes =
    normalizeInteger(body.reservationMinutes) ??
    existingTournament?.reservationMinutes ??
    15;
  const bankTransferReviewMinutes =
    normalizeInteger(body.bankTransferReviewMinutes) ??
    existingTournament?.bankTransferReviewMinutes ??
    1440;
  const registrationFeeAmount = Number.parseFloat(
    String(
      body.registrationFeeAmount ??
        existingTournament?.registrationFeeAmount ??
        0
    )
  );
  const registrationFeeCurrency = normalizeText(
    body.registrationFeeCurrency ||
      existingTournament?.registrationFeeCurrency ||
      "LKR"
  ).toUpperCase();
  const paymentMethod = normalizeText(
    body.paymentMethod ||
      existingTournament?.paymentMethod ||
      (registrationFeeAmount > 0 ? "payhere" : "free")
  ).toLowerCase();
  const bankName = normalizeText(body.bankName ?? existingTournament?.bankName) || null;
  const bankBranch = normalizeText(body.bankBranch ?? existingTournament?.bankBranch) || null;
  const bankAccountName =
    normalizeText(body.bankAccountName ?? existingTournament?.bankAccountName) || null;
  const bankAccountNumber =
    normalizeText(body.bankAccountNumber ?? existingTournament?.bankAccountNumber) || null;
  let registrationFeeTiers;
  try {
    registrationFeeTiers = Array.isArray(body.registrationFeeTiers)
      ? body.registrationFeeTiers
      : JSON.parse(
          String(
            body.registrationFeeTiers ??
              JSON.stringify(existingTournament?.registrationFeeTiers || [])
          )
        );
  } catch {
    throw new HttpError(400, "Registration fee tiers must be valid JSON.");
  }
  let registrationFields;
  try {
    registrationFields = Array.isArray(body.registrationFields)
      ? body.registrationFields
      : JSON.parse(
          String(
            body.registrationFields ??
              JSON.stringify(existingTournament?.registrationFields || [])
          )
        );
  } catch {
    throw new HttpError(400, "Registration fields must be valid JSON.");
  }
  const status = parseTournamentStatus(body.status || existingTournament?.status);
  const startDateInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "startDate",
    statusKey: "startDateStatus",
    fieldLabel: "Start date",
  });
  const registrationOpenAt = parseOptionalDateValue(
    body.registrationOpenAt || existingTournament?.registrationOpenAt
  );
  const endDateInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "endDate",
    statusKey: "endDateStatus",
    fieldLabel: "End date",
  });
  const registrationDeadlineInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "registrationDeadline",
    statusKey: "registrationDeadlineStatus",
    fieldLabel: "Registration deadline",
  });
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const registrationDeadline = registrationDeadlineInput.value;
  const bracketLink = normalizeText(body.bracketLink)
    ? normalizeChallongeUrl(body.bracketLink)
    : null;
  const contactLink = normalizeText(body.contactLink)
    ? normalizeOptionalUrl(body.contactLink)
    : null;

  if (
    !title ||
    !slug ||
    !game ||
    !format ||
    !prizePool
  ) {
    throw new HttpError(400, "Please fill all required tournament fields.");
  }

  if (!teamSize || teamSize <= 0 || !maxTeams || maxTeams <= 0) {
    throw new HttpError(400, "Team size and max teams must be valid numbers.");
  }

  if (!REGISTRATION_MODES.has(registrationMode)) {
    throw new HttpError(400, "Select a valid registration mode.");
  }

  if (!ENTRY_TYPES.has(entryType)) {
    throw new HttpError(400, "Select a valid team or solo entry type.");
  }

  if (
    !minRosterSize ||
    !maxRosterSize ||
    minRosterSize < 1 ||
    maxRosterSize < minRosterSize ||
    maxSubstitutes < 0 ||
    reservationMinutes < 1 ||
    bankTransferReviewMinutes < 1
  ) {
    throw new HttpError(400, "Roster limits and reservation time must be valid.");
  }

  if (!Number.isFinite(registrationFeeAmount) || registrationFeeAmount < 0) {
    throw new HttpError(400, "Registration fee must be zero or a positive amount.");
  }

  if (!/^[A-Z]{3}$/.test(registrationFeeCurrency)) {
    throw new HttpError(400, "Registration fee currency must be a three-letter code.");
  }

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpError(400, "Select a valid tournament payment method.");
  }
  if (registrationFeeAmount === 0 && paymentMethod !== "free") {
    throw new HttpError(400, "Free tournaments must use the free payment method.");
  }
  if (registrationFeeAmount > 0 && paymentMethod === "free") {
    throw new HttpError(400, "Paid tournaments must use PayHere or bank transfer.");
  }
  if (paymentMethod === "bank_transfer" && registrationFeeCurrency !== "LKR") {
    throw new HttpError(400, "Manual bank-transfer tournaments currently require LKR.");
  }
  if (
    paymentMethod === "bank_transfer" &&
    (!bankName || !bankAccountName || !bankAccountNumber)
  ) {
    throw new HttpError(400, "Complete the bank name, account name, and account number.");
  }

  if (!Array.isArray(registrationFeeTiers) || registrationFeeTiers.length > 20) {
    throw new HttpError(400, "A tournament can define up to 20 registration fee tiers.");
  }
  const normalizedFeeTiers = registrationFeeTiers.map((tier, index) => {
    const startSlot = normalizeInteger(tier?.startSlot);
    const endSlot = normalizeInteger(tier?.endSlot);
    const amount = Number.parseFloat(String(tier?.amount ?? ""));
    if (
      !startSlot ||
      !endSlot ||
      endSlot < startSlot ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new HttpError(400, `Registration fee tier ${index + 1} is invalid.`);
    }
    return { startSlot, endSlot, amount };
  }).sort((left, right) => left.startSlot - right.startSlot);
  if (paymentMethod === "bank_transfer" && normalizedFeeTiers.length > 0) {
    let expectedStart = 1;
    for (const tier of normalizedFeeTiers) {
      if (tier.startSlot !== expectedStart || tier.endSlot > maxTeams) {
        throw new HttpError(
          400,
          "Bank-transfer fee tiers must cover slots consecutively without overlaps or gaps."
        );
      }
      expectedStart = tier.endSlot + 1;
    }
    if (expectedStart !== maxTeams + 1) {
      throw new HttpError(400, "Bank-transfer fee tiers must cover every tournament slot.");
    }
  }

  if (!Array.isArray(registrationFields) || registrationFields.length > 20) {
    throw new HttpError(400, "A tournament can define up to 20 registration fields.");
  }

  const normalizedRegistrationFields = registrationFields.map((field, index) => {
    const key = normalizeSlug(field?.key);
    const label = normalizeText(field?.label);
    const type = normalizeText(field?.type || "text").toLowerCase();
    const scope = normalizeText(field?.scope || "entry").toLowerCase();
    const options = Array.isArray(field?.options)
      ? field.options.map(normalizeText).filter(Boolean).slice(0, 50)
      : [];

    if (
      !key ||
      !label ||
      !REGISTRATION_FIELD_TYPES.has(type) ||
      !REGISTRATION_FIELD_SCOPES.has(scope) ||
      (type === "select" && options.length === 0)
    ) {
      throw new HttpError(400, `Registration field ${index + 1} is invalid.`);
    }

    return {
      key,
      label,
      type,
      scope,
      required: Boolean(field?.required),
      options,
    };
  });

  if (registrationDeadline && startDate && registrationDeadline > startDate) {
    throw new HttpError(
      400,
      "Registration deadline must be before or on the tournament start date."
    );
  }

  if (endDate && startDate && endDate < startDate) {
    throw new HttpError(400, "End date must be after the start date.");
  }

  if (normalizeText(body.bracketLink) && !bracketLink) {
    throw new HttpError(400, "Bracket link must be an HTTPS Challonge tournament URL.");
  }

  if (normalizeText(body.contactLink) && !contactLink) {
    throw new HttpError(400, "Discord/contact link must be a valid URL.");
  }

  return {
    title,
    slug,
    game,
    gameCategoryId,
    organizer,
    country,
    location,
    displayPriority,
    shortDescription,
    fullDescription,
    rules,
    rulebookId,
    registrationOpenAt,
    startDate,
    startDateStatus: startDateInput.status,
    endDate,
    endDateStatus: endDateInput.status,
    registrationDeadline,
    registrationDeadlineStatus: registrationDeadlineInput.status,
    format,
    registrationMode,
    entryType,
    seriesId,
    seriesOrder,
    teamSize,
    minRosterSize,
    maxRosterSize,
    maxSubstitutes,
    registrationFields: normalizedRegistrationFields,
    paymentMethod,
    registrationFeeAmount,
    registrationFeeCurrency,
    registrationFeeTiers: normalizedFeeTiers,
    reservationMinutes,
    bankTransferReviewMinutes,
    bankName,
    bankBranch,
    bankAccountName,
    bankAccountNumber,
    maxTeams,
    prizePool,
    status,
    isPublished: normalizeBooleanFlag(body.isPublished),
    isFeatured: normalizeBooleanFlag(body.isFeatured),
    bracketLink,
    contactLink,
    isActive: status === "registration_open",
  };
};

const ensureRulebookMatchesTournamentGame = async ({ rulebookId, game }) => {
  if (!rulebookId) {
    return;
  }

  const rulebook = await prisma.rulebook.findUnique({
    where: { id: rulebookId },
    select: { game: true },
  });

  if (!rulebook) {
    throw new HttpError(400, "Selected rulebook was not found.");
  }

  if (normalizeText(rulebook.game).toLowerCase() !== normalizeText(game).toLowerCase()) {
    throw new HttpError(400, "The selected rulebook must match the tournament game.");
  }
};

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

const getPublicTournamentBySlug = async (slug) => {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

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
        orderBy: [{ teamName: "asc" }],
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
            select: { id: true },
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
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  return mapTournamentWithPublicTeams(tournament);
};

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

const createAdminTournament = async ({ body, files }) => {
  const payload = parseTournamentPayload({ body });
  await ensureSlugAvailable(payload.slug);
  await ensureRulebookMatchesTournamentGame(payload);
  const assetUpdates = await buildTournamentAssetUpdates({ body, files });

  let tournament;

  try {
    tournament = await prisma.tournament.create({
      data: {
        id: crypto.randomUUID(),
        ...payload,
        ...assetUpdates.data,
      },
      include: buildRegistrationCountInclude(),
    });
  } catch (error) {
    await removeUploadsQuietly(assetUpdates.uploadedFiles, {
      operation: "createAdminTournament",
    });
    throw error;
  }

  return mapAdminTournament(tournament);
};

const updateAdminTournament = async ({ tournamentId, body, files }) => {
  const existingTournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!existingTournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const payload = parseTournamentPayload({ body, existingTournament });
  await ensureSlugAvailable(payload.slug, tournamentId);
  await ensureRulebookMatchesTournamentGame(payload);
  const assetUpdates = await buildTournamentAssetUpdates({
    body,
    files,
  });

  let tournament;

  try {
    tournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        ...payload,
        ...assetUpdates.data,
      },
      include: buildRegistrationCountInclude(),
    });
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

const deleteAdminTournament = async (tournamentId) => {
  const existingTournament = await prisma.tournament.findUnique({
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

  if (!existingTournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const deleted = await prisma.tournament.deleteMany({
    where: { id: tournamentId },
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
            { captainEmail: normalizeEmail(user.email) },
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
        select: { inviteStatus: true },
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
  const effectiveVerificationStatus = registrationMembers.some(
    (member) => member.inviteStatus === "declined"
  )
    ? "flagged"
    : registrationMembers.length > 0 && registrationMembers.every(
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
          pendingInviteCount: registrationMembers.filter(
            (member) => member.inviteStatus === "pending"
          ).length,
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
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  deleteAdminTournament,
  getTournamentRegistrationStatus,
  parseOptionalDateValue,
  mapTournament,
  buildRegistrationCountInclude,
  normalizeChallongeUrl,
  buildChallongeEmbedUrl,
};
