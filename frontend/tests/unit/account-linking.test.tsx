import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountLinkingPanel from "../../components/auth/AccountLinkingPanel";

const mocks = vi.hoisted(() => ({ getLinkedProviders: vi.fn(), unlinkProvider: vi.fn(), getProviderLinkUrl: vi.fn() }));
vi.mock("@/lib/account-linking", () => mocks);

const linked = (google = false, discord = false) => [
  { provider: "google" as const, linked: google },
  { provider: "discord" as const, linked: discord },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLinkedProviders.mockResolvedValue(linked(true, false));
  mocks.getProviderLinkUrl.mockImplementation((provider: string) => `/api/v1/auth/oauth/${provider}/link`);
});
afterEach(() => cleanup());

describe("AccountLinkingPanel", () => {
  it("renders clear linked and unlinked states for both providers", async () => {
    render(<AccountLinkingPanel />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link Discord" })).toBeInTheDocument();
  });

  it("navigates to the provider link endpoint without submitting provider data", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const locationGetter = vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
    render(<AccountLinkingPanel />);
    await user.click(await screen.findByRole("button", { name: "Link Discord" }));
    expect(assign).toHaveBeenCalledWith("/api/v1/auth/oauth/discord/link");
    expect(assign.mock.calls[0][0]).not.toContain("providerId");
    expect(assign.mock.calls[0][0]).not.toContain("code");
    locationGetter.mockRestore();
  });

  it("shows a pending unlink state and refreshes after success", async () => {
    const user = userEvent.setup();
    let resolve!: (value: ReturnType<typeof linked>) => void;
    mocks.unlinkProvider.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AccountLinkingPanel />);
    await user.click(await screen.findByRole("button", { name: "Unlink Google" }));
    expect(screen.getByRole("button", { name: "Unlinking…" })).toBeDisabled();
    resolve(linked(false, false));
    await waitFor(() => expect(screen.getByRole("button", { name: "Link Google" })).toBeInTheDocument());
    expect(mocks.getLinkedProviders).toHaveBeenCalledTimes(1);
  });

  it("explains provider conflicts and last-login-method protection", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("That OAuth account is already linked to another user."), { code: "OAUTH_ACCOUNT_CONFLICT" });
    mocks.unlinkProvider.mockRejectedValueOnce(conflict).mockRejectedValueOnce(Object.assign(new Error("Keep a verified password or another linked provider."), { code: "OAUTH_LAST_LOGIN_METHOD" }));
    render(<AccountLinkingPanel />);
    await user.click(await screen.findByRole("button", { name: "Unlink Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already linked to another Quest account");
    await user.click(screen.getByRole("button", { name: "Unlink Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep a verified password or another linked provider");
  });

  it("refreshes and reports the OAuth callback result", async () => {
    window.history.pushState({}, "", "/profile?tab=account&oauth=linked");
    render(<AccountLinkingPanel />);
    expect(await screen.findByRole("status")).toHaveTextContent("Account linked successfully");
    await waitFor(() => expect(mocks.getLinkedProviders).toHaveBeenCalled());
    expect(window.location.search).toBe("?tab=account");
  });
});
