import { describe, expect, it } from "vitest";
import {
  formatEventCountdown,
  getCountdownTarget,
  getEventRegistrationSummary,
  getEventStatus,
} from "@/lib/event-utils";
import type { EventSeries } from "@/lib/tournaments";

const event = (overrides: Partial<EventSeries> = {}): EventSeries => ({
  id: "event-1",
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "A multi-game championship.",
  heroUrl: null,
  bannerUrl: null,
  displayOrder: 1,
  isPublished: true,
  eventStatus: "upcoming",
  startDate: "2026-09-01T10:00:00.000Z",
  endDate: "2026-09-02T10:00:00.000Z",
  registrationOpenAt: "2026-08-20T10:00:00.000Z",
  registrationCloseAt: null,
  aggregate: {
    games: 3,
    teamsRegistered: 12,
    playersRegistered: 48,
    availableSlots: 8,
    registrationState: "upcoming",
  },
  games: 3,
  teamsRegistered: 12,
  playersRegistered: 48,
  availableSlots: 8,
  registrationState: "upcoming",
  tournaments: [],
  ticketEvent: null,
  ...overrides,
});

describe("event utils", () => {
  it("prioritizes registration opening, then event start, and hides after start", () => {
    const upcoming = event();
    expect(getCountdownTarget(upcoming, new Date("2026-08-17T00:00:00Z"))).toEqual({
      label: "Registration opens",
      date: new Date("2026-08-20T10:00:00.000Z"),
    });
    expect(getCountdownTarget(event({ registrationOpenAt: null }), new Date("2026-08-17T00:00:00Z"))).toEqual({
      label: "Event starts",
      date: new Date("2026-09-01T10:00:00.000Z"),
    });
    expect(getCountdownTarget(event(), new Date("2026-09-01T10:00:00Z"))).toBeNull();
  });

  it("returns readable status labels and countdown text", () => {
    expect(getEventStatus(event({ isPublished: false }))).toEqual({ key: "draft", label: "Coming soon" });
    expect(getEventStatus(event({ eventStatus: "open" }))).toEqual({ key: "open", label: "Registration open" });
    expect(formatEventCountdown(new Date("2026-08-20T10:00:00Z"), new Date("2026-08-19T10:00:00Z"))).toBe("1d 0h");
  });

  it("formats aggregate counts and meaningful zero states", () => {
    expect(getEventRegistrationSummary(event())).toMatchObject({ games: "3 games", teams: "12 teams", players: "48 players", slots: "8 slots available", isOpen: false });
    expect(getEventRegistrationSummary(event({
      games: 0,
      teamsRegistered: 0,
      playersRegistered: 0,
      availableSlots: 0,
      registrationState: "closed",
      aggregate: {
        games: 0,
        teamsRegistered: 0,
        playersRegistered: 0,
        availableSlots: 0,
        registrationState: "closed",
      },
    }))).toMatchObject({ games: "No games announced", teams: "No teams registered", players: "No players registered", slots: "No slots available", isOpen: false });
    expect(getEventRegistrationSummary(event({
      registrationState: "open",
      eventStatus: "open",
      aggregate: {
        games: 3,
        teamsRegistered: 12,
        playersRegistered: 48,
        availableSlots: 8,
        registrationState: "open",
      },
    }))).toMatchObject({ isOpen: true });
  });
});
