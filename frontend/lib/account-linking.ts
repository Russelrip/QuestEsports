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

// Linking is rarely the errand somebody set out on — it is the step in front of
// something else, most often accepting a team invitation, which cannot be done
// without a connected Discord account. `redirectTo` says where to come back to,
// and the backend accepts it only if it is a path on this site.
export function getProviderLinkUrl(
  provider: OAuthProvider,
  redirectTo?: string | null
): string {
  const url = buildApiUrl(`${providerPath(provider)}/link`);
  if (!redirectTo) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}redirect=${encodeURIComponent(redirectTo)}`;
}
