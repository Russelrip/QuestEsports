import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchJson = vi.hoisted(() => vi.fn());
const buildApiUrl = vi.hoisted(() => (path: string) => path);
vi.mock("@/lib/api", () => ({ buildApiUrl }));
vi.mock("@/lib/auth", () => ({
  apiFetchJson,
  getApiErrorMessage: (response: Response, data: { success?: boolean; message?: string }, fallback: string) => response.ok && data.success !== false ? "" : data.message || fallback,
}));

import { getProviderLinkUrl, unlinkProvider } from "../../lib/account-linking";

const providers = [{ provider: "google" as const, linked: false }, { provider: "discord" as const, linked: true }];

describe("account-linking client contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses canonical link and DELETE endpoints", async () => {
    expect(getProviderLinkUrl("google")).toBe("/api/v1/auth/oauth/google/link");
    apiFetchJson.mockResolvedValueOnce({ response: new Response(null, { status: 200 }), data: { success: true, providers } });
    await expect(unlinkProvider("google")).resolves.toEqual(providers);
    expect(apiFetchJson).toHaveBeenCalledWith("/api/v1/auth/oauth/google", { method: "DELETE" });
  });

  it("preserves backend error code and message from the versioned envelope", async () => {
    apiFetchJson.mockResolvedValueOnce({
      response: new Response(null, { status: 400 }),
      data: { success: false, message: "Keep a verified password or another linked OAuth provider.", error: { code: "OAUTH_LAST_LOGIN_METHOD" } },
    });
    await expect(unlinkProvider("google")).rejects.toMatchObject({ code: "OAUTH_LAST_LOGIN_METHOD", message: "Keep a verified password or another linked OAuth provider." });
  });
});
