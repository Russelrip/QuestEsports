import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { API_URL, ApiError, apiRequest, jsonBody, sessionStore, setUnauthorizedHandler } from "@/api";
import type { AdminUser, ApiEnvelope } from "@/types";

export type OAuthProvider = "google" | "discord";
type AuthContextValue = {
  loading: boolean;
  sessionError: string | null;
  user: AdminUser | null;
  login: (identity: string, password: string) => Promise<void>;
  loginWithProvider: (provider: OAuthProvider) => Promise<void>;
  exchangeOAuthGrant: (grantToken: string) => Promise<void>;
  logout: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  retrySession: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const OAUTH_VERIFIER_KEY = "quest_admin_oauth_verifier";
const PKCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
WebBrowser.maybeCompleteAuthSession();

const createPkcePair = async () => {
  const bytes = await Crypto.getRandomBytesAsync(64);
  const verifier = Array.from(
    bytes,
    (value) => PKCE_ALPHABET[value % PKCE_ALPHABET.length],
  ).join("");
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return {
    verifier,
    challenge: digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const oauthExchanges = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await apiRequest<ApiEnvelope & { user: AdminUser }>("/api/mobile/auth/me");
    if (data.user?.role !== "admin") throw new ApiError("Admin access is required.", 403);
    setUser(data.user);
    setSessionError(null);
  }, []);

  const clearLocalSession = useCallback(async () => {
    await sessionStore.clear();
    setUser(null);
    setSessionError(null);
  }, []);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const token = await sessionStore.get();
      if (token) await refreshUser();
      else setSessionError(null);
    } catch (caught) {
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) {
        await clearLocalSession();
      } else {
        setSessionError(caught instanceof Error ? caught.message : "Unable to verify this admin session.");
      }
    } finally {
      setLoading(false);
    }
  }, [clearLocalSession, refreshUser]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const login = useCallback(async (identity: string, password: string) => {
    const data = await apiRequest<
      ApiEnvelope & { token: string; user: AdminUser; expiresAt: string }
    >("/api/mobile/auth/login", {
      method: "POST",
      authenticated: false,
      ...jsonBody({ emailOrUsername: identity, password }),
    });
    await sessionStore.set(data.token);
    setUser(data.user);
    setSessionError(null);
  }, []);

  const exchangeOAuthGrant = useCallback(async (grantToken: string) => {
    const normalizedGrant = grantToken.trim();
    if (!normalizedGrant) throw new Error("The social sign-in did not return a valid grant.");

    const existingExchange = oauthExchanges.current.get(normalizedGrant);
    if (existingExchange) return existingExchange;

    const exchange = (async () => {
      const codeVerifier = await SecureStore.getItemAsync(OAUTH_VERIFIER_KEY);
      if (!codeVerifier) {
        throw new Error("The secure social sign-in session has expired. Please try again.");
      }
      const data = await apiRequest<
        ApiEnvelope & { token: string; user: AdminUser; expiresAt: string }
      >("/api/mobile/auth/oauth/exchange", {
        method: "POST",
        authenticated: false,
        ...jsonBody({ grantToken: normalizedGrant, codeVerifier }),
      });
      await SecureStore.deleteItemAsync(OAUTH_VERIFIER_KEY);
      await sessionStore.set(data.token);
      setUser(data.user);
      setSessionError(null);
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
      const { verifier, challenge } = await createPkcePair();
      await SecureStore.setItemAsync(OAUTH_VERIFIER_KEY, verifier);
      const redirectUrl =
        process.env.EXPO_PUBLIC_OAUTH_REDIRECT_URL || Linking.createURL("oauth");
      const authorizationUrl = new URL(
        `${API_URL}/api/mobile/auth/oauth/${provider}/start`,
      );
      authorizationUrl.searchParams.set("code_challenge", challenge);
      const result = await WebBrowser.openAuthSessionAsync(
        authorizationUrl.toString(),
        redirectUrl
      );

      if (result.type !== "success") {
        await SecureStore.deleteItemAsync(OAUTH_VERIFIER_KEY);
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

  const logout = useCallback(async () => {
    try {
      await apiRequest<ApiEnvelope>("/api/mobile/auth/logout", { method: "POST" });
    } catch (caught) {
      if (!(caught instanceof ApiError) || ![401, 403].includes(caught.status)) {
        throw caught;
      }
    }
    await clearLocalSession();
  }, [clearLocalSession]);

  const value = useMemo(
    () => ({ loading, sessionError, user, login, loginWithProvider, exchangeOAuthGrant, logout, clearLocalSession, retrySession: restoreSession, refreshUser }),
    [loading, sessionError, user, login, loginWithProvider, exchangeOAuthGrant, logout, clearLocalSession, restoreSession, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
