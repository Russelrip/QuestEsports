import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboardPlayersManager from "../../components/admin/valorant/ValorantLeaderboardPlayersManager";

// Removing a leaderboard registration is the one destructive action on this
// tab: it has to say what happens, refuse to run without a reason, and send the
// reason the admin actually typed.

const mocks = vi.hoisted(() => ({
  fetchRegistrations: vi.fn(),
  removeRegistration: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  fetchValorantLeaderboardRegistrations: mocks.fetchRegistrations,
  removeValorantLeaderboardRegistration: mocks.removeRegistration,
}));

vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

const stale = {
  puuid: "fe6c5224-dc61-5c3e-95eb-c29ad4f4acea",
  name: "Chamsy",
  tag: "0001",
  discordUsername: "chamsy.",
  currentTier: "Gold 3",
  elo: 1128,
  lastPlayed: null,
  updateSource: "migration",
  updatedAt: "2026-08-15T14:09:35+00:00",
  onLeaderboard: false,
};

const listed = {
  ...stale,
  puuid: "listed-puuid",
  name: "Sahan",
  tag: "QST",
  discordUsername: "sahan",
  lastPlayed: new Date().toISOString(),
  updateSource: "updater_service",
  updatedAt: new Date().toISOString(),
  onLeaderboard: true,
};

const page = (entries: unknown[]) => ({ entries, total: entries.length, page: 1, perPage: 50, totalPages: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRegistrations.mockResolvedValue(page([stale, listed]));
});

afterEach(() => cleanup());

describe("ValorantLeaderboardPlayersManager", () => {
  it("lists hidden and listed players and flags the one the updater is failing on", async () => {
    render(<ValorantLeaderboardPlayersManager />);

    expect(await screen.findByText("Chamsy")).toBeTruthy();
    expect(screen.getByText("Hidden")).toBeTruthy();
    expect(screen.getByText("Listed")).toBeTruthy();
    expect(screen.getByText("Updater is not refreshing this player")).toBeTruthy();
    expect(screen.getByText("None recorded")).toBeTruthy();
  });

  it("searches from page one with the trimmed query", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search leaderboard players" }), {
      target: { value: "  chamsy " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "chamsy", page: 1 })
    );
  });

  it("will not remove without a reason, then sends the trimmed reason and refreshes", async () => {
    mocks.removeRegistration.mockResolvedValue({ removed: stale, rankingsCleared: 0 });
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByText(/Remove Chamsy#0001 from the leaderboard\?/)).toBeTruthy();
    expect(screen.getByText(/marks them Unverified/)).toBeTruthy();

    const submit = screen.getByRole("button", { name: "Remove player" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "   " } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
      target: { value: "  Account no longer exists  " },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.removeRegistration).toHaveBeenCalledWith(stale.puuid, "Account no longer exists")
    );
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        title: "Chamsy#0001 removed from the leaderboard",
        tone: "success",
      })
    );
    expect(mocks.fetchRegistrations).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Remove player" })).toBeNull();
  });

  it("keeps the confirmation open and reports the error when removal fails", async () => {
    mocks.removeRegistration.mockRejectedValue(new Error("leaderboard player not found"));
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove player" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "leaderboard player not found", tone: "error" })
    );
    expect(screen.getByRole("button", { name: "Remove player" })).toBeTruthy();
  });
});
