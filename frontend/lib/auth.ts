"use client";

import { buildApiUrl, readApiResponse } from "@/lib/api";

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone?: string | null;
  discordTag?: string | null;
  role: "admin" | "user";
  pendingEmail?: string | null;
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  mfaEnabled?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

export type PendingMfaUser = Pick<
  AuthUser,
  "id" | "email" | "username" | "firstName" | "lastName" | "role" | "mfaEnabled"
>;

export type UserSession = {
  id: string;
  createdAt: string;
  lastSeenAt?: string | null;
  expiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  rememberMe: boolean;
  isCurrent: boolean;
};

type ApiFetchOptions = RequestInit & {
  json?: unknown;
};

type ApiSuccessResponse = {
  success?: boolean;
  message?: string;
};

export const apiFetch = async (path: string, options: ApiFetchOptions = {}) => {
  const { json, headers, ...rest } = options;

  return fetch(buildApiUrl(path), {
    ...rest,
    credentials: "include",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
};

export async function apiFetchJson<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
) {
  const response = await apiFetch(path, options);
  const data = await readApiResponse<T>(response);

  return { response, data };
}

export const getApiErrorMessage = (
  response: Response,
  data: ApiSuccessResponse,
  fallbackMessage: string
) => {
  if (response.ok && data.success !== false) {
    return "";
  }

  return data.message || fallbackMessage;
};
