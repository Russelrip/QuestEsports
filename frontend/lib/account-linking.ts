import { buildApiUrl } from "@/lib/api";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export type OAuthProvider = "google" | "discord";

export type LinkedProvider = {
  provider: OAuthProvider;
  linked: boolean;
};

const providerPath = (provider: OAuthProvider) => `/api/v1/auth/oauth/${provider}`;

const readProviders = (data: { providers?: LinkedProvider[] }) =>
  (data.providers ?? []).filter(
    (entry): entry is LinkedProvider =>
      (entry.provider === "google" || entry.provider === "discord") && typeof entry.linked === "boolean"
  );

export async function getLinkedProviders(): Promise<LinkedProvider[]> {
  const { response, data } = await apiFetchJson<{ providers?: LinkedProvider[] }>("/api/v1/auth/oauth/providers");
  const message = getApiErrorMessage(response, data, "Could not load linked accounts.");
  if (message) throw new Error(message);
  return readProviders(data);
}

export async function unlinkProvider(provider: OAuthProvider): Promise<LinkedProvider[]> {
  const { response, data } = await apiFetchJson<{ providers?: LinkedProvider[]; error?: { code?: string } }>(providerPath(provider), {
    method: "DELETE",
  });
  const message = getApiErrorMessage(response, data, "Could not unlink this account.");
  if (message) {
    const code = typeof data.error?.code === "string" ? data.error.code : undefined;
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    throw error;
  }
  return readProviders(data);
}

export function getProviderLinkUrl(provider: OAuthProvider): string {
  return buildApiUrl(`${providerPath(provider)}/link`);
}
