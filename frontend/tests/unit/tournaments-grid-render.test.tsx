import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TournamentsContent from "@/components/tournaments/TournamentsContent";
import type { EventSeries, Tournament } from "@/lib/tournaments";

const tournament = (overrides: Partial<Tournament> = {}) =>
  ({
    id: "standalone-1",
    slug: "open-cup",
    title: "Open Cup",
    game: "PUBG Mobile",
    gameCategory: null,
    organizer: "Quest E-sports",
    location: "Colombo",
    bannerUrl: null,
    startDate: "2026-10-01",
    startDateStatus: "scheduled",
    registrationDeadline: "2026-09-20",
    registrationDeadlineStatus: "scheduled",
    isCompleted: false,
    registrationState: "registration_open",
    registrationMode: "open_entry",
    series: null,
    ...overrides,
  }) as Tournament;

const child = tournament({
  id: "child-1",
  slug: "ascension-valorant",
  title: "Ascension VALORANT",
  game: "Valorant",
  series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: true },
});

const event: EventSeries = {
  id: "event-1",
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "A multi-game championship.",
  heroUrl: null,
  displayOrder: 1,
  isPublished: true,
  eventStatus: "open",
  startDate: "2026-10-01",
  registrationCloseAt: "2026-09-20",
  venue: "Colombo",
  tournaments: [child],
};

const render = (props: Parameters<typeof TournamentsContent>[0]) =>
  renderToStaticMarkup(<TournamentsContent {...props} />);

describe("tournaments grid", () => {
  it("renders an event as a card pointing at the moved event route", () => {
    const html = render({ tournaments: [child], events: [event] });

    expect(html).toContain('href="/tournaments/events/quest-ascension"');
    expect(html).toContain("Quest Ascension");
  });

  it("marks an event card so it is distinguishable from a tournament in the same grid", () => {
    const html = render({ tournaments: [], events: [event] });

    expect(html).toContain("Event · 1 game");
  });

  it("does not offer a covered child its own card alongside its event", () => {
    const html = render({ tournaments: [child, tournament()], events: [event] });

    expect(html).not.toContain('href="/tournaments/ascension-valorant"');
    expect(html).toContain('href="/tournaments/open-cup"');
  });

  it("still lists a standalone tournament when no events exist", () => {
    const html = render({ tournaments: [tournament()], events: [] });

    expect(html).toContain('href="/tournaments/open-cup"');
    expect(html).not.toContain("/tournaments/events/");
  });

  it("falls back to the empty state when a game filter matches nothing", () => {
    const html = render({ tournaments: [tournament()], events: [event], initialGameFilter: "tekken" });

    expect(html).toContain("No tournaments match this game");
  });
});
