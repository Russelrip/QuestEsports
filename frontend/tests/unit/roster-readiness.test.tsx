import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RosterReadinessPanel from "../../components/tournament-registration/RosterReadinessPanel";
import {
  memberBlockingReason,
  requirementLabel,
  type ReadinessMember,
  type RosterReadiness,
} from "../../lib/registration-readiness";

const mocks = vi.hoisted(() => ({ fetchRosterReadiness: vi.fn() }));

vi.mock("@/lib/registration-readiness", async () => {
  const actual = await vi.importActual<typeof import("../../lib/registration-readiness")>(
    "../../lib/registration-readiness",
  );
  return { ...actual, ...mocks };
});

const member = (overrides: Partial<ReadinessMember> = {}): ReadinessMember => ({
  id: "m-1",
  name: "Player One",
  role: "PLAYER",
  memberOrder: 1,
  inviteStatus: "accepted",
  hasQuestAccount: true,
  hasDiscord: true,
  requiresDiscord: false,
  gameAccount: {
    id: "acc-1",
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
  legacyRiotId: null,
  requiresGameAccount: true,
  ready: true,
  ...overrides,
});

const readiness = (overrides: Partial<RosterReadiness> = {}): RosterReadiness => ({
  teamId: "team-1",
  teamName: "Example Team",
  tournamentId: "tournament-1",
  requiredGame: "valorant",
  discordRequired: false,
  ready: true,
  requirements: [{ type: "INVITES_ACCEPTED", status: "PASS" }],
  members: [member()],
  ...overrides,
});

const renderPanel = () =>
  render(<RosterReadinessPanel teamId="team-1" tournamentId="tournament-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRosterReadiness.mockResolvedValue(readiness());
});
afterEach(() => cleanup());

describe("blocking reasons", () => {
  it("tells a captain what to actually chase", () => {
    expect(memberBlockingReason(member({ inviteStatus: "pending" }))).toBe(
      "Invitation not accepted yet",
    );
    expect(memberBlockingReason(member({ inviteStatus: "declined" }))).toBe(
      "Declined the invitation",
    );
    expect(
      memberBlockingReason(member({ requiresDiscord: true, hasDiscord: false })),
    ).toBe("Needs to connect Discord");
    expect(memberBlockingReason(member())).toBeNull();
  });

  it("explains why a filled-in Riot ID still is not good enough", () => {
    // A captain seeing a Riot ID from a previous event will otherwise assume
    // this is a bug in Quest rather than something they need to act on.
    const reason = memberBlockingReason(
      member({ gameAccount: null, legacyRiotId: "Someone#0000" }),
    );
    expect(reason).toMatch(/typed by hand and never verified/i);
  });

  it("names the roster-size shortfall rather than just failing", () => {
    expect(
      requirementLabel({ type: "ROSTER_SIZE", status: "FAIL", minimum: 5, actual: 3 }),
    ).toBe("Roster size (3 of 5 needed)");
  });
});

describe("the roster check panel", () => {
  it("confirms when every member is ready", async () => {
    renderPanel();
    expect(await screen.findByText("Every roster member is ready.")).toBeTruthy();
  });

  it("counts what is outstanding instead of only saying 'not ready'", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({
        ready: false,
        requirements: [
          { type: "INVITES_ACCEPTED", status: "FAIL", members: ["m-1"] },
          { type: "PLAYER_GAME_ACCOUNTS", status: "FAIL", members: ["m-1"] },
        ],
      }),
    );
    renderPanel();
    expect(await screen.findByText("2 requirements still to sort out.")).toBeTruthy();
  });

  it("shows which member is blocking and why", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({
        ready: false,
        members: [
          member({ id: "ok", name: "Ready Player" }),
          member({
            id: "bad",
            name: "Blocking Player",
            gameAccount: null,
            ready: false,
          }),
        ],
        requirements: [{ type: "PLAYER_GAME_ACCOUNTS", status: "FAIL", members: ["bad"] }],
      }),
    );
    renderPanel();

    expect(await screen.findByText("Blocking Player")).toBeTruthy();
    expect(screen.getByText("Needs to connect their game account")).toBeTruthy();
    expect(screen.getAllByText("Ready").length).toBe(1);
  });

  it("shows the connected account so a captain can sanity-check it", async () => {
    renderPanel();
    expect(await screen.findByText("Russel#1234")).toBeTruthy();
  });

  it("marks Discord as not-required rather than failed when the event allows it", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({
        discordRequired: false,
        members: [member({ hasDiscord: false, requiresDiscord: false })],
      }),
    );
    renderPanel();
    // An empty or crossed cell would read as a failure the captain cannot fix.
    await waitFor(() => {
      expect(screen.getAllByLabelText("Not required").length).toBeGreaterThan(0);
    });
  });

  it("marks Discord as missing when the event does require it", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({
        ready: false,
        discordRequired: true,
        members: [member({ hasDiscord: false, requiresDiscord: true, ready: false })],
        requirements: [{ type: "DISCORD_CONNECTED", status: "FAIL", members: ["m-1"] }],
      }),
    );
    renderPanel();
    expect(await screen.findByText("Needs to connect Discord")).toBeTruthy();
    expect(screen.getByText("• Discord connected")).toBeTruthy();
  });

  it("points the captain at where the fix actually happens", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({ ready: false, members: [member({ ready: false, gameAccount: null })] }),
    );
    renderPanel();
    expect(await screen.findByText(/on their own Quest profile/i)).toBeTruthy();
  });

  it("a failed check never reads as 'you cannot register'", async () => {
    mocks.fetchRosterReadiness.mockRejectedValue(new Error("Could not check roster readiness."));
    renderPanel();

    // The server re-checks on submit, so this panel is a convenience. Rendering
    // it as an error would wrongly imply the registration itself is blocked.
    const message = await screen.findByRole("status");
    expect(message.textContent).toMatch(/could not check/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("can be re-checked after players fix their side", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({ ready: false, members: [member({ ready: false, gameAccount: null })] }),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(/still to sort out/);

    mocks.fetchRosterReadiness.mockResolvedValue(readiness());
    await user.click(screen.getByRole("button", { name: "Re-check" }));

    expect(await screen.findByText("Every roster member is ready.")).toBeTruthy();
  });
});
