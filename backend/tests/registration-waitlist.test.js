const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getTournamentRegistrationState,
  getRegistrationPublicReference,
} = require("../src/modules/tournaments/registration-state");
const {
  buildActiveRegistrationWhere,
  isRegistrationActive,
} = require("../src/modules/tournaments/registration-eligibility");

const openTournament = {
  isPublished: true,
  status: "registration_open",
  registrationOpenAt: null,
  registrationDeadline: null,
  maxTeams: 4,
  waitlistEnabled: true,
};

test("registration state distinguishes open, closed, full, waitlist, and existing users", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  assert.equal(getTournamentRegistrationState({
    tournament: { ...openTournament, registrationOpenAt: new Date("2026-08-18T00:00:00.000Z") },
    capacityUsed: 0,
    now,
  }).state, "registration_closed");
  assert.equal(getTournamentRegistrationState({
    tournament: openTournament,
    capacityUsed: 4,
    now,
  }).state, "waitlist_open");
  assert.equal(getTournamentRegistrationState({
    tournament: { ...openTournament, registrationDeadline: new Date("2026-08-16T00:00:00.000Z") },
    capacityUsed: 0,
    now,
  }).state, "registration_closed");
  assert.equal(getTournamentRegistrationState({
    tournament: { ...openTournament, status: "upcoming" },
    capacityUsed: 0,
    now,
  }).state, "registration_closed");
  assert.equal(getTournamentRegistrationState({
    tournament: openTournament,
    capacityUsed: 0,
    now,
  }).state, "registration_open");
  assert.equal(getTournamentRegistrationState({
    tournament: { ...openTournament, waitlistEnabled: false },
    capacityUsed: 4,
    now,
  }).state, "slots_full");
  assert.equal(getTournamentRegistrationState({
    tournament: openTournament,
    capacityUsed: 0,
    existingRegistration: { status: "waitlisted" },
    now,
  }).state, "already_registered");
});

test("waitlisted registrations are never active and historical references are stable", () => {
  const where = buildActiveRegistrationWhere({ now: new Date("2026-08-17T12:00:00.000Z") });
  assert.deepEqual(where.status, { notIn: ["rejected", "waitlisted"] });
  assert.equal(isRegistrationActive({
    status: "waitlisted",
    paymentStatus: "paid",
  }), false);

  const first = getRegistrationPublicReference({ id: "legacy-registration" });
  assert.equal(first, getRegistrationPublicReference({ id: "legacy-registration" }));
  assert.match(first, /^QES-[A-Z0-9]{8}$/);
});
