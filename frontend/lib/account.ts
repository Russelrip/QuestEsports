import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import type { SavedTeam } from "@/lib/teams";

export type DashboardRegistration = {
  id: string;
  entryType: "team" | "solo";
  displayName: string;
  status: "pending" | "approved" | "rejected";
  paymentStatus: "unpaid" | "pending" | "paid";
  verificationStatus: "pending" | "verified" | "flagged";
  createdAt: string;
  reservedUntil?: string | null;
  tournament: {
    id: string;
    slug: string;
    title: string;
    game: string;
    status: string;
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

export type DashboardOrder = {
  id: string;
  publicToken: string;
  status: string;
  currency: string;
  total: number;
  createdAt: string;
  itemCount: number;
  paymentStatus: string;
};

export type AccountDashboard = {
  currentRegistrations: DashboardRegistration[];
  pastRegistrations: DashboardRegistration[];
  teams: SavedTeam[];
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
