import { describe, expect, it } from "vitest";
import { composeTournamentListing } from "@/lib/tournament-listing";
import {
  getFeaturedEvents,
  isCoveredByEventCard,
  type EventSeries,
  type Tournament,
} from "@/lib/tournaments";

const tournament = (overrides: Partial<Tournament> = {}) =>
  ({ id: "tournament-1", slug: "quest-ascension-valorant", title: "Quest Ascension Valorant", series: null, ...overrides }) as Tournament;

const event = (overrides: Partial<EventSeries> = {}): EventSeries => ({
  id: "event-1",
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "A multi-game championship.",
  heroUrl: null,
  displayOrder: 1,
  isPublished: true,
  tournaments: [tournament()],
  ...overrides,
});

describe("event card coverage", () => {
  it("hides a child whose published event already advertises it", () => {
    expect(isCoveredByEventCard(tournament({ series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: true } }))).toBe(true);
  });

  it("keeps a published child listed when its event is still a draft", () => {
    expect(isCoveredByEventCard(tournament({ series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: false } }))).toBe(false);
  });

  it("keeps a standalone tournament listed", () => {
    expect(isCoveredByEventCard(tournament())).toBe(false);
  });

  it("treats a series without the flag as uncovered so nothing disappears", () => {
    expect(isCoveredByEventCard(tournament({ series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension" } }))).toBe(false);
  });
});

describe("featured events", () => {
  it("prefers explicitly featured events", () => {
    const picked = getFeaturedEvents([
      event({ id: "a" }),
      event({ id: "b", featured: true }),
    ]);
    expect(picked.map((item) => item.id)).toEqual(["b"]);
  });

  it("falls back to backend order when nothing is featured", () => {
    const picked = getFeaturedEvents([event({ id: "a" }), event({ id: "b" })], 1);
    expect(picked.map((item) => item.id)).toEqual(["a"]);
  });

  it("skips an event with no published child, which would render an empty card", () => {
    expect(getFeaturedEvents([event({ id: "a", tournaments: [] }), event({ id: "b" })]).map((item) => item.id)).toEqual(["b"]);
  });

  it("honours the limit", () => {
    expect(getFeaturedEvents([event({ id: "a" }), event({ id: "b" }), event({ id: "c" }), event({ id: "d" })])).toHaveLength(3);
  });
});

describe("tournaments grid composition", () => {
  const child = (overrides: Partial<Tournament> = {}) =>
    tournament({
      id: "child-1",
      slug: "ascension-valorant",
      game: "Valorant",
      gameCategory: null,
      isCompleted: false,
      series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: true },
      ...overrides,
    });

  const standalone = (overrides: Partial<Tournament> = {}) =>
    tournament({ id: "standalone-1", slug: "open-cup", game: "PUBG Mobile", gameCategory: null, isCompleted: false, series: null, ...overrides });

  it("leads with events and drops the children their card already advertises", () => {
    const listing = composeTournamentListing({
      tournaments: [child(), standalone()],
      events: [event({ tournaments: [child()] })],
      gameFilter: "all",
    });

    expect(listing.events.map((item) => item.id)).toEqual(["event-1"]);
    expect(listing.tournaments.map((item) => item.id)).toEqual(["standalone-1"]);
  });

  it("keeps a child listed on its own when its event is still a draft", () => {
    const draftChild = child({ series: { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: false } });
    const listing = composeTournamentListing({
      tournaments: [draftChild],
      events: [event({ isPublished: false, tournaments: [draftChild] })],
      gameFilter: "all",
    });

    expect(listing.events).toEqual([]);
    expect(listing.tournaments.map((item) => item.id)).toEqual(["child-1"]);
  });

  it("keeps an event under a game filter that only one of its children plays", () => {
    const listing = composeTournamentListing({
      tournaments: [child(), standalone()],
      events: [event({ tournaments: [child()] })],
      gameFilter: "valorant",
    });

    expect(listing.events.map((item) => item.id)).toEqual(["event-1"]);
    expect(listing.tournaments).toEqual([]);
  });

  it("drops an event whose games are all filtered out", () => {
    const listing = composeTournamentListing({
      tournaments: [standalone()],
      events: [event({ tournaments: [child()] })],
      gameFilter: "pubg-mobile",
    });

    expect(listing.events).toEqual([]);
    expect(listing.tournaments.map((item) => item.id)).toEqual(["standalone-1"]);
  });

  it("sinks finished entries below live ones within each group", () => {
    const listing = composeTournamentListing({
      tournaments: [
        standalone({ id: "old", slug: "old", isCompleted: true, endDate: "2026-01-01" }),
        standalone({ id: "live", slug: "live" }),
        standalone({ id: "recent", slug: "recent", isCompleted: true, endDate: "2026-06-01" }),
      ],
      events: [
        event({ id: "done", slug: "done", eventStatus: "completed" }),
        event({ id: "running", slug: "running", eventStatus: "open" }),
      ],
      gameFilter: "all",
    });

    expect(listing.events.map((item) => item.id)).toEqual(["running", "done"]);
    expect(listing.tournaments.map((item) => item.id)).toEqual(["live", "recent", "old"]);
  });

  it("skips a published event with no children, which would render an empty card", () => {
    const listing = composeTournamentListing({ tournaments: [], events: [event({ tournaments: [] })], gameFilter: "all" });

    expect(listing.events).toEqual([]);
    expect(listing.isEmpty).toBe(true);
  });
});
