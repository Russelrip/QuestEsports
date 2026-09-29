import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminGameAccountUnlink from "../../components/admin/AdminGameAccountUnlink";
import type { AdminGameAccount } from "../../lib/game-account-admin";

const mocks = vi.hoisted(() => ({
  searchGameAccounts: vi.fn(),
  unlinkGameAccount: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("@/lib/game-account-admin", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-account-admin")>(
    "../../lib/game-account-admin",
  );
  return { ...actual, ...mocks };
});
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));

const account = (overrides: Partial<AdminGameAccount> = {}): AdminGameAccount => ({
  id: "account-1",
  game: "valorant",
  riotId: "Sheeno#LK1",
  region: "ap",
  status: "active",
  verificationStatus: "discord_corroborated",
  linkedAt: "2026-01-05T00:00:00.000Z",
  externalIdFingerprint: "a1b2c3d4e5f6",
  player: {
    publicId: "QPID-000042",
    displayName: "Previous Holder",
    hasQuestAccount: true,
    username: "seller",
    discord: { username: "seller#0", globalName: "Seller" },
  },
  registrationSnapshots: 3,
  locked: false,
  ...overrides,
});

const search = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/Riot ID, player ID, or name/i), "Sheeno#LK1");
  await user.click(screen.getByRole("button", { name: "Search" }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({
    user: { role: "admin", isSuperAdmin: true, permissions: [] },
  });
  mocks.searchGameAccounts.mockResolvedValue([account()]);
  mocks.unlinkGameAccount.mockResolvedValue({
    released: {
      riotId: "Sheeno#LK1",
      externalIdFingerprint: "a1b2c3d4e5f6",
      previousHolder: account().player,
      registrationSnapshots: 3,
      wasLocked: false,
    },
    changeRequestsClosed: 0,
    rankingsCleared: 1,
    leaderboard: { state: "removed", removalId: "removal-1" },
  });
});
afterEach(() => cleanup());

describe("admin game account unlink", () => {
  it("names the holder, which is the answer the player was told to ask for", async () => {
    const user = userEvent.setup();
    render(<AdminGameAccountUnlink />);
    await search(user);

    expect(await screen.findByText("Sheeno#LK1")).toBeTruthy();
    expect(screen.getByText(/Previous Holder/)).toBeTruthy();
    expect(screen.getByText(/seller#0/)).toBeTruthy();
    // The blast radius is on screen before the decision, not after it.
    expect(screen.getByText(/3 rosters/)).toBeTruthy();
  });

  it("refuses to submit without a reason, without calling the server", async () => {
    const user = userEvent.setup();
    render(<AdminGameAccountUnlink />);
    await search(user);

    await user.click(await screen.findByRole("button", { name: "Unlink this account" }));
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.unlinkGameAccount).not.toHaveBeenCalled();
  });

  it("sends the identity it displayed, so a stale row is refused server-side", async () => {
    const user = userEvent.setup();
    render(<AdminGameAccountUnlink />);
    await search(user);

    await user.click(await screen.findByRole("button", { name: "Unlink this account" }));
    await user.type(screen.getByLabelText(/Why is this being unlinked/i), "Sold on; seller confirmed.");
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    await waitFor(() =>
      expect(mocks.unlinkGameAccount).toHaveBeenCalledWith({
        accountId: "account-1",
        reason: "Sold on; seller confirmed.",
        expectedRiotId: "Sheeno#LK1",
        allowLocked: false,
        releaseLeaderboard: true,
      }),
    );
  });

  it("makes a locked account a separate, deliberate confirmation", async () => {
    const user = userEvent.setup();
    mocks.searchGameAccounts.mockResolvedValue([account({ status: "locked", locked: true })]);
    render(<AdminGameAccountUnlink />);
    await search(user);

    await user.click(await screen.findByRole("button", { name: "Unlink this account" }));
    await user.type(screen.getByLabelText(/Why is this being unlinked/i), "Stolen account reported.");
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.unlinkGameAccount).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: /locked to an approved tournament roster/i }));
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    await waitFor(() =>
      expect(mocks.unlinkGameAccount).toHaveBeenCalledWith(
        expect.objectContaining({ allowLocked: true }),
      ),
    );
  });

  it("never offers the leaderboard removal to someone who cannot do it", async () => {
    const user = userEvent.setup();
    mocks.useAuth.mockReturnValue({
      user: { role: "user", isSuperAdmin: false, permissions: ["game_accounts"] },
    });
    render(<AdminGameAccountUnlink />);
    await search(user);

    await user.click(await screen.findByRole("button", { name: "Unlink this account" }));
    expect(screen.queryByRole("checkbox", { name: /leaderboard registration/i })).toBeNull();
    // Saying nothing would leave the board quietly naming the old holder.
    expect(screen.getByText(/needs the VALORANT leaderboard area/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Why is this being unlinked/i), "Sold on; seller confirmed.");
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    await waitFor(() =>
      expect(mocks.unlinkGameAccount).toHaveBeenCalledWith(
        expect.objectContaining({ releaseLeaderboard: false }),
      ),
    );
  });

  it("reports what else moved, including a leaderboard removal that failed", async () => {
    const user = userEvent.setup();
    mocks.unlinkGameAccount.mockResolvedValue({
      released: {
        riotId: "Sheeno#LK1",
        externalIdFingerprint: "a1b2c3d4e5f6",
        previousHolder: account().player,
        registrationSnapshots: 3,
        wasLocked: false,
      },
      changeRequestsClosed: 1,
      rankingsCleared: 1,
      leaderboard: { state: "failed", reason: "UPSTREAM_UNAVAILABLE" },
    });
    render(<AdminGameAccountUnlink />);
    await search(user);

    await user.click(await screen.findByRole("button", { name: "Unlink this account" }));
    await user.type(screen.getByLabelText(/Why is this being unlinked/i), "Sold on; seller confirmed.");
    await user.click(screen.getByRole("button", { name: /Unlink Sheeno#LK1/ }));

    expect(await screen.findByText(/is released/i)).toBeTruthy();
    expect(screen.getByText(/1 pending change request was closed/i)).toBeTruthy();
    // A silent failure here leaves the board naming the wrong person.
    expect(screen.getByText(/could NOT be removed/i)).toBeTruthy();
  });
});
