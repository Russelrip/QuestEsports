import { describe, expect, it } from "vitest";
import { collectEventSponsors } from "@/components/tournaments/event/EventSponsorBelt";
import type { EventSeries, TournamentSponsor } from "@/lib/tournaments";

const sponsor = (id: string, name: string): TournamentSponsor => ({
  id,
  name,
  partnershipLabel: "Official Sponsor",
  logoUrl: null,
  websiteUrl: null,
  displayOrder: 0,
});

const eventWith = (...sponsorLists: TournamentSponsor[][]) =>
  ({ tournaments: sponsorLists.map((sponsors) => ({ sponsors })) }) as unknown as EventSeries;

describe("collectEventSponsors", () => {
  it("merges child tournament sponsors into one logo per brand, in first-seen order", () => {
    const event = eventWith(
      [sponsor("a1", "Dialog"), sponsor("b1", "Red Bull")],
      [sponsor("a2", " dialog "), sponsor("c1", "HyperX")],
    );
    expect(collectEventSponsors(event).map((item) => item.id)).toEqual(["a1", "b1", "c1"]);
  });

  it("puts event-wide sponsors ahead of tournament sponsors and drops their repeats", () => {
    const event = {
      ...eventWith([sponsor("t1", "HyperX"), sponsor("t2", "Red Bull")]),
      sponsors: [sponsor("e1", "Red Bull"), sponsor("e2", "Noob Alliance")],
    } as EventSeries;
    expect(collectEventSponsors(event).map((item) => item.id)).toEqual(["e1", "e2", "t1"]);
  });

  it("returns nothing when no child tournament has sponsors, so the belt stays hidden", () => {
    const event = { tournaments: [{}, { sponsors: [] }] } as unknown as EventSeries;
    expect(collectEventSponsors(event)).toEqual([]);
  });
});
