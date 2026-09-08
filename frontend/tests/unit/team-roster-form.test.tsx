import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamManagementPanel from "../../components/auth/TeamManagementPanel";
import type { SavedTeam } from "../../lib/teams";

// A saved team is who is on it: role, name, email. Everything else about a
// player belongs to that player's own account, which they bring with them when
// they accept — a captain typing a teammate's Discord handle or game id was
// always a guess, and a guess that outlived the event it was collected for.

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  nudge: vi.fn(),
  toasts: [] as Record<string, unknown>[],
  clipboard: [] as string[],
}));

vi.mock("@/lib/teams", async () => {
  const actual = await vi.importActual<typeof import("../../lib/teams")>("../../lib/teams");
  return {
    ...actual,
    updateSavedTeam: (...args: unknown[]) => mocks.update(...args),
    deleteSavedTeam: vi.fn(),
    nudgeTeamInvite: (...args: unknown[]) => mocks.nudge(...args),
  };
});

vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ showToast: (toast: Record<string, unknown>) => mocks.toasts.push(toast) }),
}));

const team = (): SavedTeam => ({
  id: "team-1",
  name: "Quest Five",
  country: "Sri Lanka",
  teamTag: "Q5",
  organizationRequested: false,
  organizationName: "Independent",
  logoName: null,
  logoUrl: null,
  isCaptain: true,
  registrationCount: 0,
  canDelete: true,
  captainName: "Quest Captain",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  members: [
    {
      id: "captain-member",
      role: "CAPTAIN",
      memberOrder: 0,
      name: "Quest Captain",
      email: "captain@example.com",
      inviteStatus: "accepted",
    },
    {
      id: "pending-member",
      role: "PLAYER",
      memberOrder: 1,
      name: "Waiting Player",
      email: "player@example.com",
      // Typed into an older version of this form and still on the row.
      phone: "0770000000",
      discord: "legacy-discord",
      riotId: "Legacy#001",
      inviteStatus: "pending",
      inviteSentAt: "2026-09-01T00:00:00.000Z",
      hasQuestAccount: false,
      hasDiscord: false,
    },
  ],
});

const renderPanel = () =>
  render(
    <TeamManagementPanel
      teams={[team()]}
      selectedTeamId="team-1"
      onSelect={vi.fn()}
      onTeamUpdated={vi.fn()}
      onTeamDeleted={vi.fn()}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toasts = [];
  mocks.clipboard = [];
  mocks.update = vi.fn(async () => ({ team: team(), message: "Team updated." }));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value: string) => { mocks.clipboard.push(value); } },
  });
});

afterEach(() => cleanup());

describe("TeamManagementPanel", () => {
  it("asks for role, name and email and nothing else about a player", () => {
    renderPanel();

    expect(screen.getByDisplayValue("Waiting Player")).toBeInTheDocument();
    expect(screen.getByDisplayValue("player@example.com")).toBeInTheDocument();
    // The legacy values are still on the row and still readable elsewhere; what
    // is gone is the invitation to keep maintaining them.
    expect(screen.queryByDisplayValue("0770000000")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("legacy-discord")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Legacy#001")).not.toBeInTheDocument();
    expect(screen.queryByText("IGN / Game ID")).not.toBeInTheDocument();
  });

  it("submits only role, name and email", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Save Team Changes" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const [submitted] = mocks.update.mock.calls[0] as [{ members: Record<string, unknown>[] }];
    expect(submitted.members).toEqual([
      { role: "PLAYER", name: "Waiting Player", email: "player@example.com" },
    ]);
  });

  it("copies a link that points at one member's invitation", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Copy onboarding link" }));

    // Member-specific, and still not a credential: whoever opens it has to sign
    // in as the person the invitation was addressed to before there is anything
    // to see. What it buys is landing on the right invitation, and giving
    // somebody with no Quest account yet an explanation instead of a login form.
    await waitFor(() =>
      expect(mocks.clipboard).toEqual([
        `${window.location.origin}/team-invite?member=pending-member`,
      ]),
    );
  });

  it("tells the captain that nobody has been reached, not that an invite was sent", () => {
    renderPanel();

    expect(
      screen.getByText(
        "No Quest account yet. Nothing has reached them — copy their onboarding link and send it.",
      ),
    ).toBeInTheDocument();
  });
});
