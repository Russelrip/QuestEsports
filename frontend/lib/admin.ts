import { apiFetch } from "@/lib/auth";
import { Tournament } from "@/lib/tournaments";

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

type ApiSuccess<T> = T & { success: true; message?: string };

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
  const data = (await response.json()) as Partial<ApiSuccess<T>> & {
    success?: boolean;
    message?: string;
  };

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Request failed.");
  }

  return data as ApiSuccess<T>;
};

export type TournamentFormValues = {
  title: string;
  slug: string;
  game: string;
  shortDescription: string;
  fullDescription: string;
  rules: string;
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
  removeBannerImage: boolean;
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
  shortDescription: "",
  fullDescription: "",
  rules: "",
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
  removeBannerImage: false,
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
