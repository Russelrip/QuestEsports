import { type TournamentFormValues } from "@/lib/admin";
import { type Tournament } from "@/lib/tournaments";

export const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toLocalDateTimeValue = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

const toOptionalLocalDateTimeValue = (value?: string | null) =>
  value ? toLocalDateTimeValue(value) : "";

export const mapTournamentToFormValues = (
  tournament: Tournament
): TournamentFormValues => ({
  title: tournament.title,
  slug: tournament.slug,
  game: tournament.game,
  displayPriority: String(tournament.displayPriority ?? 100),
  shortDescription: tournament.shortDescription,
  fullDescription: tournament.fullDescription,
  rules: tournament.rules || "",
  rulebookId: tournament.rulebook?.id || "",
  registrationOpenAt: toOptionalLocalDateTimeValue(
    tournament.registrationOpenAt
  ),
  startDate: toLocalDateTimeValue(tournament.startDate),
  endDate: toLocalDateTimeValue(tournament.endDate),
  registrationDeadline: toLocalDateTimeValue(tournament.registrationDeadline),
  format: tournament.format,
  registrationMode: tournament.registrationMode || "open_entry",
  entryType: tournament.entryType || "team",
  seriesId: tournament.series?.id || "",
  seriesOrder: String(tournament.seriesOrder ?? 100),
  teamSize: String(tournament.teamSize),
  minRosterSize: String(tournament.minRosterSize || tournament.teamSize),
  maxRosterSize: String(tournament.maxRosterSize || tournament.teamSize),
  maxSubstitutes: String(tournament.maxSubstitutes || 0),
  registrationFields: JSON.stringify(tournament.registrationFields || [], null, 2),
  registrationFeeAmount: String(tournament.registrationFee?.amount || 0),
  registrationFeeCurrency: tournament.registrationFee?.currency || "LKR",
  reservationMinutes: String(tournament.reservationMinutes || 15),
  maxTeams: String(tournament.maxTeams),
  prizePool: tournament.prizePool,
  status: tournament.status,
  isPublished: tournament.isPublished,
  bracketLink: tournament.bracketLink || "",
  contactLink: tournament.contactLink || "",
  isFeatured: tournament.isFeatured,
  bannerImage: null,
  scheduleFile: null,
  completedPosterImage: null,
  firstPlaceImage: null,
  secondPlaceImage: null,
  thirdPlaceImage: null,
  removeBannerImage: false,
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
