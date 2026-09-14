import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminGuard from "../../components/admin/AdminGuard";
import AdminUserStaffAccess from "../../components/admin/AdminUserStaffAccess";
import ValorantManagementPage from "../../components/admin/valorant/ValorantManagementPage";
import { adminHomeFor, canOpenAdminPath, hasStaffPermission } from "../../lib/staff-permissions";

// A leaderboard staff member is a normal user with one granted area. They must
// land in that area, see only it, and be sent back to it from any other admin
// page. The backend enforces the same boundary; these cover what the UI shows.

const mocks = vi.hoisted(() => ({
  auth: { user: null as unknown, isLoading: false, sessionError: "", refreshSession: vi.fn() },
  pathname: "/admin",
  replace: vi.fn(),
  fetchPermissions: vi.fn(),
  updatePermissions: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) => selector({ showToast: mocks.showToast }),
}));
vi.mock("@/lib/staff-permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/staff-permissions")>("../../lib/staff-permissions");
  return { ...actual, fetchUserStaffPermissions: mocks.fetchPermissions, updateUserStaffPermissions: mocks.updatePermissions };
});
// Render the page's tab strip without its data-loading children.
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/components/admin/valorant/ValorantLeaderboardPlayersManager", () => ({ default: () => <p>leaderboard players panel</p> }));
vi.mock("@/components/admin/valorant/ValorantSeriesManager", () => ({ default: () => <p>series panel</p> }));

const admin = { id: "admin-1", role: "admin" as const, permissions: ["valorant_leaderboard"] };
const staff = { id: "staff-1", role: "user" as const, permissions: ["valorant_leaderboard"] };
const player = { id: "player-1", role: "user" as const, permissions: [] };

const catalog = [{ key: "valorant_leaderboard", label: "VALORANT leaderboard", description: "Search and remove players." }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = null;
  mocks.auth.isLoading = false;
  mocks.pathname = "/admin";
});
afterEach(() => cleanup());

describe("staff permission helpers", () => {
  it("opens every admin path for an admin", () => {
    expect(canOpenAdminPath(admin, "/admin")).toBe(true);
    expect(canOpenAdminPath(admin, "/admin/users")).toBe(true);
    expect(adminHomeFor(admin)).toBe("/admin");
  });

  it("opens only the granted area for staff", () => {
    expect(hasStaffPermission(staff, "valorant_leaderboard")).toBe(true);
    expect(canOpenAdminPath(staff, "/admin/valorant")).toBe(true);
    for (const path of ["/admin", "/admin/users", "/admin/valorant-anything", "/admin/game-accounts"]) {
      expect(canOpenAdminPath(staff, path), path).toBe(false);
    }
    expect(adminHomeFor(staff)).toBe("/admin/valorant");
  });

  it("opens nothing for a player", () => {
    expect(hasStaffPermission(player, "valorant_leaderboard")).toBe(false);
    expect(canOpenAdminPath(player, "/admin/valorant")).toBe(false);
    expect(adminHomeFor(player)).toBeNull();
    expect(adminHomeFor(null)).toBeNull();
  });
});

describe("AdminGuard", () => {
  it("renders a granted area for staff", () => {
    mocks.auth.user = staff;
    mocks.pathname = "/admin/valorant";
    render(<AdminGuard><p>valorant area</p></AdminGuard>);
    expect(screen.getByText("valorant area")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("sends staff from an admin-only page to their own area", async () => {
    mocks.auth.user = staff;
    mocks.pathname = "/admin/users";
    render(<AdminGuard><p>users page</p></AdminGuard>);
    expect(screen.queryByText("users page")).toBeNull();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/admin/valorant"));
  });

  it("sends a player without any area home", async () => {
    mocks.auth.user = player;
    mocks.pathname = "/admin/valorant";
    render(<AdminGuard><p>valorant area</p></AdminGuard>);
    expect(screen.queryByText("valorant area")).toBeNull();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
});

describe("ValorantManagementPage tabs", () => {
  it("shows staff only the leaderboard tab and opens it", () => {
    mocks.auth.user = staff;
    render(<ValorantManagementPage />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Leaderboard Players"]);
    expect(screen.getByText("leaderboard players panel")).toBeTruthy();
    expect(screen.queryByText("series panel")).toBeNull();
  });

  it("keeps every tab for an admin", () => {
    mocks.auth.user = admin;
    render(<ValorantManagementPage />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Team Bindings", "Series", "Rankings", "Leaderboard Players", "Reconciliation",
    ]);
    expect(screen.getByText("series panel")).toBeTruthy();
  });
});

describe("AdminUserStaffAccess", () => {
  it("grants the leaderboard area and saves exactly the ticked areas", async () => {
    mocks.fetchPermissions.mockResolvedValue({ catalog, permissions: [] });
    mocks.updatePermissions.mockResolvedValue({ catalog, permissions: ["valorant_leaderboard"] });
    render(<AdminUserStaffAccess userId="player-1" username="sahan" isAdmin={false} />);

    const checkbox = (await screen.findByRole("checkbox", { name: /VALORANT leaderboard/ })) as HTMLInputElement;
    const save = screen.getByRole("button", { name: "Save staff access" }) as HTMLButtonElement;
    expect(checkbox.checked).toBe(false);
    expect(save.disabled).toBe(true);

    fireEvent.click(checkbox);
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updatePermissions).toHaveBeenCalledWith("player-1", ["valorant_leaderboard"]));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" })));
    expect((screen.getByRole("button", { name: "Save staff access" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not offer areas to an admin, who already has them all", () => {
    mocks.fetchPermissions.mockResolvedValue({ catalog, permissions: [] });
    render(<AdminUserStaffAccess userId="admin-1" username="russel" isAdmin />);
    expect(screen.getByText(/already open every area/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("reports a load failure instead of showing empty access", async () => {
    mocks.fetchPermissions.mockRejectedValue(new Error("Admin access is required."));
    render(<AdminUserStaffAccess userId="player-1" username="sahan" isAdmin={false} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Admin access is required.");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
