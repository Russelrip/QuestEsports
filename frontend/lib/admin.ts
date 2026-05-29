import { parseApiResponse } from "@/lib/api";
import { apiFetch } from "@/lib/auth";
import { Tournament } from "@/lib/tournaments";
import type {
  TournamentBracketData,
  TournamentBracketSummary,
} from "@/lib/tournaments";

export const adminNavigationLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tournaments", label: "Tournaments" },
  { href: "/admin/registrations", label: "Registrations" },
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
  discord?: string | null;
  riotId?: string | null;
};

export type TeamRegistration = {
  id: string;
  teamName: string;
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

export type TournamentFormValues = {
  title: string;
  slug: string;
  game: string;
  displayPriority: string;
  shortDescription: string;
  fullDescription: string;
  rules: string;
  registrationOpenAt: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  format: string;
  teamSize: string;
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
  registrationOpenAt: "",
  startDate: "",
  endDate: "",
  registrationDeadline: "",
  format: "",
  teamSize: "5",
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
