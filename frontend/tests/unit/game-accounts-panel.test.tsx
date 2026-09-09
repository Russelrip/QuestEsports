import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GameAccountsPanel from "../../components/auth/GameAccountsPanel";

// The leaderboard import is a shortcut past the Riot ID field. Once that field
// has been answered it becomes an offer to do something already done, sitting
// at the top of the one panel that should be unambiguous about what is and is
// not connected.

const mocks = vi.hoisted(() => ({ accounts: [] as unknown[] }));

vi.mock("@/lib/game-accounts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-accounts")>(
    "../../lib/game-accounts",
  );
  return {
    ...actual,
    getMyGameAccounts: async () => ({ playerPublicId: "QPID-1", accounts: mocks.accounts }),
    importValorantFromLeaderboard: vi.fn(),
    linkValorantAccount: vi.fn(),
    resolveValorantAccount: vi.fn(),
    requestValorantChange: vi.fn(),
  };
});

const valorantAccount = {
  id: "acc-1",
  game: "valorant",
  username: "QT Russel",
  tagline: "Senu",
  region: "ap",
  verificationStatus: "discord_corroborated",
  status: "active",
  linkedAt: "2026-09-01T00:00:00.000Z",
  verifiedAt: null,
  lastSyncedAt: null,
};

const importBox = () => screen.queryByRole("button", { name: /Import from leaderboard/i });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts = [];
});

afterEach(() => cleanup());

describe("GameAccountsPanel", () => {
  it("offers the leaderboard import when nothing is connected", async () => {
    render(<GameAccountsPanel />);
    await waitFor(() => expect(importBox()).toBeInTheDocument());
  });

  it("withdraws the offer once an account is connected", async () => {
    mocks.accounts = [valorantAccount];
    render(<GameAccountsPanel />);

    // Wait for the connected account to appear, so this is asserting the box is
    // absent after loading rather than merely absent yet.
    await waitFor(() => expect(screen.getByText(/QT Russel/)).toBeInTheDocument());
    expect(importBox()).not.toBeInTheDocument();
  });

  it("does not flash the offer before the accounts have loaded", () => {
    mocks.accounts = [valorantAccount];
    render(<GameAccountsPanel />);

    // Appearing and then vanishing under the cursor is worse than never
    // appearing: it invites a click on something about to become wrong.
    expect(importBox()).not.toBeInTheDocument();
  });
});
