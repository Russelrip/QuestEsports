const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { Prisma } = require("../src/generated/prisma");

const models = Prisma.dmmf.datamodel.models;
const model = (name) => {
  const result = models.find((candidate) => candidate.name === name);
  assert.ok(result, `expected generated Prisma model ${name}`);
  return result;
};
const field = (modelName, fieldName) => {
  const result = model(modelName).fields.find((candidate) => candidate.name === fieldName);
  assert.ok(result, `expected ${modelName}.${fieldName}`);
  return result;
};

test("event schema exposes the additive EventSeries publication fields", () => {
  for (const name of [
    "shortName",
    "subtitle",
    "shortDescription",
    "bannerImageName",
    "startDate",
    "endDate",
    "registrationOpenAt",
    "registrationCloseAt",
    "venue",
    "location",
    "country",
    "organizer",
    "websiteUrl",
    "discordUrl",
    "registrationStatusOverride",
  ]) {
    assert.equal(field("EventSeries", name).isRequired, false, `${name} should be nullable`);
  }

  const featured = field("EventSeries", "featured");
  assert.equal(featured.type, "Boolean");
  assert.equal(featured.isRequired, true);
  assert.equal(featured.hasDefaultValue, true);
  assert.equal(featured.default, false);
});

test("event schema keeps the optional tournament series relation and waitlist defaults", () => {
  assert.equal(field("Tournament", "seriesId").isRequired, false);
  assert.equal(field("EventSeries", "tournaments").isList, true);
  assert.equal(field("Tournament", "series").relationOnDelete, "SetNull");

  const waitlistEnabled = field("Tournament", "waitlistEnabled");
  assert.equal(waitlistEnabled.type, "Boolean");
  assert.equal(waitlistEnabled.hasDefaultValue, true);
  assert.equal(waitlistEnabled.default, false);
});

test("waitlisted and public reference fields preserve legacy null/default behavior", () => {
  const statusEnum = Prisma.dmmf.datamodel.enums.find(
    (candidate) => candidate.name === "TeamRegistrationStatus"
  );
  assert.ok(statusEnum);
  assert.ok(statusEnum.values.some((value) => value.name === "waitlisted"));
  assert.equal(field("TeamRegistration", "status").default, "pending");
  assert.equal(field("TeamRegistration", "waitlistPosition").isRequired, false);

  const publicReference = field("TeamRegistration", "publicReference");
  assert.equal(publicReference.isRequired, false);
  assert.equal(publicReference.isUnique, true);
});

test("event schema migration is additive and preserves nullable series deletion", () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "../prisma/migrations/20260817120000_extend_event_series_quest_ascension/migration.sql"
    ),
    "utf8"
  );

  assert.match(migration, /ALTER TYPE "TeamRegistrationStatus" ADD VALUE 'waitlisted'/);
  assert.match(migration, /ALTER TABLE "event_series"/);
  assert.match(migration, /ALTER TABLE "tournaments"/);
  assert.match(migration, /ALTER TABLE "team_registrations"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|CREATE TABLE/);
});
