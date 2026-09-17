import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GameAccountsPanel from "../../components/auth/GameAccountsPanel";
import {
  statusLabel,
  verificationLabel,
  type GameAccountVerification,
} from "../../lib/game-accounts";
import { isValidRiotId } from "../../components/auth/GameAccountsPanel";

const mocks = vi.hoisted(() => ({
  getMyGameAccounts: vi.fn(),
  requestValorantChange: vi.fn(),
  getMyValorantLeaderboardRegistration: vi.fn(),
}));

vi.mock("@/components/valorant/ValorantRegistration", () => ({ default: () => null }));

vi.mock("@/lib/game-accounts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-accounts")>(
    "../../lib/game-accounts",
  );
  return { ...actual, ...mocks };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyGameAccounts.mockResolvedValue({ playerPublicId: null, accounts: [] });
  mocks.getMyValorantLeaderboardRegistration.mockResolvedValue({
    discordConnected: true,
    unavailable: false,
    registration: null,
  });
});
afterEach(() => cleanup());

describe("verification wording", () => {
  it("never calls a self-asserted link 'verified'", () => {
    // A captain reading "Verified" would reasonably believe Quest checked with
    // Riot. It did not, and cannot — there is no Riot Sign-On.
    expect(verificationLabel("user_confirmed")).toBe("Confirmed by you");
    expect(verificationLabel("user_confirmed").toLowerCase()).not.toContain("verified");
    expect(verificationLabel("resolved").toLowerCase()).not.toContain("verified");
    expect(verificationLabel("discord_corroborated").toLowerCase()).not.toContain("verified");
  });

  it("reserves 'verified' for a human decision", () => {
    expect(verificationLabel("admin_verified")).toBe("Verified by an admin");
  });

  it("labels every state", () => {
    const states: GameAccountVerification[] = [
      "resolved",
      "user_confirmed",
      "discord_corroborated",
      "admin_verified",
      "legacy_unverified",
      "revoked",
    ];
    for (const state of states) {
      expect(verificationLabel(state)).not.toBe("Unknown");
    }
  });

  it("explains a tournament lock in plain terms", () => {
    expect(statusLabel("locked")).toBe("Locked by a tournament");
  });
});

describe("connected account", () => {
  it("shows a locked account as locked and explains why", async () => {
    mocks.getMyGameAccounts.mockResolvedValue({
      playerPublicId: "QPID-000001",
      accounts: [
        {
          id: "account-1",
          game: "valorant",
          username: "Russel",
          tagline: "1234",
          region: "ap",
          verificationStatus: "user_confirmed",
          status: "locked",
          linkedAt: null,
          verifiedAt: null,
          lastSyncedAt: null,
        },
      ],
    });
    render(<GameAccountsPanel />);

    expect(await screen.findByText("Locked by a tournament")).toBeTruthy();
    expect(screen.getByText(/registered tournament roster/i)).toBeTruthy();
  });
});


describe("Riot ID validation", () => {
  it("accepts game names containing spaces", () => {
    // Riot allows spaces in game names, and rejecting them locally means a
    // player with a perfectly valid ID can never connect their account.
    expect(isValidRiotId("QT Russel#Senu")).toBe(true);
    expect(isValidRiotId("a b c#tag")).toBe(true);
    expect(isValidRiotId("  QT Russel#Senu  ")).toBe(true);
  });

  it("accepts ordinary Riot IDs", () => {
    expect(isValidRiotId("Russel#1234")).toBe(true);
    expect(isValidRiotId("TenZ#SEN")).toBe(true);
  });

  it("still rejects what cannot resolve", () => {
    for (const value of ["Russel", "Russel#", "#1234", "   ", "#", "a#b#c"]) {
      expect(isValidRiotId(value)).toBe(false);
    }
  });

  it("rejects whitespace inside the tag", () => {
    // The tag is what keeps the separator unambiguous, so it stays strict.
    expect(isValidRiotId("QT Russel#Se nu")).toBe(false);
  });
});

const connectedAccount = (overrides = {}) => ({
  id: "account-1",
  game: "valorant" as const,
  username: "QT Russel",
  tagline: "Senu",
  region: "ap",
  verificationStatus: "discord_corroborated" as const,
  status: "active" as const,
  linkedAt: null,
  verifiedAt: null,
  lastSyncedAt: null,
  ...overrides,
});

describe("changing the connected account", () => {
  beforeEach(() => {
    mocks.getMyGameAccounts.mockResolvedValue({
      playerPublicId: "QPID-000001",
      accounts: [connectedAccount()],
    });
    mocks.requestValorantChange.mockResolvedValue({
      kind: "replacement",
      requestId: "req-1",
      status: "pending",
    });
  });

  it("offers a way to change a connected account", async () => {
    render(<GameAccountsPanel />);
    expect(await screen.findByRole("button", { name: "Change account" })).toBeTruthy();
  });

  it("explains that a rename needs no approval", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    // Otherwise a renamed player thinks they must wait for an admin.
    expect(screen.getByText(/same\s+account and refresh it/i)).toBeTruthy();
  });

  it("lets the server ask for a reason, because only it can tell a rename from a new account", async () => {
    // A rename is a correction nobody reviews, so it needs no reason. Refusing
    // an empty reason in the browser made a renamed player justify a rename.
    mocks.requestValorantChange.mockRejectedValue(
      new Error("That is a different Riot account, so an admin has to approve it. Tell us why it needs to change."),
    );
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    await user.type(screen.getByLabelText("New Riot ID"), "Other#1234");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    expect(mocks.requestValorantChange).toHaveBeenCalledWith("Other#1234", "");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tell us why/);
  });

  it("rejects a malformed Riot ID before calling the server", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    await user.type(screen.getByLabelText("New Riot ID"), "NoSeparator");
    await user.type(screen.getByLabelText("Why is it changing?"), "lost access");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.requestValorantChange).not.toHaveBeenCalled();
  });

  it("sends a replacement request and says the current account is kept", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    await user.type(screen.getByLabelText("New Riot ID"), "Other#1234");
    await user.type(screen.getByLabelText("Why is it changing?"), "lost access to my old account");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    await waitFor(() => {
      expect(mocks.requestValorantChange).toHaveBeenCalledWith(
        "Other#1234",
        "lost access to my old account",
      );
    });
    expect(await screen.findByText(/keep your current account until then/i)).toBeTruthy();
  });

  it("tells a renamed player no review is needed", async () => {
    mocks.requestValorantChange.mockResolvedValue({
      kind: "rename",
      refreshed: true,
      account: connectedAccount({ username: "NewName" }),
    });
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    await user.type(screen.getByLabelText("New Riot ID"), "NewName#Senu");
    await user.type(screen.getByLabelText("Why is it changing?"), "renamed on Riot");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    expect(await screen.findByText(/No review needed/i)).toBeTruthy();
  });
});
