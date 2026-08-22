const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

const { resolveDatabaseIntegrationTarget } = require("./helpers/database-integration-guard");

// This case writes real rows, so the guard refuses any non-loopback database
// unless it is explicitly opted into.
const databaseTarget = resolveDatabaseIntegrationTarget();
const runDatabaseIntegrationTests = databaseTarget.run;
const databaseIntegrationSkip = runDatabaseIntegrationTests ? false : databaseTarget.reason;

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

test("event schema migration persists defaults, nullability, indexes, and SetNull behavior", {
  skip: databaseIntegrationSkip,
}, async (t) => {
  let prisma;
  let connected = false;
  const suffix = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const tournamentId = crypto.randomUUID();
  const registrationIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];

  try {
    try {
      ({ prisma } = require("../src/lib/prisma"));
      await prisma.$connect();
      connected = true;
    } catch (error) {
      if (prisma) await prisma.$disconnect().catch(() => {});
      prisma = null;
      t.skip(`isolated database unavailable: ${error.message}`);
      return;
    }

    const columns = await prisma.$queryRaw`
      SELECT table_name AS "tableName",
             column_name AS "columnName",
             column_default AS "columnDefault",
             is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'event_series' AND column_name IN (
            'short_name', 'subtitle', 'short_description', 'banner_image_name',
            'start_date', 'end_date', 'registration_open_at', 'registration_close_at',
            'venue', 'location', 'country', 'organizer', 'website_url', 'discord_url',
            'registration_status_override', 'featured'
          ))
          OR (table_name = 'tournaments' AND column_name = 'waitlist_enabled')
          OR (table_name = 'team_registrations' AND column_name IN (
            'waitlist_position', 'public_reference'
          ))
        )
    `;
    const columnByName = new Map(
      columns.map((column) => [`${column.tableName}.${column.columnName}`, column])
    );
    for (const name of [
      "event_series.short_name",
      "event_series.subtitle",
      "event_series.short_description",
      "event_series.banner_image_name",
      "event_series.start_date",
      "event_series.end_date",
      "event_series.registration_open_at",
      "event_series.registration_close_at",
      "event_series.venue",
      "event_series.location",
      "event_series.country",
      "event_series.organizer",
      "event_series.website_url",
      "event_series.discord_url",
      "event_series.registration_status_override",
      "tournaments.waitlist_enabled",
      "team_registrations.waitlist_position",
      "team_registrations.public_reference",
    ]) {
      assert.ok(columnByName.has(name), `expected migrated column ${name}`);
    }
    assert.equal(columnByName.get("event_series.featured").isNullable, "NO");
    assert.match(String(columnByName.get("event_series.featured").columnDefault), /false/);
    assert.equal(columnByName.get("tournaments.waitlist_enabled").isNullable, "NO");
    assert.match(String(columnByName.get("tournaments.waitlist_enabled").columnDefault), /false/);
    for (const name of [
      "event_series.short_name",
      "event_series.registration_status_override",
      "team_registrations.waitlist_position",
      "team_registrations.public_reference",
    ]) {
      assert.equal(columnByName.get(name).isNullable, "YES", `${name} should accept NULL`);
    }

    const indexes = await prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'event_series_is_published_featured_display_order_idx',
          'team_registrations_public_reference_key',
          'team_registrations_tournament_id_status_waitlist_position_idx'
        )
    `;
    const indexNames = new Set(indexes.map((index) => index.indexname));
    for (const name of [
      "event_series_is_published_featured_display_order_idx",
      "team_registrations_public_reference_key",
      "team_registrations_tournament_id_status_waitlist_position_idx",
    ]) {
      assert.ok(indexNames.has(name), `expected migrated index ${name}`);
    }

    const event = await prisma.eventSeries.create({
      data: {
        id: eventId,
        slug: `integration-event-${suffix}`,
        title: "Integration Event",
        description: "Schema integration test event",
        shortName: null,
        subtitle: null,
        shortDescription: null,
        bannerImageName: null,
        startDate: null,
        endDate: null,
        registrationOpenAt: null,
        registrationCloseAt: null,
        venue: null,
        location: null,
        country: null,
        organizer: null,
        websiteUrl: null,
        discordUrl: null,
        registrationStatusOverride: null,
      },
    });
    assert.equal(event.featured, false, "legacy-shaped EventSeries rows use featured=false");

    const tournament = await prisma.tournament.create({
      data: {
        id: tournamentId,
        slug: `integration-tournament-${suffix}`,
        title: "Integration Tournament",
        game: "integration",
        shortDescription: "Schema integration test tournament",
        fullDescription: "Schema integration test tournament",
        format: "5v5",
        teamSize: 5,
        maxTeams: 16,
        prizePool: "Testing",
        seriesId: eventId,
      },
    });
    assert.equal(
      tournament.waitlistEnabled,
      false,
      "legacy-shaped Tournament rows use waitlist_enabled=false"
    );

    const registrationData = (
      id,
      number,
      publicReference = null,
      status,
      waitlistPosition = null
    ) => {
      const data = {
        id,
        tournamentId,
        teamName: `Integration Team ${number} ${suffix}`,
        captainName: `Integration Captain ${number}`,
        captainEmail: `integration-captain-${number}-${suffix}@example.com`,
        captainPhone: "+94770000000",
        captainDiscord: `integration-${number}-${suffix}`,
        captainRiotId: `Integration${number}#TEST`,
        contactEmail: `integration-contact-${number}-${suffix}@example.com`,
        waitlistPosition,
        publicReference,
      };
      if (status) data.status = status;
      return data;
    };
    const legacyRegistration = await prisma.teamRegistration.create({
      data: registrationData(registrationIds[0], 1),
    });
    const secondLegacyRegistration = await prisma.teamRegistration.create({
      data: registrationData(registrationIds[1], 2),
    });
    assert.equal(legacyRegistration.waitlistPosition, null);
    assert.equal(legacyRegistration.publicReference, null);
    assert.equal(secondLegacyRegistration.publicReference, null);

    const waitlistedRegistration = await prisma.teamRegistration.create({
      data: registrationData(registrationIds[2], 3, null, "waitlisted", 1),
    });
    assert.equal(waitlistedRegistration.status, "waitlisted");
    assert.equal(waitlistedRegistration.waitlistPosition, 1);

    const publicReference = `QA-${suffix}`;
    await prisma.teamRegistration.create({
      data: registrationData(registrationIds[3], 4, publicReference),
    });
    await assert.rejects(
      prisma.teamRegistration.create({
        data: registrationData(crypto.randomUUID(), 4, publicReference),
      }),
      (error) => error?.code === "P2002"
    );

    await prisma.eventSeries.delete({ where: { id: eventId } });
    const detachedTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { seriesId: true },
    });
    assert.equal(detachedTournament.seriesId, null, "deleting an event must SetNull its tournament");
  } finally {
    if (prisma && connected) {
      await prisma.teamRegistration.deleteMany({ where: { id: { in: registrationIds } } });
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.eventSeries.deleteMany({ where: { id: eventId } });
      await prisma.$disconnect();
    }
  }
});
