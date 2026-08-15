"use client";

import {
  adminRequest,
  type AdminUser,
  type ContactMessage,
  type Pagination,
  type RecruitmentApplication,
  type TeamRegistrationSummary,
  type TournamentOption,
} from "@/lib/admin";
import { useApiQuery } from "@/hooks/api/useApiQuery";
import { type Tournament } from "@/lib/tournaments";

const createAdminSearchParams = (page: number, pageSize?: number) => {
  const params = new URLSearchParams({ page: String(page) });

  if (pageSize) {
    params.set("pageSize", String(pageSize));
  }

  return params;
};

const appendIfPresent = (params: URLSearchParams, key: string, value: string) => {
  const normalizedValue = value.trim();

  if (normalizedValue) {
    params.set(key, normalizedValue);
  }
};

export type AdminTeamOption = {
  id: string;
  name: string;
  teamTag: string | null;
};

const ADMIN_TEAMS_PAGE_SIZE = 50;

// Fetch every SavedTeam via the admin directory endpoint (not the profile-scoped
// /api/teams/profile) so admins can pick from ALL saved teams, not just their own.
const fetchAllAdminTeams = async (): Promise<AdminTeamOption[]> => {
  const teams: AdminTeamOption[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await adminRequest<{ teams: AdminTeamOption[]; pagination: Pagination }>(
      `/api/admin/teams?page=${page}&pageSize=${ADMIN_TEAMS_PAGE_SIZE}`
    );
    teams.push(...result.teams);
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);
  return teams;
};

export function useAdminTeams() {
  return useApiQuery(["admin-teams", "all"], fetchAllAdminTeams);
}

export function useAdminUsers(search: string, roleFilter: string, page: number) {
  return useApiQuery(["admin-users", search, roleFilter, page], async () => {
    const params = createAdminSearchParams(page, 10);
    appendIfPresent(params, "search", search);
    appendIfPresent(params, "role", roleFilter);

    return adminRequest<{ users: AdminUser[]; pagination: Pagination }>(
      `/api/admin/users?${params.toString()}`
    );
  });
}

export function useAdminRegistrations(search: string, tournament: string, status: string, page: number) {
  return useApiQuery(["admin-registrations", search, tournament, status, page], async () => {
    const params = createAdminSearchParams(page, 10);
    appendIfPresent(params, "search", search);
    appendIfPresent(params, "tournament", tournament);
    appendIfPresent(params, "status", status);

    return adminRequest<{
      registrations: TeamRegistrationSummary[];
      tournaments: TournamentOption[];
      pagination: Pagination;
    }>(`/api/admin/team-registrations?${params.toString()}`);
  });
}

export function useAdminMessages(search: string, isRead: string, page: number) {
  return useApiQuery(["admin-messages", search, isRead, page], async () => {
    const params = createAdminSearchParams(page, 10);
    appendIfPresent(params, "search", search);
    appendIfPresent(params, "isRead", isRead);

    return adminRequest<{ messages: ContactMessage[]; pagination: Pagination }>(
      `/api/admin/contact-messages?${params.toString()}`
    );
  });
}

export function useAdminRecruitmentApplications(
  search: string,
  status: string,
  applicationType: string,
  page: number
) {
  return useApiQuery(
    ["admin-recruitment", search, status, applicationType, page],
    async () => {
      const params = createAdminSearchParams(page, 10);
      appendIfPresent(params, "search", search);
      appendIfPresent(params, "status", status);
      appendIfPresent(params, "applicationType", applicationType);

      return adminRequest<{
        applications: RecruitmentApplication[];
        pagination: Pagination;
      }>(`/api/admin/recruitment-applications?${params.toString()}`);
    }
  );
}

export function useAdminTournaments(search: string, status: string, visibility: string, page: number) {
  return useApiQuery(["admin-tournaments", search, status, visibility, page], async () => {
    const params = createAdminSearchParams(page);
    appendIfPresent(params, "search", search);
    appendIfPresent(params, "status", status);
    appendIfPresent(params, "isPublished", visibility);
    const suffix = params.toString() ? `?${params.toString()}` : "";

    return adminRequest<{ tournaments: Tournament[]; pagination: Pagination }>(
      `/api/admin/tournaments${suffix}`
    );
  });
}

export type TournamentTitleOption = {
  id: string;
  title: string;
};

const ADMIN_TOURNAMENT_OPTIONS_PAGE_SIZE = 100;

// Lightweight id+title list of every tournament for dropdowns (e.g. attaching a
// VALORANT series to a tournament). Pages through the admin tournaments endpoint
// so the full list is available, not just the first page.
const fetchAllAdminTournamentOptions = async (): Promise<TournamentTitleOption[]> => {
  const options: TournamentTitleOption[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await adminRequest<{ tournaments: TournamentTitleOption[]; pagination: Pagination }>(
      `/api/admin/tournaments?page=${page}&pageSize=${ADMIN_TOURNAMENT_OPTIONS_PAGE_SIZE}`
    );
    options.push(...result.tournaments.map(({ id, title }) => ({ id, title })));
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);
  return options;
};

export function useAdminTournamentOptions() {
  return useApiQuery(["admin-tournament-options"], fetchAllAdminTournamentOptions);
}
