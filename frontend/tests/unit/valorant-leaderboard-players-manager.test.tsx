import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboardPlayersManager from "../../components/admin/valorant/ValorantLeaderboardPlayersManager";

// Removing a leaderboard registration is the one destructive action on this
// tab: it has to say what happens, refuse to run without a reason, and send the
// reason the admin actually typed.

const mocks = vi.hoisted(() => ({
  fetchRegistrations: vi.fn(),
  removeRegistration: vi.fn(),
  hideRegistration: vi.fn(),
  unhideRegistration: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  fetchValorantLeaderboardRegistrations: mocks.fetchRegistrations,
  removeValorantLeaderboardRegistration: mocks.removeRegistration,
  hideValorantLeaderboardRegistration: mocks.hideRegistration,
  unhideValorantLeaderboardRegistration: mocks.unhideRegistration,
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

    expect(await screen.findByText("Chamsy#0001")).toBeTruthy();
    expect(screen.getByText("Not listed")).toBeTruthy();
    expect(screen.getByText("Listed")).toBeTruthy();
    expect(screen.getByText("Updater is not refreshing this player")).toBeTruthy();
    expect(screen.getByText("None recorded")).toBeTruthy();
  });

  it("searches as you type, like the public leaderboard, from two characters", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy#0001");
    const box = screen.getByRole("searchbox", { name: "Search by Discord username, Riot ID or PUUID" });

    // One character (after the @) is not a search: nothing new is fetched.
    fireEvent.change(box, { target: { value: "@c" } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(mocks.fetchRegistrations).toHaveBeenCalledTimes(1);

    // No button press: the debounce sends the normalized query from page one.
    fireEvent.change(box, { target: { value: "  @Cham " } });
    await waitFor(() =>
      expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "Cham", page: 1, hidden: false })
    );
    expect(mocks.fetchRegistrations).toHaveBeenCalledTimes(2);
  });

  it("highlights the match and clears with the button or Escape", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy#0001");
    const box = screen.getByRole("searchbox", { name: "Search by Discord username, Riot ID or PUUID" });

    fireEvent.change(box, { target: { value: "cham" } });
    // Submitting flushes the debounce.
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    await waitFor(() => expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "cham", page: 1, hidden: false }));
    await waitFor(() => expect(document.querySelectorAll("mark").length).toBeGreaterThan(0));
    expect([...document.querySelectorAll("mark")].map((mark) => mark.textContent)).toContain("Cham");
    expect(screen.getByText(/matching/).textContent).toContain("cham");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((box as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "", page: 1, hidden: false }));

    fireEvent.change(box, { target: { value: "sahan" } });
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    await waitFor(() => expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "sahan", page: 1, hidden: false }));
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "", page: 1, hidden: false }));
  });

  it("will not remove without a reason, then sends the trimmed reason and refreshes", async () => {
    mocks.removeRegistration.mockResolvedValue({ removed: stale, rankingsCleared: 0 });
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy#0001");

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

  it("marks a player hidden by staff with who hid them and why", async () => {
    mocks.fetchRegistrations.mockResolvedValue(
      page([
        {
          ...listed,
          onLeaderboard: false,
          hiddenAt: "2026-09-18T07:33:25+00:00",
          hiddenBy: { id: "admin-1", username: "russel" },
          hiddenReason: "Smurf account under review",
        },
      ])
    );
    render(<ValorantLeaderboardPlayersManager />);

    expect(await screen.findByText("Hidden by staff")).toBeTruthy();
    expect(screen.getByText(/By russel/)).toBeTruthy();
    expect(screen.getByText("Smurf account under review")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show" })).toBeTruthy();
  });

  it("will not hide without a reason, tells the admin the player sees it, then hides", async () => {
    mocks.hideRegistration.mockResolvedValue({ player: { ...listed, hiddenAt: "2026-09-18T07:33:25+00:00" } });
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Sahan#QST");

    fireEvent.click(screen.getAllByRole("button", { name: "Hide" })[1]);
    expect(screen.getByText(/Hide Sahan#QST from the public leaderboard\?/)).toBeTruthy();
    expect(screen.getByText(/They stay registered/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Hide player" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: /the player sees this/ }), {
      target: { value: "  Smurf account under review  " },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.hideRegistration).toHaveBeenCalledWith(listed.puuid, "Smurf account under review")
    );
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "Sahan#QST hidden from the public leaderboard", tone: "success" })
    );
    expect(mocks.removeRegistration).not.toHaveBeenCalled();
  });

  it("shows a hidden player again", async () => {
    mocks.fetchRegistrations.mockResolvedValue(
      page([{ ...listed, onLeaderboard: false, hiddenAt: "2026-09-18T07:33:25+00:00", hiddenReason: "Review" }])
    );
    mocks.unhideRegistration.mockResolvedValue({ player: listed });
    render(<ValorantLeaderboardPlayersManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Show" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Cleared after review" } });
    fireEvent.click(screen.getByRole("button", { name: "Show player" }));

    await waitFor(() => expect(mocks.unhideRegistration).toHaveBeenCalledWith(listed.puuid, "Cleared after review"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "Sahan#QST is back on the public leaderboard", tone: "success" })
    );
  });

  it("filters to the players hidden by staff", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy#0001");

    fireEvent.click(screen.getByRole("button", { name: "Show only players hidden by staff" }));

    await waitFor(() =>
      expect(mocks.fetchRegistrations).toHaveBeenLastCalledWith({ query: "", page: 1, hidden: true })
    );
  });

  it("keeps the confirmation open and reports the error when removal fails", async () => {
    mocks.removeRegistration.mockRejectedValue(new Error("leaderboard player not found"));
    render(<ValorantLeaderboardPlayersManager />);
    await screen.findByText("Chamsy#0001");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove player" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "leaderboard player not found", tone: "error" })
    );
    expect(screen.getByRole("button", { name: "Remove player" })).toBeTruthy();
  });
});
