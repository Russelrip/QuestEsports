const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  persistTournamentBannerUpload,
  tournamentBannerDirectory,
} = require("../../middleware/upload");
const { normalizeText } = require("../../lib/validation");
const { buildActiveRegistrationWhere } = require("./registration-eligibility");

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
const REGISTRATION_FIELD_TYPES = new Set(["text", "number", "select", "checkbox", "url"]);
const REGISTRATION_FIELD_SCOPES = new Set(["entry", "member"]);
const PUBLIC_PARTICIPANT_PAGE_SIZE = 50;
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
      isPublished: true,
      registrationOpenAt: true,
      registrationCloseAt: true,
      registrationStatusOverride: true,
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
  _count: { select: { members: { where: { role: { not: "COACH" } } } } },
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

const getUploadedFile = (files, key) =>
  Array.isArray(files?.[key]) ? files[key][0] : null;

module.exports = {
  TOURNAMENT_STATUSES,
  REGISTRATION_MODES,
  ENTRY_TYPES,
  PAYMENT_METHODS,
  REGISTRATION_FIELD_TYPES,
  REGISTRATION_FIELD_SCOPES,
  PUBLIC_PARTICIPANT_PAGE_SIZE,
  buildRegistrationCountInclude,
  adminRegistrationSummarySelect,
  tournamentAssetFields,
  normalizeBooleanFlag,
  parseOptionalDateValue,
  parseTournamentDateValue,
  parseTournamentStatus,
  ensureSlugAvailable,
  getUploadedFile,
};
