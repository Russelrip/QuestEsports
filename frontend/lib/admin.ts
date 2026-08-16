import { parseApiResponse, readApiResponse } from "@/lib/api";
import { apiFetch } from "@/lib/auth";
import { Tournament } from "@/lib/tournaments";
import {
  ADMIN_UPLOAD_MAX_FILE_SIZE,
  assertFileWithinUploadLimit,
} from "@/lib/upload-limits";
import type {
  TournamentBracketData,
  TournamentBracketSummary,
  TournamentScheduleData,
} from "@/lib/tournaments";
import {
  formatSriLankaDateTime,
  sriLankaDateTimeLocalToIso,
} from "@/lib/date-time";

export const adminNavigationGroups = [
  {
    label: "Workspace",
    links: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/media", label: "Media" },
      { href: "/admin/event-albums", label: "Albums" },
    ],
  },
  {
    label: "Competition",
    links: [
      { href: "/admin/tournaments", label: "Tournaments" },
      { href: "/admin/match-rooms", label: "Match Rooms" },
      { href: "/admin/veto-rooms", label: "Veto Rooms" },
      { href: "/admin/event-series", label: "Event Series" },
      { href: "/admin/games", label: "Games" },
      { href: "/admin/registrations", label: "Registrations" },
      { href: "/admin/rulebooks", label: "Rulebooks" },
    ],
  },
  {
    label: "People & Support",
    links: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/teams", label: "Teams" },
      { href: "/admin/recruitment", label: "Recruitment" },
      { href: "/admin/contact-messages", label: "Messages" },
    ],
  },
  {
    label: "Commerce",
    links: [
      { href: "/admin/tickets", label: "Ticketing" },
      { href: "/admin/expenses", label: "Expenses" },
      { href: "/admin/products", label: "Products" },
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/payments", label: "Payments" },
    ],
  },
  {
    label: "VALORANT",
    links: [{ href: "/admin/valorant", label: "Valorant Management" }],
  },
] as const;

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminDashboardStats = {
  totalTournaments: number;
  openTournaments: number;
  totalRegistrations: number;
  pendingRecruitmentApplications: number;
  unreadContactMessages: number;
};

export type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  role: "admin" | "user";
  phone?: string | null;
  discordTag?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TournamentOption = {
  id: string;
  slug: string;
  title: string;
  status: string;
  isPublished: boolean;
  minRosterSize?: number;
  maxRosterSize?: number;
  maxSubstitutes?: number;
  allowCoach?: boolean;
  coachRequired?: boolean;
};

export type RegistrationMember = {
  id: string;
  role: string;
  order: number;
  name: string;
  email?: string | null;
  discord?: string | null;
  riotId?: string | null;
  additionalData?: Record<string, string>;
  inviteStatus: "pending" | "accepted" | "declined";
  inviteRespondedAt?: string | null;
  account?: {
    id: string;
    username: string;
    email: string;
  } | null;
};

export type TeamRegistration = {
  id: string;
  entryType?: "team" | "solo";
  teamName: string;
  additionalData?: Record<string, string>;
  reservedUntil?: string | null;
  country?: string | null;
  teamTag?: string | null;
  organizationRequested?: boolean;
  status: "pending" | "approved" | "rejected";
  paymentStatus: "unpaid" | "pending" | "paid";
  verificationStatus: "pending" | "verified" | "flagged";
  adminSlotReservation?: {
    id: string;
    assignedSlotNumber: number;
    quotedFeeAmount: number;
    quotedFeeCurrency: string;
    note?: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
  contactEmail: string;
  logoUrl?: string | null;
  savedTeamLinked: boolean;
  tournament: TournamentOption;
  captain: {
    name: string;
    email: string;
    phone: string;
    discord: string;
    riotId: string;
  };
  coach: {
    name: string;
    email: string;
    phone: string;
    discord: string;
    riotId: string;
  } | null;
  members: RegistrationMember[];
};

export type TeamRegistrationSummary = Pick<
  TeamRegistration,
  | "id"
  | "entryType"
  | "teamName"
  | "status"
  | "paymentStatus"
  | "verificationStatus"
  | "createdAt"
  | "tournament"
> & {
  captain: Pick<TeamRegistration["captain"], "name" | "email">;
  coachName: string | null;
  coachRiotId: string | null;
  memberCount: number;
};

export type RecruitmentApplicationMember = {
  name: string;
  email: string;
  discord: string;
  playerId?: string | null;
  ign?: string | null;
  phone?: string | null;
  role?: string | null;
  nic?: string | null;
  privacyAcceptedAt?: string | null;
};

type RecruitmentApplicationDetails = {
  ign?: string;
  birthday?: string;
  gender?: string;
  peakAndCurrentRank?: string;
  tournamentExperience?: string | null;
  previouslyInOrganization?: boolean;
  previousOrganization?: string | null;
  canAttendLan?: boolean;
  teamLogoUrl?: string | null;
  additionalMembers?: string | null;
  declarationAccepted?: boolean;
};

export type RecruitmentApplication = {
  id: string;
  applicationType: "solo_player" | "existing_team" | "incomplete_team";
  fullName: string;
  email: string;
  phone: string;
  discord: string;
  game: string;
  playerId?: string | null;
  nic?: string | null;
  teamName?: string | null;
  currentRosterSize?: number | null;
  members?: RecruitmentApplicationMember[] | null;
  details?: RecruitmentApplicationDetails | null;
  notes?: string | null;
  womensLeagueInterest: boolean;
  status: "pending" | "reviewed" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type NormalizedRecruitmentApplication = Omit<
  RecruitmentApplication,
  "members" | "details"
> & {
  members: RecruitmentApplicationMember[];
  details: RecruitmentApplicationDetails;
};

export const normalizeRecruitmentApplication = (
  application: RecruitmentApplication,
): NormalizedRecruitmentApplication => ({
  ...application,
  members: Array.isArray(application.members)
    ? application.members.filter(
        (member): member is RecruitmentApplicationMember =>
          Boolean(member) && typeof member === "object",
      )
    : [],
  details:
    application.details &&
    typeof application.details === "object" &&
    !Array.isArray(application.details)
      ? application.details
      : {},
});

export type AdminTournamentBracket = {
  id: string;
  tournamentId: string;
  format: string;
  status: "draft" | "published";
  seedData: {
    id: string;
    seed: number;
    name: string;
    shortCode: string;
    logoUrl: string | null;
    memberCount: number;
  }[];
  bracketData: TournamentBracketData;
  summary: TournamentBracketSummary;
  generatedAt: string;
  publishedAt: string | null;
  lastUpdatedAt: string;
};

export type AdminChallongeIntegration = {
  id: string;
  tournamentId: string;
  identifier: string;
  enabled: boolean;
  automaticSyncEnabled: boolean;
  syncFrequency: "one_minute" | "five_minutes";
  snapshotUpdatedAt: string | null;
  nextSyncAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: { code: string; message: string } | null;
  editor: {
    tournament: {
      id: string | null;
      name: string;
      state: string;
      tournamentType: string;
    } | null;
    participants: Array<{
      id: string;
      name: string;
      seed: number | null;
      active: boolean;
      finalRank: number | null;
    }>;
    matches: Array<{
      id: string;
      identifier: string | null;
      round: number | null;
      state: string;
      player1Id: string | null;
      player2Id: string | null;
      winnerId: string | null;
      scoresCsv: string | null;
    }>;
  } | null;
  participants: Array<{
    id: string;
    externalParticipantId: string;
    displayName: string;
    seed: number | null;
    registrationId: string | null;
    isConfirmed: boolean;
  }>;
};

export type ChallongeSyncLog = {
  id: string;
  identifier: string | null;
  status: "running" | "succeeded" | "failed" | "skipped";
  trigger: string;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  tournamentState: string | null;
  participantCount: number;
  matchCount: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
};

const formatAdminDateTime = (
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
) => (value ? formatSriLankaDateTime(value, options) : "N/A");

export const formatAdminCompactDateTime = (value?: string | null) =>
  formatAdminDateTime(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const getAdminPaginationSummary = (
  pagination: Pagination,
  totalLabel = "total",
) =>
  `Page ${pagination.page} of ${pagination.totalPages} - ${pagination.total} ${totalLabel}`;

export const adminRequest = async <T>(
  path: string,
  options?: Parameters<typeof apiFetch>[1],
) => {
  const response = await apiFetch(path, options);
  return parseApiResponse<T>(response);
};

const getDownloadFilename = (
  contentDisposition: string | null,
  fallbackFilename: string,
) => {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, ""));
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallbackFilename;
};

export const downloadAdminFile = async (
  path: string,
  fallbackFilename: string,
) => {
  const response = await apiFetch(path);

  if (!response.ok) {
    const data = await readApiResponse<unknown>(response);
    throw new Error(data.message || "Download failed.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = getDownloadFilename(
    response.headers.get("content-disposition"),
    fallbackFilename,
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export type TournamentFormValues = {
  title: string;
  slug: string;
  game: string;
  gameCategoryId: string;
  organizer: string;
  country: string;
  location: string;
  displayPriority: string;
  shortDescription: string;
  fullDescription: string;
  rules: string;
  rulebookId: string;
  registrationOpenAt: string;
  startDate: string;
  startDateStatus: Tournament["startDateStatus"];
  endDate: string;
  endDateStatus: Tournament["endDateStatus"];
  registrationDeadline: string;
  registrationDeadlineStatus: Tournament["registrationDeadlineStatus"];
  format: string;
  registrationMode: Tournament["registrationMode"];
  entryType: Tournament["entryType"];
  seriesId: string;
  seriesOrder: string;
  teamSize: string;
  minRosterSize: string;
  maxRosterSize: string;
  maxSubstitutes: string;
  allowCoach: boolean;
  coachRequired: boolean;
  registrationFields: string;
  paymentMethod: Tournament["paymentMethod"];
  registrationFeeAmount: string;
  registrationFeeCurrency: string;
  registrationFeeTiers: string;
  reservationMinutes: string;
  bankTransferReviewMinutes: string;
  bankName: string;
  bankBranch: string;
  bankAccountName: string;
  bankAccountNumber: string;
  maxTeams: string;
  prizePool: string;
  status: Tournament["status"];
  isPublished: boolean;
  bracketLink: string;
  contactLink: string;
  isFeatured: boolean;
  bannerImage: File | null;
  heroImage: File | null;
  scheduleFile: File | null;
  scheduleData: TournamentScheduleData | null;
  completedPosterImage: File | null;
  firstPlaceImage: File | null;
  secondPlaceImage: File | null;
  thirdPlaceImage: File | null;
  removeBannerImage: boolean;
  removeHeroImage: boolean;
  removeScheduleFile: boolean;
  removeCompletedPosterImage: boolean;
  removeFirstPlaceImage: boolean;
  removeSecondPlaceImage: boolean;
  removeThirdPlaceImage: boolean;
};

export type UserFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  discordTag: string;
  role: "admin" | "user";
  password: string;
  confirmPassword: string;
};

export const initialUserFormValues: UserFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  phone: "",
  discordTag: "",
  role: "user",
  password: "",
  confirmPassword: "",
};

export const initialTournamentFormValues: TournamentFormValues = {
  title: "",
  slug: "",
  game: "valorant",
  gameCategoryId: "",
  organizer: "Quest E-sports",
  country: "Sri Lanka",
  location: "TBA",
  displayPriority: "100",
  shortDescription: "",
  fullDescription: "",
  rules: "",
  rulebookId: "",
  registrationOpenAt: "",
  startDate: "",
  startDateStatus: "scheduled",
  endDate: "",
  endDateStatus: "scheduled",
  registrationDeadline: "",
  registrationDeadlineStatus: "scheduled",
  format: "",
  registrationMode: "open_entry",
  entryType: "team",
  seriesId: "",
  seriesOrder: "100",
  teamSize: "5",
  minRosterSize: "5",
  maxRosterSize: "5",
  maxSubstitutes: "2",
  allowCoach: false,
  coachRequired: false,
  registrationFields: "[]",
  paymentMethod: "free",
  registrationFeeAmount: "0",
  registrationFeeCurrency: "LKR",
  registrationFeeTiers: "[]",
  reservationMinutes: "1440",
  bankTransferReviewMinutes: "1440",
  bankName: "",
  bankBranch: "",
  bankAccountName: "",
  bankAccountNumber: "",
  maxTeams: "",
  prizePool: "",
  status: "draft",
  isPublished: false,
  bracketLink: "",
  contactLink: "",
  isFeatured: false,
  bannerImage: null,
  heroImage: null,
  scheduleFile: null,
  scheduleData: null,
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
};

export const buildTournamentFormData = (values: TournamentFormValues) => {
  const uploadFields: Array<[string, File | null]> = [
    ["Banner image", values.bannerImage],
    ["Hero image", values.heroImage],
    ["Schedule file", values.scheduleFile],
    ["Completed poster", values.completedPosterImage],
    ["First-place image", values.firstPlaceImage],
    ["Second-place image", values.secondPlaceImage],
    ["Third-place image", values.thirdPlaceImage],
  ];

  uploadFields.forEach(([label, file]) =>
    assertFileWithinUploadLimit(file, ADMIN_UPLOAD_MAX_FILE_SIZE, label),
  );

  const formData = new FormData();

  const sriLankaDateFields = new Set([
    "registrationOpenAt",
    "startDate",
    "endDate",
    "registrationDeadline",
  ]);

  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === "") {
      return;
    }

    if (value instanceof File) {
      formData.append(key, value);
      return;
    }

    if (key === "scheduleData") {
      formData.append(key, JSON.stringify(value));
      return;
    }

    formData.append(
      key,
      sriLankaDateFields.has(key)
        ? sriLankaDateTimeLocalToIso(String(value))
        : String(value),
    );
  });

  return formData;
};
