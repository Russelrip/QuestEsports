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
} from "@/lib/tournaments";

export const adminNavigationLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tournaments", label: "Tournaments" },
  { href: "/admin/event-series", label: "Event Series" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/recruitment", label: "Recruitment" },
  { href: "/admin/rulebooks", label: "Rulebooks" },
  { href: "/admin/contact-messages", label: "Contact Messages" },
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

export type LegacyPosterImportSummary = {
  importedCount: number;
  skippedCount: number;
  results: {
    status: "imported" | "skipped";
    title: string;
  }[];
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
  createdAt: string;
  contactEmail: string;
  logoUrl?: string | null;
  tournament: TournamentOption;
  captain: {
    name: string;
    email: string;
    phone: string;
    discord: string;
    riotId: string;
  };
  members: RegistrationMember[];
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
};

export type RecruitmentApplicationDetails = {
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
  application: RecruitmentApplication
): NormalizedRecruitmentApplication => ({
  ...application,
  members: Array.isArray(application.members)
    ? application.members.filter(
        (member): member is RecruitmentApplicationMember =>
          Boolean(member) && typeof member === "object"
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

export const emptyPagination: Pagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
};

export const formatAdminDateTime = (
  value?: string | null,
  options?: Intl.DateTimeFormatOptions
) =>
  value
    ? new Date(value).toLocaleString(undefined, options)
    : "N/A";

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
  totalLabel = "total"
) => `Page ${pagination.page} of ${pagination.totalPages} - ${pagination.total} ${totalLabel}`;

export type PagedAdminResponse<TItemKey extends string, TItem> = {
  pagination: Pagination;
} & Record<TItemKey, TItem[]>;

export const adminRequest = async <T>(
  path: string,
  options?: Parameters<typeof apiFetch>[1]
) => {
  const response = await apiFetch(path, options);
  return parseApiResponse<T>(response);
};

const getDownloadFilename = (
  contentDisposition: string | null,
  fallbackFilename: string
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
  fallbackFilename: string
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
    fallbackFilename
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
  registrationFields: string;
  registrationFeeAmount: string;
  registrationFeeCurrency: string;
  reservationMinutes: string;
  maxTeams: string;
  prizePool: string;
  status: Tournament["status"];
  isPublished: boolean;
  bracketLink: string;
  contactLink: string;
  isFeatured: boolean;
  bannerImage: File | null;
  scheduleFile: File | null;
  completedPosterImage: File | null;
  firstPlaceImage: File | null;
  secondPlaceImage: File | null;
  thirdPlaceImage: File | null;
  removeBannerImage: boolean;
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
  registrationFields: "[]",
  registrationFeeAmount: "0",
  registrationFeeCurrency: "LKR",
  reservationMinutes: "15",
  maxTeams: "",
  prizePool: "",
  status: "draft",
  isPublished: false,
  bracketLink: "",
  contactLink: "",
  isFeatured: false,
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
};

export const buildTournamentFormData = (values: TournamentFormValues) => {
  const uploadFields: Array<[string, File | null]> = [
    ["Banner image", values.bannerImage],
    ["Schedule file", values.scheduleFile],
    ["Completed poster", values.completedPosterImage],
    ["First-place image", values.firstPlaceImage],
    ["Second-place image", values.secondPlaceImage],
    ["Third-place image", values.thirdPlaceImage],
  ];

  uploadFields.forEach(([label, file]) =>
    assertFileWithinUploadLimit(file, ADMIN_UPLOAD_MAX_FILE_SIZE, label)
  );

  const formData = new FormData();

  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === "") {
      return;
    }

    if (value instanceof File) {
      formData.append(key, value);
      return;
    }

    formData.append(key, String(value));
  });

  return formData;
};
