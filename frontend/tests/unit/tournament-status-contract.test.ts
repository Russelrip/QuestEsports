import { describe, expect, it } from "vitest";
import {
  getRegistrationButtonLabel,
  getTournamentRegistrationLabel,
  getTournamentRegistrationPresentation,
} from "@/lib/tournaments";
import type { EventSeries, Tournament } from "@/lib/tournaments";
import { getEventCardPresentation, getEventStatus } from "@/lib/event-utils";

const tournament = (overrides: Partial<Tournament> = {}): Tournament => ({
  id: "tournament-1",
  slug: "valorant-open",
  title: "Valorant Open",
  game: "VALORANT",
  gameCategory: null,
  organizer: "Quest",
  country: "Sri Lanka",
  location: "Colombo",
  series: null,
  seriesOrder: 1,
  displayPriority: 1,
  bannerUrl: null,
  heroUrl: null,
  shortDescription: "Open",
  fullDescription: "Open",
  rules: null,
  rulebook: null,
  registrationOpenAt: null,
  startDate: null,
  startDateStatus: "tbd",
  endDate: null,
  endDateStatus: "tbd",
  registrationDeadline: null,
  registrationDeadlineStatus: "tbd",
  format: "Single elimination",
  registrationMode: "open_entry",
  entryType: "team",
  teamSize: 5,
  minRosterSize: 5,
  maxRosterSize: 5,
  maxSubstitutes: 0,
  allowCoach: false,
  coachRequired: false,
  waitlistEnabled: true,
  registrationFields: [],
  paymentMethod: "free",
  registrationFee: { amount: 0, currency: "LKR" },
  registrationFeeTiers: [],
  registrationPaymentAvailable: true,
  reservationMinutes: 15,
  bankTransferReviewMinutes: 60,
  maxTeams: 16,
  registrationCount: 16,
  capacityUsed: 16,
  prizePool: "TBA",
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
  registrationState: "registration_closed",
  ...overrides,
});

const event = (overrides: Partial<EventSeries> = {}): EventSeries => ({
  id: "event-1",
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "A multi-game event.",
  heroUrl: null,
  displayOrder: 1,
  isPublished: true,
  eventStatus: "closed",
  registrationState: "closed",
  aggregate: {
    games: 1,
    teamsRegistered: 1,
    playersRegistered: 5,
    availableSlots: 0,
    registrationState: "closed",
  },
  tournaments: [tournament({ registrationState: "registration_open" })],
  ...overrides,
});

describe("tournament status contract", () => {
  it("does not render closed and waitlist-open for one child payload", () => {
    const presentation = getTournamentRegistrationPresentation(tournament());

    expect(presentation).toMatchObject({
      state: "registration_closed",
      label: "Registration Closed",
      isActionable: false,
      isWaitlist: false,
    });
  });

  it("labels already-registered children without making them actionable", () => {
    const child = tournament({ registrationState: "already_registered" });

    expect(getTournamentRegistrationLabel(child)).toBe("Already Registered");
    expect(getTournamentRegistrationPresentation(child)).toMatchObject({
      state: "already_registered",
      isActionable: false,
      isWaitlist: false,
    });
  });

  it("routes a waitlist-open child to registration and keeps it actionable", () => {
    const presentation = getTournamentRegistrationPresentation(tournament({
      registrationState: "waitlist_open",
      registrationLabel: "Join waitlist",
    }));

    expect(presentation).toMatchObject({
      state: "waitlist_open",
      label: "Join waitlist",
      isActionable: true,
      isWaitlist: true,
      registrationHref: "/tournaments/valorant-open/register",
    });
  });

  it("keeps event aggregate status distinct from child registration status", () => {
    const currentEvent = event();
    const child = currentEvent.tournaments[0];

    expect(getEventStatus(currentEvent)).toEqual({ key: "closed", label: "Registration closed" });
    expect(getTournamentRegistrationPresentation(child)).toMatchObject({
      state: "registration_open",
      isActionable: true,
    });
  });

  it("keeps event-card labels aggregate-scoped when a child is open", () => {
    const currentEvent = event();
    const presentation = getEventCardPresentation(currentEvent);

    expect(currentEvent.registrationState).toBe("closed");
    expect(currentEvent.aggregate?.registrationState).toBe("closed");
    expect(presentation.eventStatus).toEqual({ key: "closed", label: "Registration closed" });
    expect(presentation.childRegistration).toMatchObject({
      state: "registration_open",
      isActionable: true,
    });
  });

  it("keeps personal Checking state out of tournament state", () => {
    const child = tournament({ registrationState: "registration_closed" });

    expect(getRegistrationButtonLabel(child, "loading")).toBe("Checking...");
    expect(getRegistrationButtonLabel(child, "registered")).toBe("Registered");
    expect(child.registrationState).toBe("registration_closed");
  });
});
