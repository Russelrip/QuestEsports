import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GameAccountsPanel from "../../components/auth/GameAccountsPanel";

const mocks = vi.hoisted(() => ({
  list: { playerPublicId: "QPID-1", accounts: [] as unknown[], changeRequest: null as unknown },
  getMyValorantLeaderboardRegistration: vi.fn(),
  importValorantFromLeaderboard: vi.fn(),
  linkValorantAccount: vi.fn(),
  resolveValorantAccount: vi.fn(),
  requestValorantChange: vi.fn(),
  withdrawValorantChange: vi.fn(),
}));

vi.mock("@/lib/game-accounts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-accounts")>(
    "../../lib/game-accounts",
  );
  const { list, ...rest } = mocks;
  void list;
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
  leaderboard: null,
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
  mocks.getMyValorantLeaderboardRegistration.mockResolvedValue({
    discordConnected: true,
    unavailable: false,
    registration: null,
  });
});

afterEach(() => cleanup());

describe("connecting from the leaderboard", () => {
  // The import used to be a blind "Import from leaderboard" button. A player
  // could not tell which account it would connect until it had.

  it("names the leaderboard account before offering to connect it", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(registration());
    mocks.importValorantFromLeaderboard.mockResolvedValue(valorantAccount());
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    const connect = await screen.findByRole("button", { name: "Connect Russel#1234" });
    await user.click(connect);

    expect(mocks.importValorantFromLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when the leaderboard has no registration", async () => {
    render(<GameAccountsPanel />);
    await screen.findByLabelText("Riot ID");
    await waitFor(() => expect(mocks.getMyValorantLeaderboardRegistration).toHaveBeenCalled());

    expect(screen.queryByText(/Found on the VALORANT leaderboard/i)).not.toBeInTheDocument();
    expect(screen.getByText("Connect with your Riot ID")).toBeInTheDocument();
  });

  it("lets the player pick a different account instead", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(registration());
    const user = userEvent.setup();
    render(<GameAccountsPanel />);

    await user.click(await screen.findByRole("button", { name: "Use a different account" }));

    expect(screen.queryByRole("button", { name: /Connect Russel#1234/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Riot ID")).toBeInTheDocument();
  });

  it("explains a registration held by an unowned player record instead of offering it", async () => {
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(
      registration({ linkedElsewhere: true, unclaimedRecord: true }),
    );
    render(<GameAccountsPanel />);

    expect(await screen.findByText(/older Quest player record/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect Russel#1234/ })).not.toBeInTheDocument();
  });

  it("does not look the leaderboard up once an account is connected", async () => {
    mocks.list = { ...mocks.list, accounts: [valorantAccount()] };
    render(<GameAccountsPanel />);

    await screen.findByRole("button", { name: "Change account" });
    expect(mocks.getMyValorantLeaderboardRegistration).not.toHaveBeenCalled();
  });

  it("does not flash an offer before the accounts have loaded", () => {
    mocks.getMyValorantLeaderboardRegistration.mockResolvedValue(registration());
    mocks.list = { ...mocks.list, accounts: [valorantAccount()] };
    render(<GameAccountsPanel />);

    // Appearing and then vanishing under the cursor is worse than never
    // appearing: it invites a click on something about to become wrong.
    expect(screen.queryByRole("button", { name: /Connect Russel#1234/ })).not.toBeInTheDocument();
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

describe("confirming a looked-up account", () => {
  const lookUp = async (overrides = {}, typed = "Russel#1234") => {
    mocks.resolveValorantAccount.mockResolvedValue(resolved(overrides));
    const user = userEvent.setup();
    render(<GameAccountsPanel />);
    await user.type(await screen.findByLabelText("Riot ID"), typed);
    await screen.findByText("VALORANT account found");
    return user;
  };

  it("warns when the account is not the one registered on the leaderboard", async () => {
    await lookUp({ leaderboard: { matches: false, riotId: "MyMain#0001" } });

    expect(screen.getByText(/not the account your Discord is registered with/i)).toBeInTheDocument();
    expect(screen.getByText(/MyMain#0001/)).toBeInTheDocument();
  });

  it("stays quiet when there is nothing to compare with", async () => {
    await lookUp({ leaderboard: null });
    expect(screen.queryByText(/not the account your Discord is registered with/i)).not.toBeInTheDocument();
  });

  it("explains an account on an unowned player record without offering to connect it", async () => {
    await lookUp({ available: false, linkedElsewhere: true, unclaimedRecord: true });

    expect(screen.getByText(/older Quest player record/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect account" })).not.toBeInTheDocument();
  });

  it("does not call a previously used account 'already connected'", async () => {
    await lookUp({ available: false, linkedToYou: true, status: "replaced" });

    expect(screen.getByText(/You used this account before/i)).toBeInTheDocument();
    expect(screen.queryByText(/already connected to your profile/i)).not.toBeInTheDocument();
  });

  it("connects the account shown on the card, not the text as typed", async () => {
    mocks.linkValorantAccount.mockResolvedValue(valorantAccount({ username: "Russel", tagline: "1234" }));
    const user = await lookUp({}, "russel#1234");

    await user.click(screen.getByRole("button", { name: "Connect account" }));

    expect(mocks.linkValorantAccount).toHaveBeenCalledWith("Russel#1234");
  });
});
