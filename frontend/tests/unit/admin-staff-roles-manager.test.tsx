import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminStaffRolesManager from "../../components/admin/AdminStaffRolesManager";

// The roles page works like Discord's role settings: pick or create a role,
// name and colour it, switch areas on, save. Only a super admin can change
// anything; other admins get the same page read-only.

const mocks = vi.hoisted(() => ({
  viewer: null as unknown,
  showToast: vi.fn(),
  fetchRoles: vi.fn(),
  fetchRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.viewer }) }));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) => selector({ showToast: mocks.showToast }),
}));
vi.mock("@/lib/staff-permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/staff-permissions")>("../../lib/staff-permissions");
  return {
    ...actual,
    fetchStaffRoles: mocks.fetchRoles,
    fetchStaffRole: mocks.fetchRole,
    createStaffRole: mocks.createRole,
    updateStaffRole: mocks.updateRole,
    deleteStaffRole: mocks.deleteRole,
  };
});

const leaderboard = {
  id: "role-lb", name: "VALORANT Leaderboard", description: null, color: "#ed4245",
  permissions: ["valorant_leaderboard"], memberCount: 1, createdAt: "", updatedAt: "",
};

const areaSwitch = (label: RegExp) => screen.getByRole("switch", { name: label }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = { id: "owner", role: "admin", isSuperAdmin: true };
  mocks.fetchRoles.mockResolvedValue([leaderboard]);
  mocks.fetchRole.mockResolvedValue({
    ...leaderboard,
    members: [{ id: "u-1", username: "sahan", firstName: "Sahan", lastName: "P", role: "user", assignedAt: "" }],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminStaffRolesManager", () => {
  it("creates a role with a name, colour and the areas switched on", async () => {
    const created = { ...leaderboard, id: "role-media", name: "Media Team", color: "#57f287", permissions: ["media", "shop"], memberCount: 0 };
    mocks.createRole.mockResolvedValue(created);
    render(<AdminStaffRolesManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Create role" }));
    fireEvent.change(screen.getByLabelText(/Role name/), { target: { value: "Media Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Use colour #57f287" }));
    fireEvent.click(areaSwitch(/Media and posters/));
    fireEvent.click(areaSwitch(/^Shop/));
    expect(areaSwitch(/Media and posters/).checked).toBe(true);
    expect(areaSwitch(/Payments/).checked).toBe(false);

    mocks.fetchRoles.mockResolvedValue([leaderboard, created]);
    const form = screen.getByLabelText(/Role name/).closest("form") as HTMLFormElement;
    fireEvent.click(within(form).getByRole("button", { name: "Create role" }));

    await waitFor(() => expect(mocks.createRole).toHaveBeenCalledWith({
      name: "Media Team",
      description: "",
      color: "#57f287",
      permissions: ["media", "shop"],
    }));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success", title: "Role created" })));
  });

  it("edits an existing role and shows who holds it", async () => {
    mocks.updateRole.mockResolvedValue({ ...leaderboard, permissions: ["valorant_leaderboard", "game_accounts"] });
    render(<AdminStaffRolesManager />);

    fireEvent.click(await screen.findByRole("button", { name: /VALORANT Leaderboard/ }));
    expect(areaSwitch(/VALORANT leaderboard/).checked).toBe(true);
    expect(await screen.findByText("@sahan")).toBeTruthy();

    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(areaSwitch(/Account changes/));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateRole).toHaveBeenCalledWith("role-lb", expect.objectContaining({
      permissions: ["valorant_leaderboard", "game_accounts"],
    })));
  });

  it("warns how many people lose a role before deleting it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteRole.mockResolvedValue(undefined);
    render(<AdminStaffRolesManager />);

    fireEvent.click(await screen.findByRole("button", { name: /VALORANT Leaderboard/ }));
    mocks.fetchRoles.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete role" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 person will lose it"));
    await waitFor(() => expect(mocks.deleteRole).toHaveBeenCalledWith("role-lb"));
  });

  it("shows roles read-only to an admin who is not a super admin", async () => {
    mocks.viewer = { id: "admin", role: "admin", isSuperAdmin: false };
    render(<AdminStaffRolesManager />);

    expect(await screen.findByText(/only a super admin can create, edit or delete/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create role" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /VALORANT Leaderboard/ }));
    // Disabled through their fieldset, which `.disabled` on the input does not report.
    expect(areaSwitch(/VALORANT leaderboard/).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/Role name/).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete role" })).toBeNull();
  });
});
