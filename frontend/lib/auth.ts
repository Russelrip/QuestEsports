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
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

type ApiFetchOptions = RequestInit & {
  json?: unknown;
};

export const apiFetch = async (path: string, options: ApiFetchOptions = {}) => {
  const { json, headers, ...rest } = options;

  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
};
