import { describe, expect, it } from "vitest";
import { findGameAccount, gameAccountRiotId } from "../../lib/game-accounts";
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
