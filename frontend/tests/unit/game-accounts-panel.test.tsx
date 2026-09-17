import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GameAccountsPanel from "../../components/auth/GameAccountsPanel";

const mocks = vi.hoisted(() => ({
  list: { playerPublicId: "QPID-1", accounts: [] as unknown[], changeRequest: null as unknown },
  getMyValorantLeaderboardRegistration: vi.fn(),
  importValorantFromLeaderboard: vi.fn(),
  requestValorantChange: vi.fn(),
  withdrawValorantChange: vi.fn(),
  registrationResult: { success: true, message: "Registered", player: null, account: { id: "acc-1", username: "QT Russel", tagline: "Senu" } } as unknown,
}));

// The registration steps have their own tests. Here they are a stand-in that
// can finish, so the panel's side of the hand-off is what is exercised.
vi.mock("@/components/valorant/ValorantRegistration", () => ({
  default: ({ onRegistered }: { onRegistered?: (result: unknown) => void }) => (
    <div>
      <p>Registration steps</p>
      <button type="button" onClick={() => onRegistered?.(mocks.registrationResult)}>Finish registration</button>
    </div>
  ),
}));

vi.mock("@/lib/game-accounts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-accounts")>(
    "../../lib/game-accounts",
  );
  const { list, registrationResult, ...rest } = mocks;
  void list;
  void registrationResult;
  return {
    ...actual,
    ...rest,
    getMyGameAccounts: async () => mocks.list,
  };
});

const valorantAccount = (overrides = {}) => ({
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
  ...overrides,
});

const registration = (overrides = {}) => ({
  discordConnected: true,
  unavailable: false,
  registration: {
    riotId: "Russel#1234",
    linkedToYou: false,
    linkedElsewhere: false,
    unclaimedRecord: false,
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list = { playerPublicId: "QPID-1", accounts: [], changeRequest: null };
  mocks.registrationResult = {
    success: true,
    message: "Registered",
    player: null,
    account: { id: "acc-1", username: "QT Russel", tagline: "Senu" },
  };
  mocks.getMyValorantLeaderboardRegistration.mockResolvedValue({
    discordConnected: true,
    unavailable: false,
    registration: null,
  });
});

afterEach(() => cleanup());

describe("connecting an account", () => {
  // Registering for the leaderboard is how a player connects VALORANT, and it
  // happens here on the profile.

  it("shows the registration steps to a player with nothing connected", async () => {
    render(<GameAccountsPanel />);

    expect(await screen.findByText("Registration steps")).toBeInTheDocument();
    // The Riot ID form it replaced is gone.
    expect(screen.queryByLabelText("Riot ID")).not.toBeInTheDocument();
  });

  it("still shows the registration steps when the leaderboard lookup fails", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockRejectedValue(new Error("down"));
    render(<GameAccountsPanel />);

    expect(await screen.findByText("Registration steps")).toBeInTheDocument();
  });

  it("does not flash the registration steps before the leaderboard has answered", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockReturnValue(new Promise(() => undefined));
    render(<GameAccountsPanel />);

    expect(await screen.findByText("Checking the VALORANT leaderboard")).toBeInTheDocument();
    expect(screen.queryByText("Registration steps")).not.toBeInTheDocument();
  });

  it("shows the connected account once registration finishes", async () => {
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    mocks.list = { ...mocks.list, accounts: [valorantAccount()] };
    await user.click(await screen.findByRole("button", { name: "Finish registration" }));

    expect(await screen.findByText(/your account is connected/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Change account" })).toBeInTheDocument();
  });

  it("says what is left when registration could not connect the account too", async () => {
    mocks.registrationResult = { success: true, message: "Registered", player: null, account: null };
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    await user.click(await screen.findByRole("button", { name: "Finish registration" }));

    expect(await screen.findByText(/Connect the account below to finish/i)).toBeInTheDocument();
  });

  it("offers an existing leaderboard registration by name instead of registering again", async () => {
    // Registering again would stop them at "already registered".
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(registration());
    mocks.importValorantFromLeaderboard.mockResolvedValue(valorantAccount());
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    await user.click(await screen.findByRole("button", { name: "Connect Russel#1234" }));

    expect(mocks.importValorantFromLeaderboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Registration steps")).not.toBeInTheDocument();
  });

  it("explains a registration held by an unowned player record instead of offering it", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(
      registration({ linkedElsewhere: true, unclaimedRecord: true }),
    );
    render(<GameAccountsPanel />);

    expect(await screen.findByText(/older Quest player record/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect Russel#1234/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Registration steps")).not.toBeInTheDocument();
  });

  it("does not look the leaderboard up once an account is connected", async () => {
    mocks.list = { ...mocks.list, accounts: [valorantAccount()] };
    render(<GameAccountsPanel />);

    await screen.findByRole("button", { name: "Change account" });
    expect(mocks.getMyValorantLeaderboardRegistration).not.toHaveBeenCalled();
    expect(screen.queryByText("Registration steps")).not.toBeInTheDocument();
  });
});

describe("connection state", () => {
  it("says where the account stands, and tells the profile header", async () => {
    mocks.list = { ...mocks.list, accounts: [valorantAccount()] };
    const onAccountsChange = vi.fn();
    render(<GameAccountsPanel onAccountsChange={onAccountsChange} />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(onAccountsChange).toHaveBeenCalledWith(mocks.list);
  });

  it("shows what a pending change asked for and lets the player withdraw it", async () => {
    mocks.list = {
      ...mocks.list,
      accounts: [valorantAccount({ status: "change_requested" })],
      changeRequest: {
        id: "request-1",
        status: "pending",
        requestedIdentity: "NewMain#0001",
        reason: "Lost access to my old account",
        adminNote: null,
        requestedAt: "2026-09-15T00:00:00.000Z",
        reviewedAt: null,
      },
    };
    mocks.withdrawValorantChange.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    expect((await screen.findAllByText("Change pending")).length).toBeGreaterThan(0);
    expect(screen.getByText("NewMain#0001")).toBeInTheDocument();
    expect(screen.getByText("Lost access to my old account")).toBeInTheDocument();
    // A second request cannot queue behind this one, so the entry point waits.
    expect(screen.queryByRole("button", { name: "Change account" })).not.toBeInTheDocument();

    mocks.list = {
      ...mocks.list,
      accounts: [valorantAccount()],
      changeRequest: null,
    };
    await user.click(screen.getByRole("button", { name: "Withdraw request" }));

    expect(mocks.withdrawValorantChange).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Request withdrawn/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Change account" })).toBeInTheDocument();
  });

  it("shows why an admin declined a change", async () => {
    mocks.list = {
      ...mocks.list,
      accounts: [valorantAccount()],
      changeRequest: {
        id: "request-1",
        status: "rejected",
        requestedIdentity: "NewMain#0001",
        reason: "x",
        adminNote: "That account is on another roster",
        requestedAt: "2026-09-10T00:00:00.000Z",
        reviewedAt: "2026-09-12T00:00:00.000Z",
      },
    };
    render(<GameAccountsPanel />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/That account is on another roster/)).toBeInTheDocument();
  });
});
