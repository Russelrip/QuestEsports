import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountLinkingPanel from "../../components/auth/AccountLinkingPanel";
import ProfileView from "../../components/auth/ProfileView";

const mocks = vi.hoisted(() => ({
  getLinkedProviders: vi.fn(), unlinkProvider: vi.fn(), getProviderLinkUrl: vi.fn(),
  apiFetchJson: vi.fn(), apiFetch: vi.fn(),
  fetchAccountDashboard: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
  auth: { user: { id: "user-1", firstName: "Player", lastName: "One", username: "player", email: "player@example.com", emailVerified: true, role: "user" as const, discordId: null as string | null, discordTag: null as string | null }, refreshUser: vi.fn(), refreshSession: vi.fn(), logout: vi.fn(), isLoading: false },
}));
vi.mock("@/lib/account-linking", () => mocks);
vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson, apiFetch: mocks.apiFetch, getApiErrorMessage: (response: Response, data: { success?: boolean; message?: string }, fallback: string) => response.ok && data.success !== false ? "" : data.message || fallback }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/api/useTeams", () => ({ useTeams: () => ({ data: [], setData: vi.fn(), loading: false, error: "" }) }));
vi.mock("@/lib/account", () => ({ fetchAccountDashboard: mocks.fetchAccountDashboard }));
vi.mock("@/lib/veto", () => ({ vetoRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/match-rooms", () => ({ roomRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => { void alt; return <span {...props} />; } }));
vi.mock("@/components/auth/ChangePasswordForm", () => ({ default: () => null }));
vi.mock("@/components/auth/SessionList", () => ({ default: () => null }));
vi.mock("@/components/auth/ResendVerificationButton", () => ({ default: () => null }));
vi.mock("@/components/auth/TeamManagementPanel", () => ({ default: () => null, TeamSummaryGrid: () => null }));

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
    window.history.pushState({ preserved: true }, "", "/profile?tab=account&oauth=linked&keep=1#account");
    render(<AccountLinkingPanel />);
    expect(await screen.findByRole("status")).toHaveTextContent("Account linked successfully");
    await waitFor(() => expect(mocks.getLinkedProviders).toHaveBeenCalled());
    await waitFor(() => expect(mocks.auth.refreshSession).toHaveBeenCalled());
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#account");
    expect(window.history.state).toEqual({ preserved: true });
  });

  it("keeps controls unavailable after a failed initial load and enables retry", async () => {
    const user = userEvent.setup();
    mocks.getLinkedProviders.mockRejectedValueOnce(new Error("Provider status unavailable")).mockResolvedValueOnce(linked(false, true));
    render(<AccountLinkingPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider status unavailable");
    expect(screen.queryByRole("button", { name: /Link|Unlink|Unavailable/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Link Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink Discord" })).toBeInTheDocument();
  });
});

describe("ProfileView OAuth callback integration", () => {
  beforeEach(() => {
    mocks.getLinkedProviders.mockResolvedValue(linked(true, false));
    mocks.fetchAccountDashboard.mockResolvedValue({ currentRegistrations: [], pastRegistrations: [], teams: [], recruitmentApplications: [], orders: [] });
  });

  it.each(["linked", "error"] as const)("mounts the account panel for oauth=%s", async (result) => {
    window.history.pushState({}, "", `/profile?tab=account&oauth=${result}`);
    render(<ProfileView />);
    expect(await screen.findByRole(result === "linked" ? "status" : "alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Linked accounts" })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("ProfileView private Discord projection", () => {
  beforeEach(() => {
    mocks.getLinkedProviders.mockResolvedValue(linked(true, true));
    mocks.fetchAccountDashboard.mockResolvedValue({ currentRegistrations: [], pastRegistrations: [], teams: [], recruitmentApplications: [], orders: [] });
    window.history.pushState({}, "", "/profile?tab=account");
  });

  it("renders the linked Discord username and ID as private read-only text", async () => {
    mocks.auth.user = { ...mocks.auth.user, discordId: "1134567890123456789", discordTag: "player#1234" };
    render(<ProfileView />);

    expect(await screen.findByText("player#1234")).toBeInTheDocument();
    expect(screen.getByText("1134567890123456789")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /discord/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/discord id/i)).not.toBeInTheDocument();
  });

  it("treats a Discord tag without the canonical ID as unlinked", async () => {
    mocks.auth.user = { ...mocks.auth.user, discordId: null, discordTag: "tag-only" };
    render(<ProfileView />);

    expect(await screen.findByText("Connect Discord under Linked accounts to display your private connected-account details.")).toBeInTheDocument();
    expect(screen.queryByText("tag-only")).not.toBeInTheDocument();
    expect(screen.queryByText("Discord ID")).not.toBeInTheDocument();
  });
});

describe("provider descriptions match the connection state", () => {
  it("stops telling a connected user to connect", async () => {
    mocks.getLinkedProviders.mockResolvedValue(linked(false, true));
    render(<AccountLinkingPanel />);

    // A card badged CONNECTED that still says "Connect Discord so staff can
    // reach you" reads as an unfinished instruction, and leaves the user
    // hunting for a step they already completed.
    expect(
      await screen.findByText("Your captain and tournament staff can reach you on Discord."),
    ).toBeTruthy();
    expect(screen.queryByText(/^Connect Discord so your captain/)).toBeNull();
  });

  it("still explains why an unconnected user should bother", async () => {
    mocks.getLinkedProviders.mockResolvedValue(linked(false, false));
    render(<AccountLinkingPanel />);

    expect(await screen.findByText(/Connect Discord so your captain/)).toBeTruthy();
    expect(
      screen.queryByText("Your captain and tournament staff can reach you on Discord."),
    ).toBeNull();
  });

  it("applies the same rule to Google", async () => {
    mocks.getLinkedProviders.mockResolvedValue(linked(true, false));
    render(<AccountLinkingPanel />);

    expect(await screen.findByText("You can sign in with Google.")).toBeTruthy();
    expect(screen.queryByText("Use your Google identity to sign in faster.")).toBeNull();
  });
});

// A Discord connection is only useful if the profile can show the tag it
// carries. Links made before the tag was recorded leave the field blank, and
// unlinking to fix that is refused when Discord is the only login method — so
// the card has to offer a way to run the link again.
describe("a linked Discord account can be reconnected", () => {
  it("offers Reconnect beside Unlink for Discord", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const locationGetter = vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
    mocks.getLinkedProviders.mockResolvedValue(linked(true, true));
    render(<AccountLinkingPanel />);

    await user.click(await screen.findByRole("button", { name: "Reconnect Discord" }));
    expect(assign).toHaveBeenCalledWith("/api/v1/auth/oauth/discord/link");
    expect(screen.getByRole("button", { name: "Unlink Discord" })).toBeInTheDocument();
    locationGetter.mockRestore();
  });

  it("does not offer it for Google, which fills in nothing", async () => {
    mocks.getLinkedProviders.mockResolvedValue(linked(true, true));
    render(<AccountLinkingPanel />);

    expect(await screen.findByRole("button", { name: "Unlink Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect Google" })).toBeNull();
  });

  it("reloads the session after unlinking so the cleared tag disappears", async () => {
    const user = userEvent.setup();
    mocks.getLinkedProviders.mockResolvedValue(linked(false, true));
    mocks.unlinkProvider.mockResolvedValue(linked(false, false));
    render(<AccountLinkingPanel />);

    await user.click(await screen.findByRole("button", { name: "Unlink Discord" }));
    // The server clears the tag with the link; a stale session would keep
    // showing the old handle as if it were still verified.
    await waitFor(() => expect(mocks.auth.refreshSession).toHaveBeenCalled());
  });
});
