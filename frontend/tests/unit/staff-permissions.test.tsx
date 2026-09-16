import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminGuard from "../../components/admin/AdminGuard";
import AdminUserStaffRoles from "../../components/admin/AdminUserStaffRoles";
import ValorantManagementPage from "../../components/admin/valorant/ValorantManagementPage";
import { adminHomeFor, canOpenAdminPath, hasStaffPermission, isSuperAdmin, staffPermissionGroups } from "../../lib/staff-permissions";

// A staff member is a normal user whose roles grant some admin areas. They must
// land in one of those areas, see only them, and be sent back from any other
// admin page. The backend enforces the same boundary; these cover what the UI
// shows.

const mocks = vi.hoisted(() => ({
  auth: { user: null as unknown, isLoading: false, sessionError: "", refreshSession: vi.fn() },
  pathname: "/admin",
  replace: vi.fn(),
  fetchRoles: vi.fn(),
  fetchUserRoles: vi.fn(),
  updateUserRoles: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) => selector({ showToast: mocks.showToast }),
}));
vi.mock("@/lib/staff-permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/staff-permissions")>("../../lib/staff-permissions");
  return { ...actual, fetchStaffRoles: mocks.fetchRoles, fetchUserStaffRoles: mocks.fetchUserRoles, updateUserStaffRoles: mocks.updateUserRoles };
});
// Render the page's tab strip without its data-loading children.
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/components/admin/valorant/ValorantLeaderboardPlayersManager", () => ({ default: () => <p>leaderboard players panel</p> }));
vi.mock("@/components/admin/valorant/ValorantSeriesManager", () => ({ default: () => <p>series panel</p> }));

const admin = { id: "admin-1", role: "admin" as const, permissions: ["valorant_leaderboard"] };
const staff = { id: "staff-1", role: "user" as const, permissions: ["valorant_leaderboard"] };
const player = { id: "player-1", role: "user" as const, permissions: [] };

const mediaStaff = { id: "media-1", role: "user" as const, permissions: ["media", "shop"] };

const role = (id: string, name: string, permissions: string[], color: string | null = "#5865f2") => ({
  id, name, description: null, color, permissions, memberCount: 1, createdAt: "", updatedAt: "",
});
const leaderboardRole = role("role-lb", "VALORANT Leaderboard", ["valorant_leaderboard"]);
const mediaRole = role("role-media", "Media Team", ["media", "games"], null);

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

  it("opens every area a role grants, including sub-pages, and nothing else", () => {
    for (const path of ["/admin/media", "/admin/event-albums", "/admin/products", "/admin/orders", "/admin/orders/o-1"]) {
      expect(canOpenAdminPath(mediaStaff, path), path).toBe(true);
    }
    for (const path of ["/admin", "/admin/users", "/admin/roles", "/admin/payments", "/admin/tournaments", "/admin/audit-log"]) {
      expect(canOpenAdminPath(mediaStaff, path), path).toBe(false);
    }
    expect(adminHomeFor(mediaStaff)).toBe("/admin/media");
  });

  it("treats super admin as an admin with the flag, and nothing else", () => {
    expect(isSuperAdmin({ role: "admin", isSuperAdmin: true })).toBe(true);
    expect(isSuperAdmin({ role: "admin", isSuperAdmin: false })).toBe(false);
    expect(isSuperAdmin({ role: "user", isSuperAdmin: true })).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("groups every area for the role editor", () => {
    const groups = staffPermissionGroups();
    expect(groups.map((group) => group.label)).toEqual(["Competition", "Content", "People", "Commerce", "Game Operations"]);
    expect(groups.flatMap((group) => group.areas).length).toBe(14);
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

describe("AdminUserStaffRoles", () => {
  it("lets a super admin add a role, saves the full list, and shows the areas it opens", async () => {
    mocks.fetchRoles.mockResolvedValue([leaderboardRole, mediaRole]);
    mocks.fetchUserRoles.mockResolvedValue([leaderboardRole]);
    mocks.updateUserRoles.mockResolvedValue([leaderboardRole, mediaRole]);
    const onSaved = vi.fn();
    render(<AdminUserStaffRoles userId="player-1" username="sahan" isAdmin={false} canManage onSaved={onSaved} />);

    expect(await screen.findByText("VALORANT Leaderboard")).toBeTruthy();
    expect(screen.getByText("VALORANT leaderboard")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Add a role" }), { target: { value: "role-media" } });

    await waitFor(() => expect(mocks.updateUserRoles).toHaveBeenCalledWith("player-1", ["role-lb", "role-media"]));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" })));
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByText("Media Team")).toBeTruthy();
    // Every role is now held, so there is nothing left to add.
    expect(screen.queryByRole("combobox", { name: "Add a role" })).toBeNull();
    expect(screen.getByText("Games, Media and posters, VALORANT leaderboard")).toBeTruthy();
  });

  it("removes a role with the chip's remove button", async () => {
    mocks.fetchRoles.mockResolvedValue([leaderboardRole, mediaRole]);
    mocks.fetchUserRoles.mockResolvedValue([leaderboardRole, mediaRole]);
    mocks.updateUserRoles.mockResolvedValue([mediaRole]);
    render(<AdminUserStaffRoles userId="player-1" username="sahan" isAdmin={false} canManage />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove VALORANT Leaderboard" }));
    await waitFor(() => expect(mocks.updateUserRoles).toHaveBeenCalledWith("player-1", ["role-media"]));
  });

  it("shows roles read-only to an admin who is not a super admin", async () => {
    mocks.fetchRoles.mockResolvedValue([leaderboardRole, mediaRole]);
    mocks.fetchUserRoles.mockResolvedValue([leaderboardRole]);
    render(<AdminUserStaffRoles userId="player-1" username="sahan" isAdmin={false} canManage={false} />);

    expect(await screen.findByText("VALORANT Leaderboard")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Add a role" })).toBeNull();
    expect(screen.getByText("Only a super admin can change roles.")).toBeTruthy();
  });

  it("explains that roles do not add anything for an admin", async () => {
    mocks.fetchRoles.mockResolvedValue([leaderboardRole]);
    mocks.fetchUserRoles.mockResolvedValue([]);
    render(<AdminUserStaffRoles userId="admin-1" username="russel" isAdmin canManage />);
    expect(await screen.findByText(/already open every area/)).toBeTruthy();
  });

  it("reports a load failure instead of showing no roles", async () => {
    mocks.fetchRoles.mockRejectedValue(new Error("Admin access is required."));
    mocks.fetchUserRoles.mockResolvedValue([]);
    render(<AdminUserStaffRoles userId="player-1" username="sahan" isAdmin={false} canManage />);
    expect((await screen.findByRole("alert")).textContent).toContain("Admin access is required.");
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
