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

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: (user: AuthUser) => void;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setLoggedInUser = (nextUser: AuthUser | null) => {
    setUser(nextUser);
  };

  const loadSession = useCallback(async () => {
    try {
      const { data } = await apiFetchJson<{ user?: AuthUser | null }>("/api/me");
      setLoggedInUser(data?.user || null);
    } catch (error) {
      console.error("Failed to refresh session:", error);
      setLoggedInUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    await loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    login: setLoggedInUser,
    logout: async () => {
      try {
        await apiFetch("/api/logout", {
          method: "POST",
        });
      } catch (error) {
        console.error("Failed to logout session:", error);
      }

      setLoggedInUser(null);
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
