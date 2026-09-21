import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileView from "../../components/auth/ProfileView";

const mocks = vi.hoisted(() => ({
  apiFetchJson: vi.fn(), apiFetch: vi.fn(),
  fetchAccountDashboard: vi.fn(),
  getMyGameAccounts: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
  auth: { user: { id: "user-1", firstName: "Player", lastName: "One", username: "player", email: "player@example.com", emailVerified: true, role: "user" as const, discordId: null as string | null, discordTag: null as string | null }, refreshUser: vi.fn(), refreshSession: vi.fn(), logout: vi.fn(), isLoading: false },
}));
vi.mock("@/lib/account-linking", () => ({ getLinkedProviders: vi.fn().mockResolvedValue([]), unlinkProvider: vi.fn(), getProviderLinkUrl: vi.fn() }));
vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson, apiFetch: mocks.apiFetch, getApiErrorMessage: () => "" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/api/useTeams", () => ({ useTeams: () => ({ data: [], setData: vi.fn(), loading: false, error: "" }) }));
vi.mock("@/lib/account", () => ({ fetchAccountDashboard: mocks.fetchAccountDashboard }));
vi.mock("@/lib/veto", () => ({ vetoRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/match-rooms", () => ({ roomRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/game-accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-accounts")>()),
  getMyGameAccounts: mocks.getMyGameAccounts,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => { void alt; return <span {...props} />; } }));
vi.mock("@/components/auth/ChangePasswordForm", () => ({ default: () => null }));
vi.mock("@/components/auth/SessionList", () => ({ default: () => null }));
vi.mock("@/components/auth/ResendVerificationButton", () => ({ default: () => null }));
vi.mock("@/components/auth/TeamManagementPanel", () => ({ default: () => null, TeamSummaryGrid: () => null }));
vi.mock("@/components/auth/AccountLinkingPanel", () => ({ default: () => null }));
// The real panel makes its own requests; only its anchor matters here.
vi.mock("@/components/auth/GameAccountsPanel", () => ({
  GAME_ACCOUNTS_ANCHOR: "valorant-account",
  default: () => <section id="valorant-account">Game accounts</section>,
}));

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchAccountDashboard.mockResolvedValue({ currentRegistrations: [], pastRegistrations: [], teams: [], recruitmentApplications: [], orders: [] });
  mocks.getMyGameAccounts.mockResolvedValue({ accounts: [], changeRequest: null });
  // jsdom implements neither.
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the VALORANT header button", () => {
  it("scrolls to the game accounts panel every time it is pressed, not only the first", async () => {
    window.history.pushState({}, "", "/profile?tab=account");
    const user = userEvent.setup();
    render(<ProfileView />);

    const button = await screen.findByRole("button", { name: "Connect VALORANT" });
    await user.click(button);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    // The reader scrolls away, which ends the settling window, then asks again.
    window.dispatchEvent(new Event("wheel"));
    scrollIntoView.mockClear();
    await user.click(button);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("still lands the deep link from another page", async () => {
    window.history.pushState({}, "", "/profile?tab=account#valorant-account");
    render(<ProfileView />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" }));
  });
});
