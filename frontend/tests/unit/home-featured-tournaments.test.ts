import { describe, expect, it } from "vitest";
import { getFeaturedTournaments, type Tournament } from "@/lib/tournaments";

const publishedEvent = { id: "event-1", slug: "quest-ascension", title: "Quest Ascension", isPublished: true };

const tournament = (id: string, overrides: Partial<Tournament> = {}) =>
  ({
    id,
    slug: id,
    title: id,
    series: null,
    isFeatured: false,
    status: "registration_open",
    startDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as Tournament;

const ids = (tournaments: Tournament[]) => tournaments.map((item) => item.id);

describe("home featured tournaments", () => {
  it("puts an open tournament above a featured one that has finished", () => {
    const picked = getFeaturedTournaments([
      tournament("past-pick", { isFeatured: true, status: "completed", startDate: "2026-09-19T03:30:00.000Z" }),
      tournament("open", { startDate: "2026-10-16T14:30:00.000Z" }),
    ]);
    expect(ids(picked)).toEqual(["open", "past-pick"]);
  });

  it("features an open event child when no standalone tournament is open", () => {
    const picked = getFeaturedTournaments([
      tournament("past", { status: "completed", startDate: "2026-09-19T03:30:00.000Z" }),
      tournament("event-child", { series: publishedEvent, startDate: "2026-10-16T14:30:00.000Z" }),
    ]);
    expect(ids(picked)).toEqual(["event-child", "past"]);
  });

  it("ranks standalone open tournaments before event children", () => {
    const picked = getFeaturedTournaments([
      tournament("event-child", { series: publishedEvent, startDate: "2026-10-16T14:30:00.000Z" }),
      tournament("standalone", { startDate: "2026-12-01T14:30:00.000Z" }),
    ]);
    expect(ids(picked)).toEqual(["standalone", "event-child"]);
  });

  it("orders open tournaments by admin pick, then soonest start, with unscheduled dates last", () => {
    const picked = getFeaturedTournaments([
      tournament("tba"),
      tournament("later", { startDate: "2026-11-14T06:50:00.000Z" }),
      tournament("sooner", { startDate: "2026-10-16T14:30:00.000Z" }),
      tournament("pick", { isFeatured: true, startDate: "2026-12-01T00:00:00.000Z" }),
    ], 4);
    expect(ids(picked)).toEqual(["pick", "sooner", "later", "tba"]);
  });

  it("fills with finished tournaments newest first, skipping cancelled and event-covered ones", () => {
    const picked = getFeaturedTournaments([
      tournament("older", { status: "completed", startDate: "2026-02-14T04:30:00.000Z" }),
      tournament("cancelled", { status: "cancelled", startDate: "2026-10-01T00:00:00.000Z" }),
      tournament("covered", { status: "completed", series: publishedEvent, startDate: "2026-10-02T00:00:00.000Z" }),
      tournament("newer", { status: "completed", startDate: "2026-09-19T03:30:00.000Z" }),
    ]);
    expect(ids(picked)).toEqual(["newer", "older"]);
  });
});
