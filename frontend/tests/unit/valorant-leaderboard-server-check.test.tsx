import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboardPlayersManager from "../../components/admin/valorant/ValorantLeaderboardPlayersManager";
import {
  describeServerCheckRule,
  serverCheckReasonLines,
  type ValorantServerCheck,
  type ValorantServerCheckPage,
  type ValorantServerCheckRule,
} from "../../lib/valorant";

const mocks = vi.hoisted(() => ({
  fetchRegistrations: vi.fn(),
  fetchRemovals: vi.fn(),
  fetchServerChecks: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  clear: vi.fn(),
  reopen: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/lib/valorant-api", () => ({
  fetchValorantLeaderboardRegistrations: mocks.fetchRegistrations,
  fetchValorantLeaderboardRemovals: mocks.fetchRemovals,
  fetchValorantServerChecks: mocks.fetchServerChecks,
  removeValorantLeaderboardRegistration: mocks.remove,
  restoreValorantLeaderboardRemoval: mocks.restore,
  clearValorantServerCheck: mocks.clear,
  reopenValorantServerCheck: mocks.reopen,
}));
vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

const rule: ValorantServerCheckRule = {
  homeClusters: ["Singapore", "Mumbai"],
  homeShard: "ap",
  windowDays: 30,
  minMatches: 5,
  awayShare: 0.5,
};

const check = (overrides: Partial<ValorantServerCheck> = {}): ValorantServerCheck => ({
  puuid: "roo-puuid",
  name: "Roo",
  tag: "SYD",
  discordUsername: "roo",
  currentTier: "Ascendant 1",
  elo: 1900,
  lastPlayed: "2026-09-13T20:11:00+00:00",
  onLeaderboard: true,
  accountRegion: "ap",
  status: "flagged",
  reasons: ["away_servers"],
  matches: 26,
  knownMatches: 25,
  awayMatches: 24,
  awayShare: 0.96,
  servers: [
    { cluster: "Sydney", matches: 24, home: false },
    { cluster: "Mumbai", matches: 1, home: true },
    { cluster: null, matches: 1, home: null },
  ],
  since: "2026-08-15T17:00:00+00:00",
  checkedAt: "2026-09-14T10:00:00+00:00",
  clearedAt: null,
  clearedBy: null,
  ...overrides,
});

const checksPage = (entries: ValorantServerCheck[], summary = { registered: 491, checked: 40, flagged: 1, cleared: 0 }): ValorantServerCheckPage => ({
  entries,
  total: entries.length,
  page: 1,
  perPage: 20,
  totalPages: 1,
  summary,
  rule,
});

const emptyPage = { entries: [], total: 0, page: 1, perPage: 20, totalPages: 1 };

const serverCheckSection = () =>
  screen.getByRole("heading", { name: "Server check" }).closest("div")!.parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRegistrations.mockResolvedValue(emptyPage);
  mocks.fetchRemovals.mockResolvedValue(emptyPage);
  mocks.fetchServerChecks.mockImplementation(async ({ status }: { status: string }) =>
    status === "flagged"
      ? checksPage([check()])
      : checksPage(
          [check({ status: "cleared", reasons: [], clearedAt: "2026-09-14T11:00:00+00:00", clearedBy: { id: "a1", username: "Russel" } })],
          { registered: 491, checked: 40, flagged: 0, cleared: 1 }
        )
  );
});
afterEach(() => cleanup());

describe("server check wording", () => {
  it("explains each reason and the rule from what the platform reports", () => {
    expect(serverCheckReasonLines(check(), rule)).toEqual([
      "96% — 24 of 25 recent competitive matches away from Singapore and Mumbai",
    ]);
    expect(serverCheckReasonLines(check({ reasons: ["account_region"], accountRegion: "eu" }), rule)).toEqual([
      "Riot account is on EU, not AP",
    ]);
    expect(describeServerCheckRule(rule)).toBe(
      "A player is flagged when at least 50% of the last 30 days of competitive matches were played away from Singapore and Mumbai (from 5 or more matches), or when their Riot account is not on the AP region."
    );
  });
});

describe("server check panel", () => {
  it("lists flagged players with their servers, reason and coverage", async () => {
    render(<ValorantLeaderboardPlayersManager />);
    const section = serverCheckSection();

    expect(await within(section).findByText("Roo#SYD")).toBeTruthy();
    expect(mocks.fetchServerChecks).toHaveBeenCalledWith({ status: "flagged", page: 1 });
    const servers = within(section).getByRole("list", { name: "Recent competitive matches by server" });
    expect(within(servers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Sydney24",
      "Mumbai1",
      "Unknown server1",
    ]);
    expect(within(section).getByText(/24 of 25 recent competitive matches away/)).toBeTruthy();
    expect(within(section).getByText(/Servers checked for 40 of 491 players/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "tracker.gg" }).getAttribute("href")).toBe(
      "https://tracker.gg/valorant/profile/riot/Roo%23SYD/overview"
    );
  });

  it("keeps a flagged player only with a reason", async () => {
    mocks.clear.mockResolvedValue(check({ status: "cleared", reasons: [] }));
    render(<ValorantLeaderboardPlayersManager />);
    const section = serverCheckSection();

    fireEvent.click(await within(section).findByRole("button", { name: "Keep" }));
    const submit = within(section).getByRole("button", { name: "Keep player" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "  Studying in Melbourne  " } });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith("roo-puuid", "Studying in Melbourne"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "Roo#SYD kept on the leaderboard", tone: "success" })
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes through the ordinary removal and offers Undo", async () => {
    mocks.remove.mockResolvedValue({ removed: {}, removalId: "removal-9", rankingsCleared: 0 });
    render(<ValorantLeaderboardPlayersManager />);
    const section = serverCheckSection();

    fireEvent.click(await within(section).findByRole("button", { name: "Remove" }));
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Plays from Australia" } });
    fireEvent.click(within(section).getByRole("button", { name: "Remove player" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("roo-puuid", "Plays from Australia"));
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Roo#SYD was removed from the leaderboard.");
    // The removals panel picks up the new removal.
    await waitFor(() => expect(mocks.fetchRemovals.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows kept players and reopens one", async () => {
    mocks.reopen.mockResolvedValue(check());
    render(<ValorantLeaderboardPlayersManager />);
    const section = serverCheckSection();

    fireEvent.click(await within(section).findByRole("button", { name: /^Kept/ }));
    await waitFor(() => expect(mocks.fetchServerChecks).toHaveBeenCalledWith({ status: "cleared", page: 1 }));
    expect(await within(section).findByText("by @Russel")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Reopen" }));
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Kept the wrong player" } });
    fireEvent.click(within(section).getByRole("button", { name: "Reopen check" }));

    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledWith("roo-puuid", "Kept the wrong player"));
  });

  it("shows a refusal from the platform", async () => {
    mocks.clear.mockRejectedValue(new Error("this player is not flagged by the server check"));
    render(<ValorantLeaderboardPlayersManager />);
    const section = serverCheckSection();

    fireEvent.click(await within(section).findByRole("button", { name: "Keep" }));
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "Keep" } });
    fireEvent.click(within(section).getByRole("button", { name: "Keep player" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({ title: "this player is not flagged by the server check", tone: "error" })
    );
  });
});
