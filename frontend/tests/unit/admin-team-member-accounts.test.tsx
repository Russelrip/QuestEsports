import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminTeamsManager from "../../components/admin/AdminTeamsManager";

// Discord and game ids arrive when a member connects them; new roster rows are
// written without them. The admin roster read only the row, so a team whose
// members had connected everything showed blank Phone, Game ID and Discord.

const mocks = vi.hoisted(() => ({
  adminRequest: vi.fn(),
}));

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("../../lib/admin")>("../../lib/admin");
  return { ...actual, adminRequest: (...args: unknown[]) => mocks.adminRequest(...args) };
});

vi.mock("@/components/admin/AdminShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ showToast: vi.fn() }),
}));

const summary = {
  id: "team-1",
  name: "Quest Two",
  teamTag: "Q2",
  logoUrl: null,
  country: "Sri Lanka",
  organizationName: "Independent",
  captainName: "Team Captain",
  memberCount: 3,
  updatedAt: "2026-09-14T00:00:00.000Z",
};

const detail = {
  ...summary,
  members: [
    {
      id: "m-captain", role: "CAPTAIN", name: "Team Captain", email: "captain@example.com",
      phone: null, discord: null, legacyGameId: null, gameId: null, gameAccountConnected: false, inviteStatus: "accepted",
      account: { phone: "0771111111", discord: "captain.discord", discordConnected: true },
    },
    {
      id: "m-player", role: "PLAYER", name: "Connected Player", email: "player@example.com",
      phone: null, discord: null, legacyGameId: "OldTyped#000", gameId: "Clutch#SL1", gameAccountConnected: true, inviteStatus: "accepted",
      account: { phone: "0772222222", discord: null, discordConnected: false },
    },
    {
      id: "m-legacy", role: "SUBSTITUTE", name: "Legacy Sub", email: "legacy@example.com",
      phone: "0773333333", discord: "typed.handle", legacyGameId: "Typed#123", gameId: "Typed#123", gameAccountConnected: false, inviteStatus: "pending",
      account: null,
    },
  ],
};

beforeEach(() => {
  mocks.adminRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "PATCH") return { team: detail };
    if (path.startsWith("/api/admin/teams?")) {
      return { teams: [summary], pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 } };
    }
    return { team: detail };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openTeam = async () => {
  const user = userEvent.setup();
  render(<AdminTeamsManager />);
  const [viewButton] = await screen.findAllByRole("button", { name: "View & edit" });
  await user.click(viewButton);
  await screen.findByDisplayValue("Connected Player");
  return user;
};

const memberCard = (name: string) =>
  screen.getByDisplayValue(name).closest("div.border") as HTMLElement;

describe("AdminTeamsManager roster", () => {
  it("shows each member's connected Discord, Riot ID and account phone", async () => {
    await openTeam();

    const captain = within(memberCard("Team Captain"));
    expect(captain.getByText("captain.discord")).toBeInTheDocument();
    expect(captain.getByText("Connected Discord")).toBeInTheDocument();
    expect(captain.getByText("0771111111")).toBeInTheDocument();

    const player = within(memberCard("Connected Player"));
    expect(player.getByText("Clutch#SL1")).toBeInTheDocument();
    expect(player.getByText("Connected Riot account")).toBeInTheDocument();
    expect(player.getByText("0772222222")).toBeInTheDocument();
    expect(player.getByText("Their account has not connected Discord")).toBeInTheDocument();
  });

  it("keeps typed values editable only where no account value exists, and labels an unverified Discord", async () => {
    await openTeam();

    const legacy = within(memberCard("Legacy Sub"));
    expect(legacy.getByDisplayValue("0773333333")).toBeInTheDocument();
    expect(legacy.getByDisplayValue("Typed#123")).toBeInTheDocument();
    expect(legacy.getByText("typed.handle")).toBeInTheDocument();
    expect(legacy.getByText("Typed on an older roster, not verified")).toBeInTheDocument();
    // Discord is never an input: a handle only counts when it came from a link.
    expect(legacy.queryByDisplayValue("typed.handle")).toBeNull();
  });

  it("saves only what the roster row carries, never the account's values", async () => {
    const user = await openTeam();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const patch = mocks.adminRequest.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch).toBeTruthy();
    const members = JSON.parse((patch![1].body as FormData).get("members") as string);
    expect(members.find((member: { id: string }) => member.id === "m-player")).toEqual({
      id: "m-player", role: "PLAYER", name: "Connected Player", email: "player@example.com",
      phone: "", discord: "", riotId: "OldTyped#000", gameId: "OldTyped#000",
    });
    expect(members.find((member: { id: string }) => member.id === "m-captain")).toMatchObject({ phone: "", discord: "" });
  });
});
