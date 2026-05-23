"use client";

import {
  adminRequest,
  type AdminUser,
  type ContactMessage,
  type Pagination,
  type TeamRegistration,
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
      registrations: TeamRegistration[];
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
