const test = require("node:test");
const assert = require("node:assert/strict");

const { mapInheritedSponsors } = require("../src/modules/tournaments/tournament-mapping");

const sponsor = (id, name, overrides = {}) => ({
  id,
  name,
  partnershipLabel: "Official Sponsor",
  logoImageName: null,
  websiteUrl: null,
  displayOrder: 100,
  ...overrides,
});

test("a child tournament lists its event's sponsors ahead of its own", () => {
  const sponsors = mapInheritedSponsors({
    series: { sponsors: [sponsor("e1", "Noob Alliance"), sponsor("e2", "Pearl Bay")] },
    sponsors: [sponsor("t1", "G-Flock")],
  });

  assert.deepEqual(sponsors.map((item) => item.id), ["e1", "e2", "t1"]);
});

test("a brand backing both the event and the tournament is listed once, as the event's", () => {
  const sponsors = mapInheritedSponsors({
    series: { sponsors: [sponsor("e1", "Kobra Energy Drink")] },
    sponsors: [sponsor("t1", " kobra energy drink "), sponsor("t2", "G-Flock")],
  });

  assert.deepEqual(sponsors.map((item) => item.id), ["e1", "t2"]);
});

test("a tournament with no event keeps only its own sponsors", () => {
  const sponsors = mapInheritedSponsors({ series: null, sponsors: [sponsor("t1", "G-Flock")] });

  assert.deepEqual(sponsors.map((item) => item.id), ["t1"]);
});

test("an inherited sponsor carries its logo, label and link, not just a name", () => {
  const [inherited] = mapInheritedSponsors({
    series: {
      sponsors: [sponsor("e1", "Pearl Bay", {
        partnershipLabel: "Gift Partner",
        logoImageName: "pearl-bay.webp",
        websiteUrl: "https://pearlbay.example",
        displayOrder: 20,
      })],
    },
    sponsors: [],
  });

  assert.deepEqual(inherited, {
    id: "e1",
    name: "Pearl Bay",
    partnershipLabel: "Gift Partner",
    logoUrl: "/api/uploads/sponsor-logos/pearl-bay.webp",
    websiteUrl: "https://pearlbay.example",
    displayOrder: 20,
  });
});

test("an unnamed sponsor row is dropped rather than rendered as a blank tile", () => {
  const sponsors = mapInheritedSponsors({
    series: { sponsors: [sponsor("e1", "   ")] },
    sponsors: [sponsor("t1", "G-Flock")],
  });

  assert.deepEqual(sponsors.map((item) => item.id), ["t1"]);
});
