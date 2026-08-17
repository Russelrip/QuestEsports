const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/series/series.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const cleanupPath = path.join(__dirname, "../src/lib/upload-cleanup.js");
const tournamentPath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const ticketPath = path.join(__dirname, "../src/modules/tickets/ticket.service.js");
const aggregationPath = path.join(__dirname, "../src/modules/series/event-aggregation.js");

const seriesRecord = (overrides = {}) => ({
  id: "event-1",
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "A multi-game event",
  heroImageName: "hero.webp",
  bannerImageName: "banner.webp",
  displayOrder: 4,
  isPublished: true,
  shortName: "QA",
  subtitle: "Rise together",
  shortDescription: "Short event description",
  startDate: new Date("2099-01-01"),
  endDate: new Date("2099-01-03"),
  registrationOpenAt: new Date("2098-12-01"),
  registrationCloseAt: new Date("2098-12-31"),
  venue: "Colombo",
  location: "Sri Lanka",
  country: "Sri Lanka",
  organizer: "Quest Esports",
  websiteUrl: "https://quest.example/events/qa",
  discordUrl: "https://discord.gg/quest",
  featured: true,
  registrationStatusOverride: null,
  tournaments: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  ...overrides,
});

const buildMocks = (prisma, aggregate = { games: 0, teamsRegistered: 0, playersRegistered: 0, availableSlots: 0, registrationState: "closed" }) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [uploadPath]: {
    persistTournamentBannerUpload: async () => null,
    tournamentBannerDirectory: "banners",
  },
  [cleanupPath]: { removeUploadsQuietly: async () => undefined },
  [tournamentPath]: {
    mapTournament: (tournament) => ({ id: tournament.id, title: tournament.title }),
    buildRegistrationCountInclude: () => ({ _count: { select: { teamRegistrations: true } } }),
    createAdminTournament: async () => ({ id: "created-tournament" }),
    attachTournamentToSeries: async () => ({ id: "attached-tournament" }),
  },
  [ticketPath]: { getPublicEventForSeries: async () => null },
  [aggregationPath]: { getEventAggregate: async () => aggregate },
});

test("event service filters unpublished children and keeps private registration data out", async () => {
  const prisma = {
    eventSeries: {
      findMany: async () => [seriesRecord({
        tournaments: [
          { id: "published", title: "Published Game", isPublished: true },
          { id: "draft", title: "Draft Game", isPublished: false, captainEmail: "private@example.com" },
        ],
      })],
    },
  };
  const { module: service, restore } = buildMocks(prisma, {
    games: 1,
    teamsRegistered: 2,
    playersRegistered: 8,
    availableSlots: 3,
    registrationState: "open",
  });

  try {
    const result = await service.listPublicEvents();
    assert.equal(result[0].shortName, "QA");
    assert.equal(result[0].bannerUrl, "/api/uploads/tournament-banners/banner.webp");
    assert.equal(result[0].games, 1);
    assert.deepEqual(result[0].tournaments, [{ id: "published", title: "Published Game" }]);
    assert.equal(JSON.stringify(result[0]).includes("captainEmail"), false);
  } finally {
    restore();
  }
});

test("event service aliases retain the old event-series response model", async () => {
  const series = seriesRecord();
  const prisma = {
    eventSeries: {
      findMany: async () => [series],
      findFirst: async () => series,
    },
  };
  const { module: service, restore } = buildMocks(prisma);
  try {
    assert.deepEqual(await service.listPublicEvents(), await service.listPublicSeries());
    assert.deepEqual(
      await service.getPublicEventBySlug("quest-ascension"),
      await service.getPublicSeriesBySlug("quest-ascension")
    );
  } finally {
    restore();
  }
});

test("event service archive unpublishes safely even when children exist", async () => {
  let updateArgs;
  let archiveLookupArgs;
  const prisma = {
    eventSeries: {
      findUnique: async (args) => {
        archiveLookupArgs = args;
        return seriesRecord({ tournaments: [{ id: "child", title: "Child Game", isPublished: true }] });
      },
      update: async (args) => { updateArgs = args; return seriesRecord({ isPublished: false }); },
    },
  };
  const { module: service, restore } = buildMocks(prisma);
  try {
    const result = await service.archiveAdminSeries("event-1");
    assert.equal(result.isPublished, false);
    assert.deepEqual(updateArgs, { where: { id: "event-1" }, data: { isPublished: false } });
    assert.ok(archiveLookupArgs.include.tournaments.include, "archive must load the full child projection");
  } finally {
    restore();
  }
});

test("event PATCH parsing clears explicit optional values but preserves absent fields", async () => {
  const { module: service, restore } = buildMocks({});
  try {
    const existing = seriesRecord();
    const cleared = service.parseSeries({ shortName: "", websiteUrl: null, startDate: "" }, existing);
    assert.equal(cleared.shortName, null);
    assert.equal(cleared.websiteUrl, null);
    assert.equal(cleared.startDate, null);
    const preserved = service.parseSeries({}, existing);
    assert.equal(preserved.shortName, existing.shortName);
    assert.equal(preserved.websiteUrl, existing.websiteUrl);
    assert.equal(preserved.startDate.getTime(), existing.startDate.getTime());
    assert.throws(() => service.parseSeries({ title: "" }, existing), /Title, slug, and description are required/);
  } finally {
    restore();
  }
});
