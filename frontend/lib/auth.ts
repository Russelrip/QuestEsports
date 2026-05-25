"use client";

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

const getApiUrl = (path: string) => `${process.env.NEXT_PUBLIC_API_URL}${path}`;

export const apiFetch = async (path: string, options: ApiFetchOptions = {}) => {
  const { json, headers, ...rest } = options;

  return fetch(getApiUrl(path), {
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
  const contentType = response.headers.get("content-type") || "";
  let data: T;

  if (contentType.includes("application/json")) {
    data = (await response.json()) as T;
  } else {
    const text = await response.text();
    data = {
      success: false,
      message: text || `Request failed with status ${response.status}.`,
    } as T;
  }

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
