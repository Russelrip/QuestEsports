const crypto = require("crypto");
const { parse: parseCsv } = require("csv-parse/sync");
const readXlsxFile = require("read-excel-file/node");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const {
  persistTeamLogoUpload,
  persistTournamentBannerUpload,
  persistTournamentScheduleUpload,
  teamLogoDirectory,
  tournamentBannerDirectory,
  tournamentScheduleDirectory,
} = require("../../middleware/upload");
const {
  syncSavedTeamFromRegistration,
  sendTeamInvites,
} = require("../teams/team.service");
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
  isValidEmail,
} = require("../../lib/validation");
const {
  buildShortCode,
  mapPublicBracket,
} = require("./bracket.service");
const { buildActiveRegistrationWhere } = require("./registration-eligibility");
const { isPayHereConfigured } = require("../payments/payment.service");

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
const REGISTRATION_TRANSACTION_MAX_RETRIES = 3;
const REGISTRATION_TRANSACTION_MAX_WAIT_MS = 10 * 1000;
const REGISTRATION_TRANSACTION_TIMEOUT_MS = 20 * 1000;
const RETRYABLE_REGISTRATION_TRANSACTION_ERROR_CODES = new Set(["P2028", "P2034"]);

const requiredPlayerIndexes = [2, 3, 4, 5];
const buildRegistrationCountInclude = (now = new Date()) => ({
  _count: {
    select: {
      teamRegistrations: {
        where: buildActiveRegistrationWhere({ now }),
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
  status: true,
  paymentStatus: true,
  verificationStatus: true,
  createdAt: true,
};
const buildRegistrationAvailabilitySelect = () => ({
  id: true,
  registrationFeeAmount: true,
  maxTeams: true,
  status: true,
  registrationOpenAt: true,
  registrationDeadline: true,
  ...buildRegistrationCountInclude(),
});
const tournamentAssetFields = [
  {
    field: "bannerImageName",
    uploadKey: "bannerImage",
    removeFlag: "removeBannerImage",
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
const DUPLICATE_REGISTRATION_MESSAGE =
  "This team or captain email is already registered for the selected tournament.";
const CLOSED_REGISTRATION_MESSAGE =
  "Registration is closed for the selected tournament.";
const FULL_REGISTRATION_MESSAGE =
  "Registration is full for the selected tournament.";

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

const getShowcaseImageUrl = (imageName) =>
  imageName ? `/api/uploads/tournament-banners/${imageName}` : null;

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

const withRegistrationCount = (tournament) => ({
  ...tournament,
  registrationCount:
    tournament.registrationCount || tournament._count?.teamRegistrations || 0,
});

const getRegistrationState = (tournament) => {
  const now = new Date();
  const registrationCount = tournament.registrationCount || 0;

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
    series: tournamentWithRegistrationCount.series || null,
    seriesOrder: tournamentWithRegistrationCount.seriesOrder,
    displayPriority: tournamentWithRegistrationCount.displayPriority,
    bannerUrl: getTournamentBannerUrl(tournamentWithRegistrationCount.bannerImageName),
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
    reservationMinutes: tournamentWithRegistrationCount.reservationMinutes || 15,
    bankTransferReviewMinutes:
      tournamentWithRegistrationCount.bankTransferReviewMinutes || 1440,
    maxTeams: tournamentWithRegistrationCount.maxTeams,
    registrationCount: tournamentWithRegistrationCount.registrationCount,
    prizePool: tournamentWithRegistrationCount.prizePool,
    status: tournamentWithRegistrationCount.status,
    isPublished: tournamentWithRegistrationCount.isPublished,
    bracketLink: tournamentWithRegistrationCount.bracketLink,
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

const mapTournamentWithRegistrations = (tournament) => ({
  ...mapTournament(tournament),
  bankName: tournament.bankName,
  bankBranch: tournament.bankBranch,
  bankAccountName: tournament.bankAccountName,
  bankAccountNumber: tournament.bankAccountNumber,
  bracket: tournament.bracket || null,
  registrations: (tournament.teamRegistrations || []).map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    contactEmail: registration.contactEmail,
    logoUrl: getTeamLogoUrl(registration.teamLogoName),
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

const mapTournamentWithPublicTeams = (tournament) => ({
  ...mapTournament(tournament),
  ...mapPublicBracket(tournament.bracket),
  registeredTeams: (tournament.teamRegistrations || [])
    .filter((registration) => (registration.entryType || "team") === "team")
    .map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    logoUrl: getTeamLogoUrl(registration.teamLogoName),
    shortCode: buildShortCode(registration.teamName),
    memberCount: registration.members?.length || 0,
    status: registration.status,
    })),
  registeredParticipants: (tournament.teamRegistrations || []).map((registration) => ({
    id: registration.id,
    entryType: registration.entryType || "team",
    displayName:
      (registration.entryType || "team") === "solo"
        ? registration.captainName
        : registration.teamName,
    logoUrl: getTeamLogoUrl(registration.teamLogoName),
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

const getTournamentLookup = (body) => {
  const tournamentId = normalizeText(body.tournamentId);
  const tournamentSlug =
    normalizeText(body.tournamentSlug) || normalizeText(body.tournament);

  if (!tournamentId && !tournamentSlug) {
    throw new HttpError(400, "Tournament ID or slug is required.");
  }

  return { tournamentId, tournamentSlug };
};

const buildRequiredPlayers = (body) =>
  requiredPlayerIndexes.map((index) => ({
    order: index - 1,
    name: normalizeText(body[`player${index}Name`]),
    email: normalizeEmail(body[`player${index}Email`]),
    discord: normalizeText(body[`player${index}Discord`]),
    riotId: normalizeText(body[`player${index}RiotId`]),
  }));

const buildOptionalMembers = (body) => {
  const substitutes = [1, 2]
    .map((index) => ({
      role: "SUBSTITUTE",
      order: index,
      name: normalizeText(body[`sub${index}Name`]),
      email: normalizeEmail(body[`sub${index}Email`]),
      discord: normalizeText(body[`sub${index}Discord`]) || null,
      riotId: normalizeText(body[`sub${index}RiotId`]) || null,
    }))
    .filter((member) => member.name);

  const coachName = normalizeText(body.coachName);
  const coach = coachName
    ? [
        {
          role: "COACH",
          order: 1,
          name: coachName,
          email: normalizeEmail(body.coachEmail),
          discord: normalizeText(body.coachDiscord) || null,
          riotId: normalizeText(body.coachRiotId) || null,
        },
      ]
    : [];

  return [...substitutes, ...coach];
};

const ensureRegistrationOpen = (registrationState) => {
  if (registrationState === "registration_open") {
    return;
  }

  if (registrationState === "slots_full") {
    throw new HttpError(400, FULL_REGISTRATION_MESSAGE);
  }

  throw new HttpError(400, CLOSED_REGISTRATION_MESSAGE);
};

const buildTournamentRegistrationMembers = ({
  captainName,
  captainEmail,
  captainDiscord,
  captainRiotId,
  requiredPlayers,
  optionalMembers,
}) => [
  {
    role: "CAPTAIN",
    order: 1,
    name: captainName,
    email: captainEmail,
    discord: captainDiscord,
    riotId: captainRiotId,
  },
  ...requiredPlayers.map((player) => ({
    role: "PLAYER",
    ...player,
  })),
  ...optionalMembers,
];

const hasDuplicateMemberEmails = (members) => {
  const seenEmails = new Set();

  for (const member of members) {
    const email = normalizeEmail(member.email);

    if (!email) {
      continue;
    }

    if (seenEmails.has(email)) {
      return true;
    }

    seenEmails.add(email);
  }

  return false;
};

const isRetryableRegistrationTransactionError = (error) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  RETRYABLE_REGISTRATION_TRANSACTION_ERROR_CODES.has(error.code);

const parseTournamentPayload = ({ body, existingTournament }) => {
  const title = normalizeText(body.title);
  const titleFallback = existingTournament?.title || "";
  const slug =
    normalizeSlug(body.slug) ||
    normalizeSlug(title) ||
    normalizeSlug(titleFallback);
  const game = normalizeText(body.game).toLowerCase();
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
    ? normalizeOptionalUrl(body.bracketLink)
    : null;
  const contactLink = normalizeText(body.contactLink)
    ? normalizeOptionalUrl(body.contactLink)
    : null;

  if (
    !title ||
    !slug ||
    !game ||
    !shortDescription ||
    !fullDescription ||
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
    throw new HttpError(400, "Bracket link must be a valid URL.");
  }

  if (normalizeText(body.contactLink) && !contactLink) {
    throw new HttpError(400, "Discord/contact link must be a valid URL.");
  }

  return {
    title,
    slug,
    game,
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
      ...(normalizedGame && normalizedGame !== "all" ? { game: normalizedGame } : {}),
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
          status: true,
          members: {
            select: { id: true },
          },
        },
      },
      bracket: true,
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
    ...(TOURNAMENT_STATUSES.has(normalizedStatus) ? { status: normalizedStatus } : {}),
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
      teamRegistrations: {
        orderBy: { createdAt: "desc" },
        select: adminRegistrationSummarySelect,
      },
      bracket: true,
      ...buildRegistrationCountInclude(),
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  return mapTournamentWithRegistrations(tournament);
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
    const persistedSchedule = await persistTournamentScheduleUpload(scheduleFile);

    if (persistedSchedule) {
      const scheduleData = await buildScheduleData(scheduleFile);
      data.scheduleFileName = persistedSchedule.filename;
      data.scheduleData = scheduleData;
      uploadedFiles.push({
        directory: tournamentScheduleDirectory,
        filename: persistedSchedule.filename,
      });
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

  return mapTournament(tournament);
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

  return mapTournament(tournament);
};

const deleteAdminTournament = async (tournamentId) => {
  const existingTournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
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
        completedPosterImageName: null,
        firstPlaceImageName: null,
        secondPlaceImageName: null,
        thirdPlaceImageName: null,
        scheduleFileName: null,
      },
    }),
    {
      operation: "deleteAdminTournament",
      tournamentId,
    }
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
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const existingRegistration = await prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      ...buildActiveRegistrationWhere(),
      AND: [
        {
          OR: [
            { userId: user.id },
            { captainEmail: normalizeEmail(user.email) },
          ],
        },
      ],
    },
    select: { id: true, paymentStatus: true, reservedUntil: true },
  });

  return {
    isRegistered: Boolean(existingRegistration),
  };
};

const createTournamentRegistration = async ({ body, file, user }) => {
  const { tournamentId, tournamentSlug } = getTournamentLookup(body);
  const teamName = normalizeText(body.teamName);
  const country = normalizeText(body.country) || "Sri Lanka";
  const teamTag = normalizeText(body.teamTag) || buildShortCode(teamName);
  const organizationRequested = normalizeBooleanFlag(body.organizationRequested);
  const captainName = normalizeText(body.captainName);
  const captainEmail = normalizeEmail(user?.email);
  const captainPhone = normalizeText(body.captainPhone);
  const captainDiscord = normalizeText(body.captainDiscord);
  const captainRiotId = normalizeText(body.captainRiotId);
  const contactEmail = normalizeEmail(body.contactEmail);
  const rulebookAccepted = normalizeBooleanFlag(body.rulebook);
  const falsityWarningAccepted = normalizeBooleanFlag(body.falsityWarning);
  const requiredPlayers = buildRequiredPlayers(body);
  const optionalMembers = buildOptionalMembers(body);

  if (
    !captainEmail ||
    !teamName ||
    !country ||
    !teamTag ||
    teamTag.length > 12 ||
    !captainName ||
    !captainPhone ||
    !captainDiscord ||
    !captainRiotId ||
    !isValidEmail(captainEmail) ||
    !isValidEmail(contactEmail) ||
    !rulebookAccepted ||
    !falsityWarningAccepted ||
    requiredPlayers.some((player) => !player.name || !player.discord || !player.riotId)
  ) {
    throw new HttpError(
      400,
      "Please fill all required fields and accept the agreements."
    );
  }

  const tournament = await prisma.tournament.findUnique({
    where: tournamentId ? { id: tournamentId } : { slug: normalizeSlug(tournamentSlug) },
    include: buildRegistrationCountInclude(),
  });

  if (!tournament) {
    throw new HttpError(404, "Selected tournament was not found.");
  }

  const mappedTournament = mapTournament(tournament);
  ensureRegistrationOpen(mappedTournament.registrationState);

  const members = buildTournamentRegistrationMembers({
    captainName,
    captainEmail,
    captainDiscord,
    captainRiotId,
    requiredPlayers,
    optionalMembers,
  });

  if (
    requiredPlayers.some(
      (player) => !player.name || !player.email || !player.discord || !player.riotId
    ) ||
    optionalMembers.some(
      (member) =>
        !member.name ||
        !member.email ||
        (member.role !== "COACH" && !member.discord) ||
        (member.role !== "COACH" && !member.riotId)
    ) ||
    members.some((member) => !isValidEmail(member.email)) ||
    hasDuplicateMemberEmails(members)
  ) {
    throw new HttpError(
      400,
      "Each roster member needs a unique valid email address before you can register."
    );
  }

  const persistedLogo = await persistTeamLogoUpload(file);
  const registrationId = crypto.randomUUID();
  let inviteDispatches = [];

  try {
    for (let attempt = 1; attempt <= REGISTRATION_TRANSACTION_MAX_RETRIES; attempt += 1) {
      try {
        inviteDispatches = [];
        await prisma.$transaction(
          async (tx) => {
            const [currentTournament, existingRegistration] = await Promise.all([
              tx.tournament.findUnique({
                where: { id: tournament.id },
                select: buildRegistrationAvailabilitySelect(),
              }),
              tx.teamRegistration.findFirst({
                where: {
                  tournamentId: tournament.id,
                  OR: [{ teamName }, { captainEmail }],
                },
                select: { id: true },
              }),
            ]);

            if (!currentTournament) {
              throw new HttpError(404, "Selected tournament was not found.");
            }

            ensureRegistrationOpen(getRegistrationState(withRegistrationCount(currentTournament)));

            if (existingRegistration) {
              throw new HttpError(400, DUPLICATE_REGISTRATION_MESSAGE);
            }

            await tx.teamRegistration.create({
              data: {
                id: registrationId,
                tournamentId: tournament.id,
                userId: user.id,
                entryType: tournament.entryType || "team",
                teamName,
                country,
                teamTag,
                organizationRequested,
                captainName,
                captainEmail,
                captainPhone,
                captainDiscord,
                captainRiotId,
                contactEmail,
                teamLogoName: persistedLogo ? persistedLogo.filename : null,
                rulebookAccepted,
                falsityWarningAccepted,
                paymentStatus:
                  Number(tournament.registrationFeeAmount || 0) > 0
                    ? "pending"
                    : "paid",
              },
            });

            await tx.registrationMember.createMany({
              data: members.map((member) => ({
                id: crypto.randomUUID(),
                registrationId,
                role: member.role,
                memberOrder: member.order,
                name: member.name,
                email: member.email,
                emailNormalized: normalizeEmail(member.email),
                discord: member.discord,
                riotId: member.riotId,
              })),
            });

            inviteDispatches = await syncSavedTeamFromRegistration({
              tx,
              registrationId,
              user,
              teamName,
              country,
              teamTag,
              organizationRequested,
              logoName: persistedLogo ? persistedLogo.filename : null,
              members,
              tournamentTitle: tournament.title,
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: REGISTRATION_TRANSACTION_MAX_WAIT_MS,
            timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS,
          }
        );
        break;
      } catch (error) {
        if (
          isRetryableRegistrationTransactionError(error) &&
          attempt < REGISTRATION_TRANSACTION_MAX_RETRIES
        ) {
          continue;
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002") {
            throw new HttpError(400, DUPLICATE_REGISTRATION_MESSAGE);
          }

          if (error.code === "P2034") {
            throw new HttpError(
              409,
              "Registration changed while your request was being processed. Please try again."
            );
          }

          if (error.code === "P2028") {
            throw new HttpError(
              503,
              "Registration could not be saved because the database was busy. Please try again."
            );
          }
        }

        throw error;
      }
    }
  } catch (error) {
    await removeUploadsQuietly(
      persistedLogo
        ? [
            {
              directory: teamLogoDirectory,
              filename: persistedLogo.filename,
            },
          ]
        : [],
      {
        operation: "createTournamentRegistration",
        tournamentId: tournament.id,
      }
    );
    throw error;
  }

  await sendTeamInvites(inviteDispatches);
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
  createTournamentRegistration,
  parseOptionalDateValue,
  mapTournament,
  buildRegistrationCountInclude,
};
