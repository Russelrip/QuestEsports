import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboardPlayersManager, {
  UNDO_REMOVAL_REASON,
} from "../../components/admin/valorant/ValorantLeaderboardPlayersManager";
import {
  leaderboardRemovalBlocker,
  type ValorantLeaderboardRegistration,
  type ValorantLeaderboardRemovedPlayer,
} from "../../lib/valorant";

const mocks = vi.hoisted(() => ({
  fetchRegistrations: vi.fn(),
  fetchRemovals: vi.fn(),
  fetchBans: vi.fn(),
  banRegistration: vi.fn(),
  banRemoval: vi.fn(),
  lift: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  fetchValorantLeaderboardRegistrations: mocks.fetchRegistrations,
  fetchValorantLeaderboardRemovals: mocks.fetchRemovals,
  removeValorantLeaderboardRegistration: mocks.remove,
  restoreValorantLeaderboardRemoval: mocks.restore,
  fetchValorantLeaderboardBans: mocks.fetchBans,
  banValorantLeaderboardRegistration: mocks.banRegistration,
  banValorantLeaderboardRemoval: mocks.banRemoval,
  liftValorantLeaderboardBan: mocks.lift,
}));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

const registration: ValorantLeaderboardRegistration = {
  puuid: "d580-3d76",
  name: "CasperYT",
  tag: "1991",
  discordUsername: "janithbokula.",
  currentTier: "Diamond 2",
  elo: 1621,
  lastPlayed: "2026-09-12T20:56:09+00:00",
  updateSource: "updater_service",
  updatedAt: new Date().toISOString(),
  onLeaderboard: true,
};

const removal = (overrides: Partial<ValorantLeaderboardRemovedPlayer> = {}): ValorantLeaderboardRemovedPlayer => ({
  removalId: "removal-1",
  puuid: "d580-3d76",
  name: "CasperYT",
  tag: "1991",
  discordUsername: "janithbokula.",
  currentTier: "Diamond 2",
  elo: 1621,
  lastPlayed: null,
  removedAt: "2026-09-14T07:33:25+00:00",
  removedBy: { id: "admin-1", username: "Russel" },
  restoredAt: null,
  restoredBy: null,
  registeredAgain: false,
  superseded: false,
  banned: false,
  restorable: true,
  ...overrides,
});

const page = <T,>(entries: T[]) => ({ entries, total: entries.length, page: 1, perPage: 20, totalPages: 1 });

const removedSection = () => screen.getByRole("heading", { name: "Removed players" }).closest("div")!.parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRegistrations.mockResolvedValue(page([registration]));
  mocks.fetchRemovals.mockResolvedValue(page([]));
  mocks.fetchBans.mockResolvedValue(page([]));
});
afterEach(() => cleanup());

describe("leaderboard removal blocker", () => {
  it("explains why a removal cannot be restored", () => {
    expect(leaderboardRemovalBlocker(removal())).toBeNull();
    expect(leaderboardRemovalBlocker(removal({ restoredAt: "2026-09-14T08:00:00Z", restorable: false }))).toBe("Already restored");
    expect(leaderboardRemovalBlocker(removal({ superseded: true, restorable: false }))).toMatch(/Removed again later/);
    expect(leaderboardRemovalBlocker(removal({ registeredAgain: true, restorable: false }))).toBe("Registered again");
    expect(leaderboardRemovalBlocker(removal({ banned: true, registeredAgain: true, restorable: false }))).toMatch(/Banned/);
  });
});

describe("removed players panel", () => {
  it("restores a removal with a reason and refreshes the players list", async () => {
    mocks.fetchRemovals.mockResolvedValue(
      page([
        removal(),
        removal({ removalId: "removal-2", name: "M4HITH", tag: "Rogue", registeredAgain: true, restorable: false }),
      ]),
    );
    mocks.restore.mockResolvedValue({ restored: registration, removalId: "removal-1", removedAt: null });
    render(<ValorantLeaderboardPlayersManager />);

    const section = await waitFor(() => removedSection());
    await within(section).findByText("M4HITH#Rogue");
    expect(within(section).getByText("Registered again")).toBeTruthy();
    expect(within(section).getAllByText("by @Russel")).toHaveLength(2);
    // Only the restorable removal offers the button.
    expect(within(section).getAllByRole("button", { name: "Restore" })).toHaveLength(1);
    expect(within(section).getAllByRole("button", { name: "Ban" })).toHaveLength(2);

    fireEvent.click(within(section).getByRole("button", { name: "Restore" }));
    const submit = within(section).getByRole("button", { name: "Restore player" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Removed the wrong CasperYT" } });
    const registrationLoads = mocks.fetchRegistrations.mock.calls.length;
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith("removal-1", "Removed the wrong CasperYT"));
    await waitFor(() => expect(mocks.fetchRegistrations.mock.calls.length).toBeGreaterThan(registrationLoads));
    expect(mocks.showToast).toHaveBeenCalledWith({ title: "CasperYT#1991 restored to the leaderboard", tone: "success" });
  });

  it("shows the reason a restore was refused and reloads the removals", async () => {
    mocks.fetchRemovals.mockResolvedValue(page([removal()]));
    mocks.restore.mockRejectedValue(new Error("this player's Discord account is now registered to another leaderboard player"));
    render(<ValorantLeaderboardPlayersManager />);

    const section = await waitFor(() => removedSection());
    fireEvent.click(await within(section).findByRole("button", { name: "Restore" }));
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Mistake" } });
    const removalLoads = mocks.fetchRemovals.mock.calls.length;
    fireEvent.click(within(section).getByRole("button", { name: "Restore player" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        title: "this player's Discord account is now registered to another leaderboard player",
        tone: "error",
      }),
    );
    await waitFor(() => expect(mocks.fetchRemovals.mock.calls.length).toBeGreaterThan(removalLoads));
  });

  it("says what appears there when nothing has been removed", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    expect(await screen.findByText("No removed players")).toBeTruthy();
  });
});

describe("undo after removing", () => {
  it("offers Undo for the removal just made and restores it", async () => {
    mocks.remove.mockResolvedValue({ removed: registration, removalId: "removal-9", rankingsCleared: 0 });
    mocks.restore.mockResolvedValue({ restored: registration, removalId: "removal-9", removedAt: null });
    render(<ValorantLeaderboardPlayersManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByPlaceholderText(/Account no longer exists/), { target: { value: "Player requested" } });
    const removalLoads = mocks.fetchRemovals.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Remove player" }));

    const banner = await screen.findByRole("status");
    expect(within(banner).getByText("CasperYT#1991")).toBeTruthy();
    // The new removal shows in the panel straight away.
    await waitFor(() => expect(mocks.fetchRemovals.mock.calls.length).toBeGreaterThan(removalLoads));

    fireEvent.click(within(banner).getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith("removal-9", UNDO_REMOVAL_REASON));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("offers no Undo when the platform kept no copy", async () => {
    mocks.remove.mockResolvedValue({ removed: registration, removalId: null, rankingsCleared: 0 });
    render(<ValorantLeaderboardPlayersManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByPlaceholderText(/Account no longer exists/), { target: { value: "Player requested" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove player" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
