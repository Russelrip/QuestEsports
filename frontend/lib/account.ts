import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import type { SavedTeam } from "@/lib/teams";

export type DashboardRegistration = {
  id: string;
  entryType: "team" | "solo";
  displayName: string;
  status: "pending" | "approved" | "rejected" | "waitlisted";
  paymentStatus: "unpaid" | "pending" | "paid";
  verificationStatus: "pending" | "verified" | "flagged";
  createdAt: string;
  reservedUntil?: string | null;
  event: {
    id: string;
    slug: string;
    title: string;
  } | null;
  tournament: {
    id: string;
    slug: string;
    title: string;
    game: string;
    status: string;
    paymentMethod: "free" | "payhere" | "bank_transfer";
    startDate: string | null;
    startDateStatus: "scheduled" | "tba" | "tbd";
    endDate: string | null;
    endDateStatus: "scheduled" | "tba" | "tbd";
    bannerUrl?: string | null;
  };
  payment?: {
    id: string;
    orderId: string;
    provider: string;
    status: string;
    amount: number;
    currency: string;
  } | null;
};

type DashboardOrder = {
  id: string;
  publicToken: string;
  status: string;
  currency: string;
  total: number;
  createdAt: string;
  itemCount: number;
  paymentStatus: string;
};

type DashboardRecruitmentApplication = {
  id: string;
  applicationType: "solo_player" | "existing_team" | "incomplete_team";
  game: string;
  teamName?: string | null;
  status: "pending" | "reviewed" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type AccountDashboard = {
  currentRegistrations: DashboardRegistration[];
  pastRegistrations: DashboardRegistration[];
  teams: SavedTeam[];
  recruitmentApplications: DashboardRecruitmentApplication[];
  orders: DashboardOrder[];
};

export async function fetchAccountDashboard() {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    dashboard?: AccountDashboard;
  }>("/api/me/dashboard");
  const message = getApiErrorMessage(response, data, "Could not load your account dashboard.");
  if (message || !data.dashboard) throw new Error(message || "Could not load your account dashboard.");
  return data.dashboard;
}
