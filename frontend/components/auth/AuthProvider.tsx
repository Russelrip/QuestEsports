"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { apiFetch, AuthUser } from "@/lib/auth";

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

  const loadSession = async () => {
    try {
      const response = await apiFetch("/api/me");
      const data = await response.json();
      setUser(data?.user || null);
    } catch (error) {
      console.error("Failed to refresh session:", error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSession = async () => {
    setIsLoading(true);
    await loadSession();
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    login: (nextUser) => {
      setUser(nextUser);
    },
    logout: async () => {
      try {
        await apiFetch("/api/logout", {
          method: "POST",
        });
      } catch (error) {
        console.error("Failed to logout session:", error);
      }

      setUser(null);
    },
    refreshUser: (nextUser) => {
      setUser(nextUser);
    },
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
