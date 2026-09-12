import { describe, expect, it } from "vitest";
import { formatSriLankaDate, formatSriLankaDateTime } from "../../lib/date-time";
import { formatTournamentDate } from "../../lib/utils";

// These pages are server-rendered with their dates already in the HTML. The
// container runs UTC and visitors are almost all in Asia/Colombo (UTC+5:30), so
// a formatter that inherits the runtime's zone renders one day on the server and
// a different one in the browser. React sees two different strings and aborts
// hydration with error #418 - which is exactly what /valorant-leaderboard and
// /tournaments did in production.
//
// 2026-09-11T20:30:00Z is 2026-09-12 02:00 in Colombo, so it lands on a
// different calendar day in each zone. CI runs UTC: without a pinned timeZone
// these assertions fail there.
const CROSSES_MIDNIGHT_IN_COLOMBO = "2026-09-11T20:30:00Z";

describe("date formatting is timezone-stable across server and client", () => {
  it("formats the leaderboard date in Sri Lanka time, not the runtime's zone", () => {
    expect(formatSriLankaDate(CROSSES_MIDNIGHT_IN_COLOMBO)).toBe("9/12/2026");
  });

  it("formats tournament dates in Sri Lanka time, not the runtime's zone", () => {
    expect(formatTournamentDate(CROSSES_MIDNIGHT_IN_COLOMBO)).toBe("Sep 12, 2026");
  });

  // Profile, sessions, payments, ticket check-ins and the admin panels all
  // render through this one. Before they were pinned, the same instant read as
  // a different day depending on where the viewer happened to be, so a profile
  // could disagree with the tournament page it linked to.
  it("formats date-times in Sri Lanka time, not the viewer's zone", () => {
    expect(formatSriLankaDateTime(CROSSES_MIDNIGHT_IN_COLOMBO, { dateStyle: "medium" }))
      .toBe("Sep 12, 2026");
    expect(formatSriLankaDateTime(CROSSES_MIDNIGHT_IN_COLOMBO)).toContain("9/12/2026");
  });

  it("renders an em dash for a missing or unparseable leaderboard date", () => {
    expect(formatSriLankaDate(null)).toBe("—");
    expect(formatSriLankaDate("not-a-date")).toBe("—");
  });
});
