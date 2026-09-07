import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationsPanel } from "../../components/auth/InvitationsPanel";

// An invitation is answered here rather than at the end of an emailed link, and
// accepting requires a connected Discord account. The requirement used to be
// checked when the captain submitted the roster, where nobody present could
// satisfy it; the point of moving it is that the person being asked can act, so
// the refusal has to arrive with the fix attached.

const mocks = vi.hoisted(() => ({
  invitations: [] as unknown[],
  readiness: { hasQuestAccount: true, hasDiscord: true },
  respond: vi.fn(),
  toasts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/teams", () => ({
  fetchMyInvitations: async () => ({
    invitations: mocks.invitations,
    readiness: mocks.readiness,
  }),
  respondToInvitation: (...args: unknown[]) => mocks.respond(...args),
}));

vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ showToast: (toast: Record<string, unknown>) => mocks.toasts.push(toast) }),
}));

vi.mock("@/lib/account-linking", () => ({
  getProviderLinkUrl: () => "https://api.example.com/auth/discord/link",
}));

const invitation = (overrides: Record<string, unknown> = {}) => ({
  id: "invite-1",
  role: "PLAYER",
  teamId: "team-1",
  teamName: "Quest Five",
  teamTag: "Q5",
  game: "valorant",
  captain: "Quest Captain",
  tournamentTitle: "Quest Cup",
  tournamentSlug: "quest-cup",
  sentAt: "2026-09-08T10:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  mocks.invitations = [invitation()];
  mocks.readiness = { hasQuestAccount: true, hasDiscord: true };
  mocks.respond = vi.fn(async () => ({ inviteStatus: "accepted", message: "You have joined the team." }));
  mocks.toasts = [];
});

afterEach(() => cleanup());

describe("InvitationsPanel", () => {
  it("shows an invitation with who sent it and what it is for", async () => {
    render(<InvitationsPanel />);

    expect(await screen.findByText("Quest Five")).toBeInTheDocument();
    expect(screen.getByText("Quest Captain invited you for Quest Cup")).toBeInTheDocument();
  });

  it("accepting sends the decision and clears the invitation", async () => {
    render(<InvitationsPanel />);
    const accept = await screen.findByRole("button", { name: "Accept" });

    await userEvent.click(accept);

    await waitFor(() => expect(mocks.respond).toHaveBeenCalledWith("invite-1", "accept"));
    await waitFor(() =>
      expect(screen.getByText("You have no invitations waiting.")).toBeInTheDocument(),
    );
  });

  it("offers the connect flow instead of accepting when Discord is not linked", async () => {
    mocks.readiness = { hasQuestAccount: true, hasDiscord: false };
    render(<InvitationsPanel />);

    // The captain could never have fixed this for them, which is exactly why
    // the requirement is asked here.
    expect(
      await screen.findByRole("button", { name: "Connect Discord to accept" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect Discord" })).toBeInTheDocument();
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("declining never asks for Discord", async () => {
    mocks.readiness = { hasQuestAccount: true, hasDiscord: false };
    mocks.respond = vi.fn(async () => ({ inviteStatus: "declined", message: "You declined the invitation." }));
    render(<InvitationsPanel />);

    // Someone who does not want the spot should not have to connect an account
    // in order to say so.
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));

    await waitFor(() => expect(mocks.respond).toHaveBeenCalledWith("invite-1", "decline"));
  });

  it("says nothing is waiting rather than showing an empty list", async () => {
    mocks.invitations = [];
    render(<InvitationsPanel />);

    expect(await screen.findByText("You have no invitations waiting.")).toBeInTheDocument();
    // The Discord prompt is about accepting something, so with nothing to
    // accept it would only be noise.
    expect(screen.queryByRole("button", { name: "Connect Discord" })).not.toBeInTheDocument();
  });

  it("keeps the invitation when answering fails", async () => {
    mocks.respond = vi.fn(async () => {
      throw new Error("Connect your Discord account before joining a team.");
    });
    render(<InvitationsPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(mocks.toasts.some((toast) => toast.tone === "error")).toBe(true),
    );
    expect(screen.getByText("Quest Five")).toBeInTheDocument();
  });
});
