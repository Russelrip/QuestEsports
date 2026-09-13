import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRegistrationsManager from "../../components/admin/AdminRegistrationsManager";

// A registration can sit unverified behind one unanswered invitation, the coach's
// included. An admin can send it again from the registration itself instead of
// asking the captain to.

const mocks = vi.hoisted(() => ({
  adminRequest: vi.fn(),
  toasts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("../../lib/admin")>("../../lib/admin");
  return { ...actual, adminRequest: (...args: unknown[]) => mocks.adminRequest(...args) };
});

vi.mock("@/components/admin/AdminShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useToastStore", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ showToast: (toast: Record<string, unknown>) => mocks.toasts.push(toast) }),
}));

const tournament = {
  id: "tournament-1",
  slug: "quest-cup",
  title: "Quest Cup",
  game: "valorant",
  status: "registration_open",
  isPublished: true,
  paymentMethod: "free",
  waitlistEnabled: false,
  minRosterSize: 1,
  maxRosterSize: 5,
  maxSubstitutes: 1,
  allowCoach: true,
  coachRequired: false,
};

vi.mock("@/hooks/api/useAdmin", () => ({
  useAdminRegistrations: () => ({
    data: {
      registrations: [{
        id: "registration-1",
        entryType: "team",
        teamName: "Quest Five",
        status: "pending",
        paymentStatus: "paid",
        verificationStatus: "pending",
        createdAt: "2026-09-14T00:00:00.000Z",
        tournament,
        event: null,
        publicReference: "QES-TEST",
        captain: { name: "Captain", email: "captain@example.com" },
        coachName: "Coach",
        coachRiotId: null,
        memberCount: 3,
      }],
      tournaments: [tournament],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    },
    error: "",
    loading: false,
    refetch: vi.fn(async () => undefined),
  }),
  useAdminEventRegistrations: () => ({ data: null, error: "", loading: false, refetch: vi.fn() }),
}));

const member = (overrides: Record<string, unknown>) => ({
  id: "member",
  role: "PLAYER",
  order: 1,
  name: "Player",
  email: "player@example.com",
  discord: null,
  riotId: null,
  additionalData: {},
  inviteStatus: "accepted",
  inviteRespondedAt: null,
  account: null,
  ...overrides,
});

const detail = {
  id: "registration-1",
  entryType: "team",
  teamName: "Quest Five",
  additionalData: {},
  reservedUntil: null,
  country: "Sri Lanka",
  teamTag: "Q5",
  organizationRequested: false,
  status: "pending",
  paymentStatus: "paid",
  verificationStatus: "pending",
  adminSlotReservation: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  contactEmail: "captain@example.com",
  logoUrl: null,
  savedTeamLinked: true,
  tournament,
  publicReference: "QES-TEST",
  captain: { name: "Captain", email: "captain@example.com", phone: "0770000000", discord: "captain", riotId: "Cap#1" },
  coach: { id: "coach-row", name: "Coach", email: "coach@example.com", phone: "0771111111", discord: null, riotId: "Coach#1", inviteStatus: "expired", inviteRespondedAt: null },
  members: [
    member({ id: "captain-row", role: "CAPTAIN", order: 0, name: "Captain", email: "captain@example.com", inviteStatus: "accepted" }),
    member({ id: "accepted-row", name: "Accepted Player", inviteStatus: "accepted" }),
    member({ id: "pending-row", name: "Waiting Player", email: "waiting@example.com", inviteStatus: "pending" }),
  ],
};

beforeEach(() => {
  mocks.toasts = [];
  mocks.adminRequest.mockImplementation(async (_path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return { success: true, message: "Reminded in Quest and on Discord." };
    return { registration: detail };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openRegistration = async () => {
  const user = userEvent.setup();
  render(<AdminRegistrationsManager />);
  const [viewButton] = screen.getAllByRole("button", { name: "View & manage" });
  await user.click(viewButton);
  await screen.findByRole("heading", { name: /Roster · 3/ });
  return user;
};

describe("AdminRegistrationsManager invitations", () => {
  it("offers to send an unanswered invite again, for players and the coach, but not for accepted members", async () => {
    const user = await openRegistration();

    const roster = screen.getByRole("heading", { name: /Roster · 3/ }).parentElement as HTMLElement;
    const rows = within(roster);
    const sendButtons = rows.getAllByRole("button", { name: "Send invite again" });
    // Only the waiting player in the roster list; captain and accepted player have none.
    expect(sendButtons).toHaveLength(1);

    await user.click(sendButtons[0]);
    expect(mocks.adminRequest).toHaveBeenCalledWith(
      "/api/admin/team-registrations/registration-1/members/pending-row/resend-invite",
      { method: "POST" },
    );
    expect(mocks.toasts.at(-1)).toMatchObject({ tone: "success", description: "Reminded in Quest and on Discord." });
  });

  it("sends the coach's expired invite again from the coach section", async () => {
    const user = await openRegistration();

    const coachSection = screen.getByRole("heading", { name: "Coach" }).closest("div.border") as HTMLElement;
    await user.click(within(coachSection).getByRole("button", { name: "Send invite again" }));

    expect(mocks.adminRequest).toHaveBeenCalledWith(
      "/api/admin/team-registrations/registration-1/members/coach-row/resend-invite",
      { method: "POST" },
    );
  });

  it("shows why the server could not send it", async () => {
    mocks.adminRequest.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw new Error("This person has no team invitation to send again.");
      return { registration: detail };
    });
    const user = await openRegistration();

    const coachSection = screen.getByRole("heading", { name: "Coach" }).closest("div.border") as HTMLElement;
    await user.click(within(coachSection).getByRole("button", { name: "Send invite again" }));

    expect(mocks.toasts.at(-1)).toMatchObject({
      tone: "error",
      description: "This person has no team invitation to send again.",
    });
  });
});
