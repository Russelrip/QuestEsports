import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersManager from "../../components/admin/AdminUsersManager";

// Who can open which admin areas should be visible from the users list, without
// opening each account.

const mocks = vi.hoisted(() => ({
  useAdminUsers: vi.fn(),
  refetch: vi.fn(),
  fetchPermissions: vi.fn(),
  updatePermissions: vi.fn(),
}));

vi.mock("@/hooks/api/useAdmin", () => ({ useAdminUsers: mocks.useAdminUsers }));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: () => void }) => unknown) => selector({ showToast: vi.fn() }),
}));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/lib/staff-permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/staff-permissions")>("../../lib/staff-permissions");
  return { ...actual, fetchUserStaffPermissions: mocks.fetchPermissions, updateUserStaffPermissions: mocks.updatePermissions };
});

const base = { firstName: "A", lastName: "B", phone: null, discordTag: null, createdAt: null, lastLoginAt: null };
const users = [
  { ...base, id: "u-staff", username: "sahan", email: "sahan@example.test", role: "user", staffPermissions: ["valorant_leaderboard"] },
  { ...base, id: "u-player", username: "player", email: "player@example.test", role: "user", staffPermissions: [] },
  { ...base, id: "u-admin", username: "russel", email: "russel@example.test", role: "admin", staffPermissions: [] },
];

const rowFor = (username: string) => screen.getByText(`@${username}`).closest("div.grid") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAdminUsers.mockReturnValue({
    data: { users, pagination: { page: 1, pageSize: 10, total: 3, totalPages: 1 } },
    error: "",
    loading: false,
    refetch: mocks.refetch,
  });
});
afterEach(() => cleanup());

describe("users list staff access", () => {
  it("shows each user's staff areas, all areas for admins, and nothing for players", () => {
    render(<AdminUsersManager />);

    expect(within(rowFor("sahan")).getByText("VALORANT leaderboard")).toBeTruthy();
    expect(within(rowFor("russel")).getByText("All areas")).toBeTruthy();
    expect(within(rowFor("player")).queryByText(/Staff access/)).toBeNull();
  });

  it("offers a staff filter and passes it to the users query", () => {
    render(<AdminUsersManager />);

    const filter = screen.getAllByRole("combobox").find((select) =>
      [...(select as HTMLSelectElement).options].some((option) => option.value === "staff")
    ) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "staff" } });

    expect(mocks.useAdminUsers).toHaveBeenLastCalledWith("", "staff", 1);
  });

  it("refreshes the list after staff access is saved", async () => {
    mocks.fetchPermissions.mockResolvedValue({
      catalog: [{ key: "valorant_leaderboard", label: "VALORANT leaderboard", description: "" }],
      permissions: [],
    });
    mocks.updatePermissions.mockResolvedValue({
      catalog: [{ key: "valorant_leaderboard", label: "VALORANT leaderboard", description: "" }],
      permissions: ["valorant_leaderboard"],
    });
    render(<AdminUsersManager />);

    fireEvent.click(within(rowFor("player")).getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /VALORANT leaderboard/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save staff access" }));

    await waitFor(() => expect(mocks.updatePermissions).toHaveBeenCalledWith("u-player", ["valorant_leaderboard"]));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });
});
