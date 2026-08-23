import { describe, expect, it } from "vitest";
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
