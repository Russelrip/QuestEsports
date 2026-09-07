import { type TournamentFormValues } from "@/lib/admin";
import { type Tournament } from "@/lib/tournaments";
import { isoToSriLankaDateTimeLocal } from "@/lib/date-time";

export const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toLocalDateTimeValue = (value: string) => {
  return isoToSriLankaDateTimeLocal(value);
};

const toOptionalLocalDateTimeValue = (value?: string | null) =>
  value ? toLocalDateTimeValue(value) : "";

export const mapTournamentToFormValues = (
  tournament: Tournament
): TournamentFormValues => ({
  title: tournament.title,
  slug: tournament.slug,
  game: tournament.game,
  gameCategoryId: tournament.gameCategory?.id || "",
  organizer: tournament.organizer || "Quest E-sports",
  country: tournament.country || "Sri Lanka",
  location: tournament.location || "TBA",
  displayPriority: String(tournament.displayPriority ?? 100),
  shortDescription: tournament.shortDescription,
  fullDescription: tournament.fullDescription,
  rules: tournament.rules || "",
  rulebookId: tournament.rulebook?.id || "",
  registrationOpenAt: toOptionalLocalDateTimeValue(
    tournament.registrationOpenAt
  ),
  startDate: toOptionalLocalDateTimeValue(tournament.startDate),
  startDateStatus: tournament.startDateStatus || "scheduled",
  endDate: toOptionalLocalDateTimeValue(tournament.endDate),
  endDateStatus: tournament.endDateStatus || "scheduled",
  registrationDeadline: toOptionalLocalDateTimeValue(tournament.registrationDeadline),
  registrationDeadlineStatus: tournament.registrationDeadlineStatus || "scheduled",
  format: tournament.format,
  registrationMode: tournament.registrationMode || "open_entry",
  entryType: tournament.entryType || "team",
  seriesId: tournament.series?.id || "",
  seriesOrder: String(tournament.seriesOrder ?? 100),
  teamSize: String(tournament.teamSize),
  minRosterSize: String(tournament.minRosterSize || tournament.teamSize),
  maxRosterSize: String(tournament.maxRosterSize || tournament.teamSize),
  maxSubstitutes: String(tournament.maxSubstitutes || 0),
  allowCoach: Boolean(tournament.allowCoach),
  coachRequired: Boolean(tournament.allowCoach && tournament.coachRequired),
  discordRequired: Boolean(tournament.discordRequired),
  waitlistEnabled: Boolean(tournament.waitlistEnabled),
  registrationFields: JSON.stringify(tournament.registrationFields || [], null, 2),
  paymentMethod: tournament.paymentMethod ||
    (tournament.registrationFee?.amount > 0 ? "payhere" : "free"),
  registrationFeeAmount: String(tournament.registrationFee?.amount || 0),
  registrationFeeCurrency: tournament.registrationFee?.currency || "LKR",
  registrationFeeTiers: JSON.stringify(tournament.registrationFeeTiers || [], null, 2),
  reservationMinutes: String(tournament.reservationMinutes || 1440),
  bankTransferReviewMinutes: String(tournament.bankTransferReviewMinutes || 1440),
  bankName: tournament.bankName || "",
  bankBranch: tournament.bankBranch || "",
  bankAccountName: tournament.bankAccountName || "",
  bankAccountNumber: tournament.bankAccountNumber || "",
  maxTeams: String(tournament.maxTeams),
  prizePool: tournament.prizePool,
  status: tournament.status,
  isPublished: tournament.isPublished,
  showBracketPublicly: tournament.showBracketPublicly ?? true,
  bracketLink: tournament.bracketLink || "",
  contactLink: tournament.contactLink || "",
  isFeatured: tournament.isFeatured,
  bannerImage: null,
  heroImage: null,
  scheduleFile: null,
  scheduleData: tournament.scheduleData || null,
  completedPosterImage: null,
  firstPlaceImage: null,
  secondPlaceImage: null,
  thirdPlaceImage: null,
  removeBannerImage: false,
  removeHeroImage: false,
  removeScheduleFile: false,
  removeCompletedPosterImage: false,
  removeFirstPlaceImage: false,
  removeSecondPlaceImage: false,
  removeThirdPlaceImage: false,
});

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
