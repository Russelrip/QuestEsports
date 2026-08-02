import * as SecureStore from "expo-secure-store";
import type { ApiEnvelope } from "@/types";

const TOKEN_KEY = "quest.admin.session.v1";
let unauthorizedHandler: (() => void) | null = null;
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || "https://api.questesports.lk";
export const API_URL = configuredApiUrl.replace(/\/$/, "");
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || "https://questesports.lk").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const sessionStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (token: string) =>
    SecureStore.setItemAsync(TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

type RequestOptions = RequestInit & {
  authenticated?: boolean;
  timeoutMs?: number;
};

export async function apiRequest<T extends ApiEnvelope>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { authenticated = true, timeoutMs = 20_000, ...requestInit } = options;
  const headers = new Headers(requestInit.headers);
  const token = authenticated ? await sessionStore.get() : null;

  if (authenticated) {
    if (!token) throw new ApiError("Your admin session has ended. Sign in again.", 401);
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (requestInit.body && !(requestInit.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  headers.set("X-Quest-Admin-Client", "android");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...requestInit,
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ({ success: response.ok, message: await response.text() } as T);

    if (!response.ok || data.success === false) {
      if (authenticated && response.status === 401) {
        await sessionStore.clear();
        unauthorizedHandler?.();
      }
      throw new ApiError(data.message || `Request failed (${response.status}).`, response.status, data);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("The server took too long to respond.", 408);
    }
    throw new ApiError("Could not reach the Quest API. Check your connection.", 0, error);
  } finally {
    clearTimeout(timeout);
  }
}

export const buildQuery = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const jsonBody = (body: unknown): Pick<RequestInit, "body"> => ({
  body: JSON.stringify(body),
});
