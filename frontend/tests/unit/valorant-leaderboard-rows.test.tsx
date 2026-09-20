import React from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantLeaderboard from "../../components/valorant/ValorantLeaderboard";
import type {
  ValorantPlayerLeaderboardEntry,
  ValorantPlayerLeaderboardSearchEntry,
} from "../../lib/valorant";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));

const entry = (overrides: Partial<ValorantPlayerLeaderboardEntry> = {}): ValorantPlayerLeaderboardEntry => ({
  name: "Sahan",
  tag: "LKA",
  discordUsername: "sahan",
  currentTier: "Immortal 1",
  elo: 1900,
  rankInTier: 12,
  peakRank: "Immortal 2",
  peakSeason: "e9a3",
  lastPlayed: "2026-09-19T10:00:00.000Z",
  ...overrides,
});

const props = (overrides: Partial<React.ComponentProps<typeof ValorantLeaderboard>> = {}) => ({
  entries: [] as ValorantPlayerLeaderboardEntry[],
  page: 1,
  perPage: 50,
  total: 0,
  totalPages: 1,
  query: "",
  searchResults: [] as ValorantPlayerLeaderboardSearchEntry[],
  ...overrides,
});

// The public API no longer sends a PUUID, so rows are keyed by Riot ID. A rename
// can leave two rows claiming one Riot ID until the next refresh, and duplicate
// keys make React reuse the wrong row, so the rank has to be part of the key.
describe("ValorantLeaderboard row keys", () => {
  let errors: unknown[][];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const duplicateKeyWarnings = () =>
    errors.filter((args) => args.some((arg) => typeof arg === "string" && arg.includes("same key")));

  it("renders two players sharing a Riot ID without duplicate keys", () => {
    const { container } = render(
      <ValorantLeaderboard
        {...props({ entries: [entry(), entry({ discordUsername: "renamed", elo: 1800 })], total: 2 })}
      />,
    );

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(duplicateKeyWarnings()).toEqual([]);
  });

  it("renders search hits sharing a Riot ID without duplicate keys", () => {
    const hit = (rank: number | null, discordUsername: string): ValorantPlayerLeaderboardSearchEntry => ({
      ...entry({ discordUsername }),
      rank,
    });
    const { container } = render(
      <ValorantLeaderboard {...props({ query: "sahan", searchResults: [hit(3, "sahan"), hit(9, "renamed")] })} />,
    );

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(duplicateKeyWarnings()).toEqual([]);
  });
});
