const test = require("node:test");
const assert = require("node:assert/strict");

const { mapTournamentWithPublicTeams } = require("../src/modules/tournaments/tournament-mapping");

const tournament = (teamRegistrations) => ({
  id: "tournament-1",
  slug: "quest-dm",
  title: "Quest DM",
  game: "valorant",
  entryType: "solo",
  registrationFeeAmount: 0,
  registrationFeeCurrency: "LKR",
  sponsors: [],
  teamRegistrations,
  _count: { teamRegistrations: teamRegistrations.length, adminSlotReservations: 0 },
  adminSlotReservations: [],
});

const solo = (overrides = {}) => ({
  id: "registration-1",
  entryType: "solo",
  teamName: "Aqeel Sirraj",
  captainName: "Aqeel Sirraj",
  teamLogoName: null,
  savedTeam: null,
  status: "approved",
  user: { avatarImageName: null, inGameName: null },
  members: [],
  ...overrides,
});

const participant = (registration) =>
  mapTournamentWithPublicTeams(tournament([registration])).registeredParticipants[0];

test("a solo entry is listed by the player's in-game name, and the real name is not sent", () => {
  const listed = participant(solo({ user: { avatarImageName: null, inGameName: "AceShot" } }));

  assert.equal(listed.displayName, "AceShot");
  // The fallback tile is built from the in-game name, not the real initials.
  assert.notEqual(listed.shortCode, "AS");
  assert.equal(listed.captainName, null);
  assert.ok(!JSON.stringify(listed).includes("Aqeel"));
});

test("a solo entry made under an in-game name keeps it when the profile has none", () => {
  const listed = participant(solo({ teamName: "AceShot" }));

  assert.equal(listed.displayName, "AceShot");
});

test("a team entry is unchanged: its name and captain are listed as before", () => {
  const listed = participant(solo({ entryType: "team", teamName: "Quest Five", captainName: "Captain" }));

  assert.equal(listed.displayName, "Quest Five");
  assert.equal(listed.captainName, "Captain");
});
