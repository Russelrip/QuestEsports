import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_URL, apiRequest, jsonBody, sessionStore, setUnauthorizedHandler } from "@/api";
import type { AdminUser, ApiEnvelope } from "@/types";

type LoginResult = { requiresMfa: true } | { requiresMfa: false };
export type OAuthProvider = "google" | "discord";
type AuthContextValue = {
  loading: boolean;
  user: AdminUser | null;
  challengeToken: string | null;
  login: (identity: string, password: string) => Promise<LoginResult>;
  loginWithProvider: (provider: OAuthProvider) => Promise<void>;
  exchangeOAuthGrant: (grantToken: string) => Promise<void>;
  verifyMfa: (code: string, useBackupCode?: boolean) => Promise<void>;
  cancelMfa: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
WebBrowser.maybeCompleteAuthSession();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const oauthExchanges = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setChallengeToken(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await apiRequest<ApiEnvelope & { user: AdminUser }>("/api/mobile/auth/me");
    if (data.user?.role !== "admin") throw new Error("Admin access is required.");
    setUser(data.user);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const token = await sessionStore.get();
        if (token) await refreshUser();
      } catch {
        await sessionStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshUser]);

  const login = useCallback(async (identity: string, password: string): Promise<LoginResult> => {
    const data = await apiRequest<
      ApiEnvelope & { requiresMfa?: boolean; challengeToken?: string }
    >("/api/mobile/auth/login", {
      method: "POST",
      authenticated: false,
      ...jsonBody({ emailOrUsername: identity, password }),
    });
    if (!data.requiresMfa || !data.challengeToken) {
      throw new Error("The server did not start MFA verification.");
    }
    setChallengeToken(data.challengeToken);
    return { requiresMfa: true };
  }, []);

  const exchangeOAuthGrant = useCallback(async (grantToken: string) => {
    const normalizedGrant = grantToken.trim();
    if (!normalizedGrant) throw new Error("The social sign-in did not return a valid grant.");

    const existingExchange = oauthExchanges.current.get(normalizedGrant);
    if (existingExchange) return existingExchange;

    const exchange = (async () => {
      const data = await apiRequest<
        ApiEnvelope & { token: string; user: AdminUser; expiresAt: string }
      >("/api/mobile/auth/oauth/exchange", {
        method: "POST",
        authenticated: false,
        ...jsonBody({ grantToken: normalizedGrant }),
      });
      await sessionStore.set(data.token);
      setUser(data.user);
      setChallengeToken(null);
    })();

    oauthExchanges.current.set(normalizedGrant, exchange);
    try {
      await exchange;
    } catch (error) {
      oauthExchanges.current.delete(normalizedGrant);
      throw error;
    }
  }, []);

  const loginWithProvider = useCallback(
    async (provider: OAuthProvider) => {
      const redirectUrl = Linking.createURL("oauth");
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/api/mobile/auth/oauth/${provider}/start`,
        redirectUrl
      );

      if (result.type !== "success") {
        throw new Error(`${provider === "google" ? "Google" : "Discord"} sign-in was cancelled.`);
      }

      const { queryParams } = Linking.parse(result.url);
      const grant = queryParams?.grant;
      const grantToken = Array.isArray(grant) ? grant[0] : grant;
      if (typeof grantToken !== "string") {
        throw new Error("The social sign-in did not return a valid grant.");
      }

      await exchangeOAuthGrant(grantToken);
    },
    [exchangeOAuthGrant]
  );

  const verifyMfa = useCallback(
    async (code: string, useBackupCode = false) => {
      if (!challengeToken) throw new Error("Your verification challenge has expired.");
      const data = await apiRequest<
        ApiEnvelope & { token: string; user: AdminUser; expiresAt: string }
      >("/api/mobile/auth/login/mfa", {
        method: "POST",
        authenticated: false,
        ...jsonBody({
          challengeToken,
          ...(useBackupCode ? { backupCode: code } : { code }),
        }),
      });
      await sessionStore.set(data.token);
      setUser(data.user);
      setChallengeToken(null);
    },
    [challengeToken]
  );

  const cancelMfa = useCallback(() => setChallengeToken(null), []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<ApiEnvelope>("/api/mobile/auth/logout", { method: "POST" });
    } finally {
      await sessionStore.clear();
      setUser(null);
      setChallengeToken(null);
    }
  }, []);

  const value = useMemo(
    () => ({ loading, user, challengeToken, login, loginWithProvider, exchangeOAuthGrant, verifyMfa, cancelMfa, logout, refreshUser }),
    [loading, user, challengeToken, login, loginWithProvider, exchangeOAuthGrant, verifyMfa, cancelMfa, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
