import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboardPlayersManager from "../../components/admin/valorant/ValorantLeaderboardPlayersManager";
import {
  leaderboardBanCovers,
  type ValorantLeaderboardBan,
  type ValorantLeaderboardRegistration,
  type ValorantLeaderboardRemovedPlayer,
} from "../../lib/valorant";

const mocks = vi.hoisted(() => ({
  fetchRegistrations: vi.fn(),
  fetchRemovals: vi.fn(),
  fetchBans: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  banRegistration: vi.fn(),
  banRemoval: vi.fn(),
  lift: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  fetchValorantLeaderboardRegistrations: mocks.fetchRegistrations,
  fetchValorantLeaderboardRemovals: mocks.fetchRemovals,
  fetchValorantLeaderboardBans: mocks.fetchBans,
  removeValorantLeaderboardRegistration: mocks.remove,
  restoreValorantLeaderboardRemoval: mocks.restore,
  banValorantLeaderboardRegistration: mocks.banRegistration,
  banValorantLeaderboardRemoval: mocks.banRemoval,
  liftValorantLeaderboardBan: mocks.lift,
  fetchValorantServerChecks: vi.fn(async () => ({
    entries: [],
    total: 0,
    page: 1,
    perPage: 20,
    totalPages: 1,
  })),
}));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));
// The server check panel is not under test here.
vi.mock("@/components/admin/valorant/ValorantLeaderboardServerCheckPanel", () => ({ default: () => null }));

const registration: ValorantLeaderboardRegistration = {
  puuid: "mush-puuid",
  name: "mush",
  tag: "1443",
  discordUsername: "imalwaysobored",
  currentTier: "Gold 1",
  elo: 1200,
  lastPlayed: "2026-09-16T20:56:09+00:00",
  updateSource: "registration_service",
  updatedAt: new Date().toISOString(),
  onLeaderboard: true,
};

const removal = (overrides: Partial<ValorantLeaderboardRemovedPlayer> = {}): ValorantLeaderboardRemovedPlayer => ({
  removalId: "removal-1",
  puuid: "mush-puuid",
  name: "mush",
  tag: "1443",
  discordUsername: "imalwaysobored",
  currentTier: "Gold 1",
  elo: 1200,
  lastPlayed: null,
  removedAt: "2026-09-16T07:33:25+00:00",
  removedBy: { id: "admin-1", username: "Russel" },
  restoredAt: null,
  restoredBy: null,
  registeredAgain: false,
  superseded: false,
  banned: false,
  restorable: true,
  ...overrides,
});

const ban = (overrides: Partial<ValorantLeaderboardBan> = {}): ValorantLeaderboardBan => ({
  banId: "ban-1",
  puuid: "mush-puuid",
  discordBanned: true,
  name: "mush",
  tag: "1443",
  discordUsername: "imalwaysobored",
  reason: "Keeps registering again after removal",
  bannedAt: "2026-09-17T10:00:00+00:00",
  bannedBy: { id: "admin-1", username: "Russel" },
  liftedAt: null,
  liftedBy: null,
  active: true,
  ...overrides,
});

const page = <T,>(entries: T[]) => ({ entries, total: entries.length, page: 1, perPage: 20, totalPages: 1 });

const section = (heading: string) => screen.getByRole("heading", { name: heading }).closest("div")!.parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRegistrations.mockResolvedValue(page([registration]));
  mocks.fetchRemovals.mockResolvedValue(page([]));
  mocks.fetchBans.mockResolvedValue(page([]));
});
afterEach(() => cleanup());

describe("ban coverage label", () => {
  it("names the accounts a ban covers", () => {
    expect(leaderboardBanCovers({ puuid: "p", discordBanned: true })).toBe("Riot and Discord accounts");
    expect(leaderboardBanCovers({ puuid: "p", discordBanned: false })).toBe("Riot account");
    expect(leaderboardBanCovers({ puuid: null, discordBanned: true })).toBe("Discord account");
  });
});

describe("remove and ban", () => {
  it("bans instead of only removing when the box is ticked, and offers no Undo", async () => {
    mocks.banRegistration.mockResolvedValue({
      ban: ban(),
      removed: [
        { ...registration, removalId: "removal-9" },
        { ...registration, puuid: "alt", name: "mush2", removalId: "removal-10" },
      ],
      rankingsCleared: 0,
    });
    render(<ValorantLeaderboardPlayersManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Also ban them from registering again" }));
    expect(screen.getByText(/even under a\s+new Riot ID/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Account no longer exists/), { target: { value: "Keeps coming back" } });
    const banLoads = mocks.fetchBans.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Remove and ban" }));

    await waitFor(() => expect(mocks.banRegistration).toHaveBeenCalledWith("mush-puuid", "Keeps coming back"));
    expect(mocks.remove).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        title: "mush#1443 banned; 1 other registration on the same accounts removed too",
        tone: "success",
      }),
    );
    await waitFor(() => expect(mocks.fetchBans.mock.calls.length).toBeGreaterThan(banLoads));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("banning from removed players", () => {
  it("bans a removal with a reason and hides Ban and Restore once banned", async () => {
    mocks.fetchRemovals.mockResolvedValue(page([removal(), removal({ removalId: "removal-2", name: "Other", tag: "0001", banned: true, restorable: false })]));
    mocks.banRemoval.mockResolvedValue({ ban: ban(), removed: [], rankingsCleared: 0 });
    render(<ValorantLeaderboardPlayersManager />);

    const removed = await waitFor(() => section("Removed players"));
    await within(removed).findByText("Other#0001");
    expect(within(removed).getByText("Banned")).toBeTruthy();
    // Only the unbanned removal can be restored or banned.
    expect(within(removed).getAllByRole("button", { name: "Restore" })).toHaveLength(1);
    expect(within(removed).getAllByRole("button", { name: "Ban" })).toHaveLength(1);

    fireEvent.click(within(removed).getByRole("button", { name: "Ban" }));
    const submit = within(removed).getByRole("button", { name: "Ban player" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(removed).getByRole("textbox"), { target: { value: "Keeps coming back" } });
    const banLoads = mocks.fetchBans.mock.calls.length;
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.banRemoval).toHaveBeenCalledWith("removal-1", "Keeps coming back"));
    expect(mocks.showToast).toHaveBeenCalledWith({ title: "mush#1443 banned from registering again", tone: "success" });
    await waitFor(() => expect(mocks.fetchBans.mock.calls.length).toBeGreaterThan(banLoads));
  });

  it("shows why a ban was refused", async () => {
    mocks.fetchRemovals.mockResolvedValue(page([removal()]));
    mocks.banRemoval.mockRejectedValue(new Error("this player is already banned"));
    render(<ValorantLeaderboardPlayersManager />);

    const removed = await waitFor(() => section("Removed players"));
    fireEvent.click(await within(removed).findByRole("button", { name: "Ban" }));
    fireEvent.change(within(removed).getByRole("textbox"), { target: { value: "Again" } });
    fireEvent.click(within(removed).getByRole("button", { name: "Ban player" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "this player is already banned", tone: "error" }),
    );
  });
});

describe("banned players panel", () => {
  it("lists active bans and lifts one with a reason", async () => {
    mocks.fetchBans.mockResolvedValue(page([ban()]));
    mocks.lift.mockResolvedValue(ban({ active: false, liftedAt: "2026-09-18T00:00:00+00:00" }));
    render(<ValorantLeaderboardPlayersManager />);

    const bans = await waitFor(() => section("Banned players"));
    await within(bans).findByText("mush#1443");
    expect(within(bans).getByText("Riot and Discord accounts")).toBeTruthy();
    expect(within(bans).getByText("Keeps registering again after removal")).toBeTruthy();
    expect(mocks.fetchBans).toHaveBeenCalledWith({ status: "active", page: 1 });

    fireEvent.click(within(bans).getByRole("button", { name: "Lift ban" }));
    fireEvent.change(within(bans).getByRole("textbox"), { target: { value: "Appeal accepted" } });
    const removalLoads = mocks.fetchRemovals.mock.calls.length;
    const submit = within(bans).getAllByRole("button", { name: "Lift ban" }).at(-1)!;
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.lift).toHaveBeenCalledWith("ban-1", "Appeal accepted"));
    // Lifting can make a removal restorable again.
    await waitFor(() => expect(mocks.fetchRemovals.mock.calls.length).toBeGreaterThan(removalLoads));
  });

  it("switches to lifted bans", async () => {
    render(<ValorantLeaderboardPlayersManager />);

    const bans = await waitFor(() => section("Banned players"));
    expect(await within(bans).findByText("No banned players")).toBeTruthy();
    fireEvent.click(within(bans).getByRole("button", { name: "Lifted" }));

    await waitFor(() => expect(mocks.fetchBans).toHaveBeenCalledWith({ status: "lifted", page: 1 }));
    expect(await within(bans).findByText("No lifted bans")).toBeTruthy();
  });
});
