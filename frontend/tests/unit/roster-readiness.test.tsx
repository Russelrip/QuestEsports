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
  ready: true,
  ...overrides,
});

const readiness = (overrides: Partial<RosterReadiness> = {}): RosterReadiness => ({
  teamId: "team-1",
  teamName: "Example Team",
  tournamentId: "tournament-1",
  game: "valorant",
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

  it("never asks a captain to chase a missing game account", () => {
    // Connecting Riot is the player's own business and only matters for the
    // leaderboard. Listing it here sent captains after a requirement that does
    // not exist, which is what this panel got wrong.
    expect(memberBlockingReason(member({ gameAccount: null }))).toBeNull();
    expect(
      memberBlockingReason(member({ gameAccount: null, legacyRiotId: "Someone#0000" })),
    ).toBeNull();
  });

  it("names the roster-size shortfall rather than just failing", () => {
    expect(
      requirementLabel({ type: "ROSTER_SIZE", status: "FAIL", minimum: 5, maximum: 5, actual: 3 }),
    ).toBe("Roster size (3 of 5 active players needed)");
  });

  // A roster can fail this by being too big, and the old label read "6 of 5
  // needed" either way - which told a captain holding one player too many to go
  // and recruit another. Say which direction it is wrong in.
  it("tells a roster that is too big to remove someone, not to recruit", () => {
    expect(
      requirementLabel({ type: "ROSTER_SIZE", status: "FAIL", minimum: 5, maximum: 5, actual: 6 }),
    ).toBe("Roster size (6 active players, maximum 5 — remove 1)");
  });

  it("reports the substitute limit separately from the playing roster", () => {
    expect(
      requirementLabel({ type: "SUBSTITUTE_LIMIT", status: "PASS", maximum: 2, actual: 1 }),
    ).toBe("Substitutes (1 of 2 allowed)");
    expect(
      requirementLabel({ type: "SUBSTITUTE_LIMIT", status: "FAIL", maximum: 1, actual: 3 }),
    ).toBe("Substitutes (3 of 1 allowed — remove 2)");
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
          { type: "DISCORD_CONNECTED", status: "FAIL", members: ["m-1"] },
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
        discordRequired: true,
        members: [
          member({ id: "ok", name: "Ready Player", requiresDiscord: true }),
          member({
            id: "bad",
            name: "Blocking Player",
            requiresDiscord: true,
            hasDiscord: false,
            ready: false,
          }),
        ],
        requirements: [{ type: "DISCORD_CONNECTED", status: "FAIL", members: ["bad"] }],
      }),
    );
    renderPanel();

    expect(await screen.findByText("Blocking Player")).toBeTruthy();
    expect(screen.getByText("Needs to connect Discord")).toBeTruthy();
    expect(screen.getAllByText("Ready").length).toBe(1);
  });

  it("never crosses a member out for having no game account", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({ members: [member({ gameAccount: null })] }),
    );
    renderPanel();

    // A cross here is what made captains think registration was blocked on
    // something their teammates had not done.
    await waitFor(() => {
      expect(screen.queryByLabelText("Missing")).toBeNull();
    });
    expect(screen.getByText("Every roster member is ready.")).toBeTruthy();
    expect(screen.getByText(/does not hold up this registration/i)).toBeTruthy();
  });

  it("still shows a typed Riot ID for what it is", async () => {
    mocks.fetchRosterReadiness.mockResolvedValue(
      readiness({ members: [member({ gameAccount: null, legacyRiotId: "Someone#0000" })] }),
    );
    renderPanel();
    expect(await screen.findByText(/Someone#0000/)).toBeTruthy();
    expect(screen.getByText("(typed)")).toBeTruthy();
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
