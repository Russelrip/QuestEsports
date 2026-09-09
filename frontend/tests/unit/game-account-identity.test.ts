import { describe, expect, it } from "vitest";
import { findGameAccount, gameAccountRiotId, leaderboardRegistrationMessage } from "../../lib/game-accounts";
import type { GameAccount } from "../../lib/game-accounts";

// A connected account is the only version of a player's game identity that was
// checked against anything. These two helpers are what turns one back into the
// `Name#TAG` string every VALORANT surface still speaks.

const account = (overrides: Partial<GameAccount> = {}): GameAccount => ({
  id: "acc-1",
  game: "valorant",
  username: "Russel",
  tagline: "1234",
  region: "ap",
  verificationStatus: "discord_corroborated",
  status: "active",
  linkedAt: null,
  verifiedAt: null,
  lastSyncedAt: null,
  ...overrides,
} as GameAccount);

describe("game account identity", () => {
  it("renders a connected account as the Riot ID every surface expects", () => {
    expect(gameAccountRiotId(account())).toBe("Russel#1234");
  });

  it("refuses to render half an identifier", () => {
    // Half a Riot ID looks like a value and matches nothing, which is worse
    // than an empty field somebody is prompted to fill.
    expect(gameAccountRiotId(account({ tagline: null as unknown as string }))).toBeNull();
    expect(gameAccountRiotId(account({ username: "" }))).toBeNull();
    expect(gameAccountRiotId(null)).toBeNull();
    expect(gameAccountRiotId(undefined)).toBeNull();
  });

  it("finds the account for the game being registered, not just the first one", () => {
    const accounts = [
      account({ id: "acc-cs", game: "cs2" as GameAccount["game"], username: "Other", tagline: "1" }),
      account({ id: "acc-val" }),
    ];
    expect(findGameAccount(accounts, "valorant")?.id).toBe("acc-val");
    expect(findGameAccount(accounts, "VALORANT")?.id).toBe("acc-val");
  });

  it("returns nothing rather than guessing when the game has no connected account", () => {
    expect(findGameAccount([account()], "cs2")).toBeNull();
    expect(findGameAccount([], "valorant")).toBeNull();
    expect(findGameAccount(null, "valorant")).toBeNull();
  });
});

describe("leaderboard registration outcome", () => {
  it("confirms a new leaderboard entry", () => {
    expect(leaderboardRegistrationMessage({ state: "registered" })).toMatch(/on the VALORANT leaderboard/);
  });

  it("stays quiet when there is nothing for the player to do", () => {
    // Already on it, or the leaderboard could not be reached. Neither is the
    // player's problem, and neither should interrupt a successful connection.
    expect(leaderboardRegistrationMessage({ state: "already" })).toBeNull();
    expect(leaderboardRegistrationMessage({ state: "unavailable" })).toBeNull();
    expect(leaderboardRegistrationMessage(null)).toBeNull();
  });

  it("tells a player when their leaderboard entry points at an older account", () => {
    // The one case they must act on. A stale entry is worse than an absent one:
    // it looks current and is wrong, and the leaderboard cannot be re-pointed.
    const message = leaderboardRegistrationMessage({
      state: "diverged",
      registeredName: "OldName",
      registeredTag: "0000",
    });
    expect(message).toMatch(/OldName#0000/);
    expect(message).toMatch(/admin/i);
  });

  it("still explains a divergence when the older account cannot be named", () => {
    expect(leaderboardRegistrationMessage({ state: "diverged" })).toMatch(/a different account/);
  });
});
