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
  resolveValorantAccount: vi.fn(),
  linkValorantAccount: vi.fn(),
  requestValorantChange: vi.fn(),
}));

vi.mock("@/lib/game-accounts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-accounts")>(
    "../../lib/game-accounts",
  );
  return { ...actual, ...mocks };
});

const resolved = (overrides = {}) => ({
  game: "valorant" as const,
  username: "Russel",
  tagline: "1234",
  region: "ap",
  verification: "resolved" as const,
  preview: null,
  available: true,
  linkedToYou: false,
  linkedElsewhere: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyGameAccounts.mockResolvedValue({ playerPublicId: null, accounts: [] });
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

describe("linking flow", () => {
  it("does not call the API for a malformed Riot ID", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel");

    expect(await screen.findByText("Enter your Riot ID as Name#Tag.")).toBeTruthy();
    // Malformed input must never spend the shared upstream budget.
    expect(mocks.resolveValorantAccount).not.toHaveBeenCalled();
  });

  it("shows the found account and asks the user to confirm it", async () => {
    mocks.resolveValorantAccount.mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel#1234");

    expect(await screen.findByText("Russel#1234")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not my account" })).toBeTruthy();
  });

  it("tells the user plainly that confirming is not proof of ownership", async () => {
    mocks.resolveValorantAccount.mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel#1234");
    await screen.findByText("Russel#1234");

    expect(screen.getByText(/does not prove ownership to Riot/i)).toBeTruthy();
  });

  it("refuses an account already linked elsewhere without naming the holder", async () => {
    mocks.resolveValorantAccount.mockResolvedValue(
      resolved({ available: false, linkedElsewhere: true }),
    );
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel#1234");

    expect(await screen.findByText(/already linked to another Quest account/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect account" })).toBeNull();
  });

  it("surfaces an unavailable provider as a retry, not as a missing account", async () => {
    mocks.resolveValorantAccount.mockRejectedValue(
      new Error("We couldn't verify this account right now. Please try again shortly."),
    );
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel#1234");

    const message = await screen.findByRole("alert");
    expect(message.textContent).toMatch(/try again shortly/i);
    expect(message.textContent).not.toMatch(/not found|does not exist/i);
  });

  it("links the account and shows its state", async () => {
    mocks.resolveValorantAccount.mockResolvedValue(resolved());
    mocks.linkValorantAccount.mockResolvedValue({
      id: "account-1",
      game: "valorant",
      username: "Russel",
      tagline: "1234",
      region: "ap",
      verificationStatus: "user_confirmed",
      status: "active",
      linkedAt: null,
      verifiedAt: null,
      lastSyncedAt: null,
    });
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");

    await user.type(screen.getByLabelText("Riot ID"), "Russel#1234");
    await screen.findByText("Russel#1234");

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
          status: "active",
          linkedAt: null,
          verifiedAt: null,
          lastSyncedAt: null,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Connect account" }));

    await waitFor(() => {
      expect(screen.getByText("Confirmed by you")).toBeTruthy();
    });
    expect(mocks.linkValorantAccount).toHaveBeenCalledWith("Russel#1234");
  });

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

  it("requires a reason, because an admin has to read it", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.click(await screen.findByRole("button", { name: "Change account" }));
    await user.type(screen.getByLabelText("New Riot ID"), "Other#1234");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.requestValorantChange).not.toHaveBeenCalled();
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
