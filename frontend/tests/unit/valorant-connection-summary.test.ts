import { describe, expect, it } from "vitest";
import { summarizeValorantConnection, type GameAccount } from "../../lib/game-accounts";

const account = (overrides: Partial<GameAccount> = {}): GameAccount => ({
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
  ...overrides,
});

const request = (status: "pending" | "approved" | "rejected" | "withdrawn") => ({
  id: "request-1",
  status,
  requestedIdentity: "NewMain#0001",
  reason: "lost access",
  adminNote: null,
  requestedAt: "2026-09-10T00:00:00.000Z",
  reviewedAt: status === "pending" ? null : "2026-09-12T00:00:00.000Z",
});

describe("summarizeValorantConnection", () => {
  it("is not connected with nothing linked, or nothing loaded", () => {
    expect(summarizeValorantConnection({ accounts: [] }).state).toBe("not_connected");
    expect(summarizeValorantConnection(null).state).toBe("not_connected");
  });

  it("is connected, saying what was established rather than 'verified'", () => {
    const summary = summarizeValorantConnection({ accounts: [account()] });
    expect(summary.state).toBe("connected");
    expect(summary.riotId).toBe("Russel#1234");
    expect(summary.detail).toContain("Confirmed by you");
  });

  it("still counts a tournament-locked account as connected", () => {
    const summary = summarizeValorantConnection({ accounts: [account({ status: "locked" })] });
    expect(summary.state).toBe("connected");
    expect(summary.detail).toMatch(/locked by a tournament/i);
  });

  it("is pending while a change waits, and names both accounts", () => {
    const summary = summarizeValorantConnection({
      accounts: [account({ status: "change_requested" })],
      changeRequest: request("pending"),
    });
    expect(summary.state).toBe("pending");
    expect(summary.detail).toContain("NewMain#0001");
    // The current account still counts until an admin decides.
    expect(summary.detail).toContain("Russel#1234 stays connected");
  });

  it("needs attention after a declined change, an unconfirmed import, or a revocation", () => {
    expect(
      summarizeValorantConnection({ accounts: [account()], changeRequest: request("rejected") }).state,
    ).toBe("attention");
    expect(
      summarizeValorantConnection({ accounts: [account({ verificationStatus: "legacy_unverified" })] }).state,
    ).toBe("attention");
    expect(summarizeValorantConnection({ accounts: [account({ status: "revoked" })] }).state).toBe(
      "attention",
    );
  });

  it("is simply connected after an approved or withdrawn change", () => {
    expect(
      summarizeValorantConnection({ accounts: [account()], changeRequest: request("approved") }).state,
    ).toBe("connected");
    expect(
      summarizeValorantConnection({ accounts: [account()], changeRequest: request("withdrawn") }).state,
    ).toBe("connected");
  });
});
