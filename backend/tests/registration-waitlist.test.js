const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("parent event registration windows gate an open child override", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const child = {
    ...openTournament,
    registrationStatusOverride: "open",
    series: {
      registrationOpenAt: new Date("2026-08-18T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-08-19T00:00:00.000Z"),
    },
  };

  assert.equal(getTournamentRegistrationState({ tournament: child, now }).state, "registration_closed");
  assert.equal(getTournamentRegistrationState({
    tournament: {
      ...child,
      series: {
        registrationOpenAt: new Date("2026-08-16T00:00:00.000Z"),
        registrationCloseAt: new Date("2026-08-18T00:00:00.000Z"),
      },
    },
    now,
  }).state, "registration_open");
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

test("waitlist positions have additive nullable uniqueness and legacy normalization", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "../prisma/schema.prisma"),
    "utf8"
  );
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "../prisma/migrations/20260817130000_add_waitlist_position_uniqueness/migration.sql"
    ),
    "utf8"
  );
  const additiveMigration = fs.readFileSync(
    path.join(
      __dirname,
      "../prisma/migrations/20260817120000_extend_event_series_quest_ascension/migration.sql"
    ),
    "utf8"
  );
  assert.match(schema, /@@unique\(\[tournamentId, waitlistPosition\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(additiveMigration, /status.*<> 'waitlisted'/s);
});
