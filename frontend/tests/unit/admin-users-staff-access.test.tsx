import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersManager from "../../components/admin/AdminUsersManager";

// Who can open which admin areas should be visible from the users list, and
// only a super admin should be offered the controls that change admin access.

const mocks = vi.hoisted(() => ({
  useAdminUsers: vi.fn(),
  refetch: vi.fn(),
  viewer: null as unknown,
  fetchRoles: vi.fn(),
  fetchUserRoles: vi.fn(),
  updateUserRoles: vi.fn(),
}));

vi.mock("@/hooks/api/useAdmin", () => ({ useAdminUsers: mocks.useAdminUsers }));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: () => void }) => unknown) => selector({ showToast: vi.fn() }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.viewer }) }));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/staff-permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/staff-permissions")>("../../lib/staff-permissions");
  return { ...actual, fetchStaffRoles: mocks.fetchRoles, fetchUserStaffRoles: mocks.fetchUserRoles, updateUserStaffRoles: mocks.updateUserRoles };
});

const base = { firstName: "A", lastName: "B", phone: null, discordTag: null, createdAt: null, lastLoginAt: null };
const media = { id: "role-media", name: "Media Team", color: "#5865f2" };
const users = [
  { ...base, id: "u-staff", username: "sahan", email: "sahan@example.test", role: "user", staffRoles: [media] },
  { ...base, id: "u-player", username: "player", email: "player@example.test", role: "user", staffRoles: [] },
  { ...base, id: "u-admin", username: "nimal", email: "nimal@example.test", role: "admin", isSuperAdmin: false, staffRoles: [] },
  { ...base, id: "u-owner", username: "russel", email: "russel@example.test", role: "admin", isSuperAdmin: true, staffRoles: [] },
];

const owner = { id: "u-owner", role: "admin", isSuperAdmin: true };
const plainAdmin = { id: "u-admin", role: "admin", isSuperAdmin: false };

const rowFor = (username: string) => screen.getByText(`@${username}`).closest("div.grid") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = owner;
  mocks.useAdminUsers.mockReturnValue({
    data: { users, pagination: { page: 1, pageSize: 10, total: users.length, totalPages: 1 } },
    error: "",
    loading: false,
    refetch: mocks.refetch,
  });
});
afterEach(() => cleanup());

describe("users list staff roles", () => {
  it("shows each user's roles, all areas for admins, super admin on the owner, and nothing for players", () => {
    render(<AdminUsersManager />);

    expect(within(rowFor("sahan")).getByText("Media Team")).toBeTruthy();
    expect(within(rowFor("nimal")).getByText("All areas")).toBeTruthy();
    expect(within(rowFor("russel")).getByText("super admin")).toBeTruthy();
    expect(within(rowFor("player")).queryByText(/Staff roles/)).toBeNull();
  });

  it("offers a staff filter and passes it to the users query", () => {
    render(<AdminUsersManager />);

    const filter = screen.getAllByRole("combobox").find((select) =>
      [...(select as HTMLSelectElement).options].some((option) => option.value === "staff")
    ) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "staff" } });

    expect(mocks.useAdminUsers).toHaveBeenLastCalledWith("", "staff", 1);
  });

  it("lets a super admin give a role from the user's page and refreshes the list", async () => {
    mocks.fetchRoles.mockResolvedValue([{ ...media, description: null, permissions: ["media"], memberCount: 1, createdAt: "", updatedAt: "" }]);
    mocks.fetchUserRoles.mockResolvedValue([]);
    mocks.updateUserRoles.mockResolvedValue([{ ...media, description: null, permissions: ["media"], memberCount: 2, createdAt: "", updatedAt: "" }]);
    render(<AdminUsersManager />);

    fireEvent.click(within(rowFor("player")).getByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Add a role" }), { target: { value: "role-media" } });

    await waitFor(() => expect(mocks.updateUserRoles).toHaveBeenCalledWith("u-player", ["role-media"]));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });
});

describe("admin access controls", () => {
  it("never offers to delete a super admin, even to a super admin", () => {
    render(<AdminUsersManager />);
    expect(within(rowFor("russel")).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(rowFor("nimal")).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect((screen.getByLabelText(/^Role/) as HTMLSelectElement).disabled).toBe(false);
  });

  it("keeps an admin who is not a super admin away from other admins and the role picker", async () => {
    mocks.viewer = plainAdmin;
    mocks.fetchRoles.mockResolvedValue([]);
    mocks.fetchUserRoles.mockResolvedValue([]);
    render(<AdminUsersManager />);

    const ownerRow = within(rowFor("russel"));
    expect(ownerRow.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(ownerRow.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(ownerRow.getByText("Managed by super admins")).toBeTruthy();

    // Their own account stays editable, but not deletable.
    expect(within(rowFor("nimal")).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(rowFor("nimal")).queryByRole("button", { name: "Delete" })).toBeNull();

    // Ordinary users stay fully manageable, without changing admin access.
    expect(within(rowFor("player")).getByRole("button", { name: "Delete" })).toBeTruthy();
    fireEvent.click(within(rowFor("player")).getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText(/^Role/) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Only a super admin can make someone an admin/)).toBeTruthy();
    expect(await screen.findByText("Only a super admin can change roles.")).toBeTruthy();
  });
});
