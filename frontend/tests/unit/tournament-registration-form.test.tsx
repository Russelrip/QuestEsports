import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfiguredTournamentRegistrationForm from "../../components/tournament-registration/ConfiguredTournamentRegistrationForm";
import type { Tournament } from "../../lib/tournaments";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
  markTournamentRegistered: vi.fn(),
  auth: {
    user: {
      id: "user-1",
      firstName: "Captain",
      lastName: "One",
      email: "captain@example.com",
      emailVerified: true,
      phone: "0770000000",
      discordTag: "captain-discord",
    },
    isLoading: false,
  },
  savedTeams: [] as unknown[],
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/api/useTeams", () => ({ useTeams: () => ({ data: mocks.savedTeams }) }));
vi.mock("@/lib/auth", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/registered-tournaments", () => ({ markTournamentRegistered: mocks.markTournamentRegistered }));
vi.mock("@/lib/payments", () => ({ submitPayHereCheckout: vi.fn() }));
vi.mock("@/components/auth/ResendVerificationButton", () => ({ default: () => null }));
vi.mock("@/components/payments/ReservationCountdown", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));

const conflictMessage = "This person cannot be both a coach and a player in the same tournament.";
const actionableConflictMessage = "This person cannot be both a coach and a player in the same tournament. Update the coach or player details before submitting again.";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const tournament = {
  id: "tournament-1",
  slug: "valorant-open",
  title: "Valorant Open",
  game: "Valorant",
  gameCategory: null,
  organizer: "Quest",
  country: "Sri Lanka",
  location: "Colombo",
  series: null,
  seriesOrder: 0,
  displayPriority: 0,
  bannerUrl: null,
  heroUrl: null,
  shortDescription: "",
  fullDescription: "",
  rules: null,
  rulebook: null,
  registrationOpenAt: null,
  startDate: null,
  startDateStatus: "scheduled",
  endDate: null,
  endDateStatus: "scheduled",
  registrationDeadline: null,
  registrationDeadlineStatus: "scheduled",
  format: "single_elimination",
  registrationMode: "open_entry",
  entryType: "team",
  teamSize: 2,
  minRosterSize: 2,
  maxRosterSize: 2,
  maxSubstitutes: 0,
  allowCoach: true,
  coachRequired: false,
  discordRequired: false,
  waitlistEnabled: false,
  registrationFields: [],
  paymentMethod: "bank_transfer",
  registrationFee: { amount: 0, currency: "LKR" },
  registrationFeeTiers: [],
  registrationPaymentAvailable: true,
  reservationMinutes: 15,
  bankTransferReviewMinutes: 60,
  maxTeams: 16,
  registrationCount: 0,
  capacityUsed: 0,
  prizePool: "",
  status: "registration_open",
  isPublished: true,
  bracketLink: null,
  sponsors: [],
  contactLink: null,
  isFeatured: false,
  scheduleData: null,
  bracketSummary: null,
  bracketData: null,
  showcase: { posterUrl: null, firstPlaceUrl: null, secondPlaceUrl: null, thirdPlaceUrl: null },
  eventMedia: [],
  eventAlbums: [],
  isCompleted: false,
  registrationState: "registration_open",
} as Tournament;

const savedTeam = {
  id: "team-1",
  name: "Saved Squad",
  country: "Sri Lanka",
  teamTag: "SQUAD",
  organizationName: "",
  isCaptain: true,
  registrationCount: 0,
  canDelete: true,
  captainName: "Captain One",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  members: [
    { id: "captain", role: "CAPTAIN", memberOrder: 0, name: "Captain One", email: "captain@example.com", inviteStatus: "accepted" },
    { id: "player", role: "PLAYER", memberOrder: 1, name: "Saved Player", email: "player@example.com", discord: "player-discord", riotId: "Player#001", inviteStatus: "accepted" },
    { id: "coach", role: "COACH", memberOrder: 2, name: "Saved Coach", email: "coach@example.com", phone: "0771111111", discord: "coach-discord", riotId: "Coach#001", inviteStatus: "accepted" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.savedTeams = [savedTeam];
  mocks.apiFetch.mockImplementation((path: string) => path.includes("registration-status")
    ? Promise.resolve(jsonResponse({ success: true, isRegistered: false }))
    : Promise.resolve(jsonResponse({ success: false, message: conflictMessage }, 409)));
});

afterEach(() => cleanup());

describe("ConfiguredTournamentRegistrationForm", () => {
  it("shows saved coach details separately and preserves coach/player values after a role conflict", async () => {
    const user = userEvent.setup();
    render(<ConfiguredTournamentRegistrationForm tournament={tournament} />);

    await user.selectOptions(await screen.findByLabelText("Reuse a saved team"), "team-1");

    const coachGroup = screen.getByRole("group", { name: "TEAM COACH" });
    expect(coachGroup).toBeInTheDocument();
    expect(within(coachGroup).getByDisplayValue("Saved Coach")).toBeInTheDocument();
    expect(within(coachGroup).getByDisplayValue("coach@example.com")).toBeInTheDocument();
    // A saved team hydrates who is on the roster, and stops there. The phone,
    // the Discord handle and the game id on an older saved row were typed by a
    // captain into a previous version of that form: the handle is resolved from
    // the coach's own connected account at submission, and the game id belongs
    // to whichever tournament asked for it — replaying it here would fill this
    // form in with another event's answer, for a different game, and hope
    // somebody noticed.
    expect(within(coachGroup).queryByDisplayValue("0771111111")).toBeNull();
    expect(within(coachGroup).queryByDisplayValue("coach-discord")).toBeNull();
    expect(within(coachGroup).queryByDisplayValue("Coach#001")).toBeNull();
    expect(screen.getAllByDisplayValue("Saved Coach")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Roster member 2" })).toBeInTheDocument();

    // Reusing a saved team no longer fills the game identifiers in, so the
    // fields this tournament requires are still the captain's to answer — for
    // this event, under this event's rules.
    for (const textbox of screen.getAllByRole("textbox")) {
      const input = textbox as HTMLInputElement;
      if (input.required && !input.value) await user.type(input, "Captain#001");
    }
    await user.click(screen.getByText("I have read and accept the tournament rulebook and competition rules."));
    await user.click(screen.getByText("I confirm that the registration information is accurate."));
    await user.click(screen.getByRole("button", { name: "Reserve slot and get bank details" }));

    expect(await screen.findByText(actionableConflictMessage)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Saved Coach")).toBeEnabled();
    expect(screen.getByDisplayValue("Saved Coach")).toHaveValue("Saved Coach");
    expect(screen.getByDisplayValue("Saved Player")).toBeEnabled();
    expect(screen.getByDisplayValue("Saved Player")).toHaveValue("Saved Player");
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/tournaments/valorant-open/registrations",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("uses the actionable conflict mapper when continuing an existing registration to payment", async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path.includes("registration-status")) {
        return Promise.resolve(jsonResponse({
          success: true,
          isRegistered: true,
          registration: {
            paymentStatus: "unpaid",
            verificationStatus: "verified",
            pendingInviteCount: 0,
            payment: null,
          },
        }));
      }
      return Promise.resolve(jsonResponse({ success: false, message: conflictMessage }, 409));
    });

    render(<ConfiguredTournamentRegistrationForm tournament={{
      ...tournament,
      registrationFee: { amount: 100, currency: "LKR" },
    }} />);

    await user.click(await screen.findByRole("button", { name: "Reserve slot and continue to payment" }));
    expect(await screen.findByText(actionableConflictMessage)).toBeInTheDocument();
  });
});
