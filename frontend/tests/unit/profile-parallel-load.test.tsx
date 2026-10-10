import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileView from "../../components/auth/ProfileView";

const mocks = vi.hoisted(() => ({
  apiFetchJson: vi.fn(), apiFetch: vi.fn(),
  fetchAccountDashboard: vi.fn(),
  getMyGameAccounts: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
  teamsEnabled: [] as boolean[],
  auth: { user: null as null | Record<string, unknown>, refreshUser: vi.fn(), refreshSession: vi.fn(), logout: vi.fn(), isLoading: true },
  signedInUser: { id: "user-1", firstName: "Player", lastName: "One", username: "player", email: "player@example.com", emailVerified: true, role: "user" as const, discordId: null as string | null, discordTag: null as string | null },
}));
vi.mock("@/lib/account-linking", () => ({ getLinkedProviders: vi.fn().mockResolvedValue([]), unlinkProvider: vi.fn(), getProviderLinkUrl: vi.fn() }));
vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson, apiFetch: mocks.apiFetch, getApiErrorMessage: () => "" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/api/useTeams", () => ({ useTeams: (enabled: boolean) => { mocks.teamsEnabled.push(enabled); return { data: [], setData: vi.fn(), loading: false, error: "" }; } }));
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
vi.mock("@/components/auth/GameAccountsPanel", () => ({
  GAME_ACCOUNTS_ANCHOR: "valorant-account",
  default: () => <section id="valorant-account">Game accounts</section>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamsEnabled.length = 0;
  mocks.auth.user = null;
  mocks.auth.isLoading = true;
  mocks.fetchAccountDashboard.mockResolvedValue({ currentRegistrations: [], pastRegistrations: [], teams: [], recruitmentApplications: [], orders: [] });
  mocks.getMyGameAccounts.mockResolvedValue({ accounts: [], changeRequest: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.history.pushState({}, "", "/profile");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("profile loading", () => {
  it("requests the dashboard while the session check is still in flight, and only once", async () => {
    const view = render(<ProfileView />);

    expect(screen.getByText("Loading profile")).toBeTruthy();
    expect(mocks.fetchAccountDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getMyGameAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.teamsEnabled[0]).toBe(true);

    mocks.auth.user = mocks.signedInUser;
    mocks.auth.isLoading = false;
    view.rerender(<ProfileView />);
    await screen.findByText("Player One");

    // A profile save hands back a new user object; that is not a reason to reload.
    mocks.auth.user = { ...mocks.signedInUser, firstName: "Renamed" };
    view.rerender(<ProfileView />);

    expect(mocks.fetchAccountDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getMyGameAccounts).toHaveBeenCalledTimes(1);
  });

  it("requests nothing for a visitor already known to be signed out", () => {
    mocks.auth.isLoading = false;
    render(<ProfileView />);

    expect(mocks.fetchAccountDashboard).not.toHaveBeenCalled();
    expect(mocks.teamsEnabled.every((enabled) => !enabled)).toBe(true);
    expect(mocks.router.replace).toHaveBeenCalledWith("/login");
  });
});
