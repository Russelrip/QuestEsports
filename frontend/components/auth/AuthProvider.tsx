"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiFetch, apiFetchJson, AuthUser } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";
import { useToastStore } from "@/hooks/useToastStore";

const SESSION_CACHE_TTL_MS = 30 * 1000;
let cachedSessionUser: AuthUser | null = null;
let cachedSessionFetchedAt = 0;

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionError: string | null;
  login: (user: AuthUser) => void;
  logout: () => Promise<boolean>;
  refreshUser: (user: AuthUser) => void;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const showToast = useToastStore((state) => state.showToast);

  const setLoggedInUser = (nextUser: AuthUser | null) => {
    cachedSessionUser = nextUser;
    cachedSessionFetchedAt = Date.now();
    setUser(nextUser);
  };

  const loadSession = useCallback(async (options?: { force?: boolean }) => {
    if (
      !options?.force &&
      cachedSessionFetchedAt > 0 &&
      Date.now() - cachedSessionFetchedAt < SESSION_CACHE_TTL_MS
    ) {
      setLoggedInUser(cachedSessionUser);
      setIsLoading(false);
      return;
    }

    try {
      const { response, data } = await apiFetchJson<{ user?: AuthUser | null }>("/api/me");
      if (!response.ok || data.success === false) {
        if (response.status === 401) {
          setLoggedInUser(null);
          setSessionError(null);
          return;
        }
        throw new Error(data.message || "The session service is unavailable.");
      }
      setLoggedInUser(data?.user || null);
      setSessionError(null);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to refresh session:", error);
      }
      setSessionError(
        error instanceof Error ? error.message : "The session service is unavailable."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    await loadSession({ force: true });
  }, [loadSession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    sessionError,
    login: setLoggedInUser,
    logout: async () => {
      try {
        const response = await apiFetch("/api/logout", {
          method: "POST",
        });
        const data = await readApiResponse<{ message?: string }>(response);
        if (!response.ok || data.success === false) {
          throw new Error(data.message || "The server could not end your session.");
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to logout session:", error);
        }
        showToast({
          title: "Logout did not complete",
          description: "Your server session may still be active. Please try again.",
          tone: "error",
        });
        return false;
      }

      cachedSessionUser = null;
      cachedSessionFetchedAt = 0;
      setLoggedInUser(null);
      setSessionError(null);
      return true;
    },
    refreshUser: setLoggedInUser,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
