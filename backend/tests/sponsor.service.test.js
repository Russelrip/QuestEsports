const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/sponsor.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const cleanupPath = path.join(__dirname, "../src/lib/upload-cleanup.js");

const sponsorRow = (overrides = {}) => ({
  id: "sponsor-1",
  name: "Red Bull",
  partnershipLabel: "Energy Partner",
  logoImageName: "red-bull.webp",
  websiteUrl: "https://redbull.example",
  displayOrder: 10,
  createdAt: new Date("2026-09-01"),
  ...overrides,
});

// Every sponsor write now commits with its audit entry, so the mocked client has
// to offer a transaction and somewhere for that entry to land. The interactive
// form hands back the same object: these cases assert what was written, not that
// Postgres would roll it back -- the real-database suite covers that.
const withTransaction = (prisma, audits) => {
  const client = {
    ...prisma,
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  client.$transaction = async (run) => run(client);
  return client;
};

const load = (prisma, { uploaded = null } = {}) => {
  const removed = [];
  const audits = [];
  const loaded = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma: withTransaction(prisma, audits) },
    [uploadPath]: {
      persistSponsorLogoUpload: async () => uploaded,
      sponsorLogoDirectory: "sponsor-logos",
    },
    [cleanupPath]: { removeUploadsQuietly: async (uploads) => { removed.push(...uploads); } },
  });
  return { ...loaded, removed, audits };
};

test("event sponsors are created against the event, not a tournament", async () => {
  let created;
  const prisma = {
    eventSeries: { findUnique: async ({ where }) => (where.id === "event-1" ? { id: "event-1" } : null) },
    eventSponsor: { create: async ({ data }) => { created = data; return sponsorRow({ ...data }); } },
  };
  const { module: service, restore } = load(prisma, { uploaded: { filename: "new-logo.webp" } });
  try {
    const sponsor = await service.saveEventSponsor({
      eventId: "event-1",
      body: { name: "Big Hill", partnershipLabel: "Snack Partner", websiteUrl: "https://bighill.example", displayOrder: "20" },
    });
    assert.equal(created.seriesId, "event-1");
    assert.equal(created.tournamentId, undefined);
    assert.equal(created.logoImageName, "new-logo.webp");
    assert.equal(created.displayOrder, 20);
    assert.equal(sponsor.logoUrl, "/api/uploads/sponsor-logos/new-logo.webp");
  } finally {
    restore();
  }
});

test("adding a sponsor to a missing event is a 404", async () => {
  const prisma = { eventSeries: { findUnique: async () => null } };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.saveEventSponsor({ eventId: "missing", body: { name: "Red Bull" } }),
      (error) => error.statusCode === 404 && error.message === "Event not found."
    );
  } finally {
    restore();
  }
});

test("event sponsors list in display order and are scoped to their event", async () => {
  let listArgs;
  const prisma = {
    eventSeries: { findUnique: async () => ({ id: "event-1" }) },
    eventSponsor: { findMany: async (args) => { listArgs = args; return [sponsorRow()]; } },
  };
  const { module: service, restore } = load(prisma);
  try {
    const sponsors = await service.listEventSponsors("event-1");
    assert.deepEqual(listArgs.where, { seriesId: "event-1" });
    assert.deepEqual(listArgs.orderBy, [{ displayOrder: "asc" }, { createdAt: "asc" }]);
    assert.equal(sponsors[0].partnershipLabel, "Energy Partner");
  } finally {
    restore();
  }
});

test("deleting an event sponsor checks ownership and removes its logo file", async () => {
  let lookup;
  let deleted;
  const prisma = {
    eventSponsor: {
      findFirst: async (args) => { lookup = args; return sponsorRow(); },
      delete: async (args) => { deleted = args; },
    },
  };
  const { module: service, restore, removed } = load(prisma);
  try {
    await service.deleteEventSponsor({ eventId: "event-1", sponsorId: "sponsor-1" });
    assert.deepEqual(lookup.where, { id: "sponsor-1", seriesId: "event-1" });
    assert.deepEqual(deleted, { where: { id: "sponsor-1" } });
    assert.deepEqual(removed, [{ directory: "sponsor-logos", filename: "red-bull.webp" }]);
  } finally {
    restore();
  }
});

test("a sponsor id from another event is not found", async () => {
  const prisma = { eventSponsor: { findFirst: async () => null } };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.deleteEventSponsor({ eventId: "event-2", sponsorId: "sponsor-1" }),
      (error) => error.statusCode === 404
    );
  } finally {
    restore();
  }
});

test("tournament sponsors still save against the tournament", async () => {
  let created;
  const prisma = {
    tournament: { findUnique: async () => ({ id: "tournament-1" }) },
    tournamentSponsor: { create: async ({ data }) => { created = data; return sponsorRow(data); } },
  };
  const { module: service, restore } = load(prisma);
  try {
    await service.saveTournamentSponsor({ tournamentId: "tournament-1", body: { name: "Noob Alliance" } });
    assert.equal(created.tournamentId, "tournament-1");
    assert.equal(created.partnershipLabel, "Official Sponsor");
  } finally {
    restore();
  }
});

test("creating a sponsor records who added it and what was stored", async () => {
  const prisma = {
    eventSeries: { findUnique: async () => ({ id: "event-1" }) },
    eventSponsor: { create: async ({ data }) => sponsorRow({ ...data }) },
  };
  const { module: service, audits, restore } = load(prisma);
  try {
    await service.saveEventSponsor({
      eventId: "event-1",
      body: { name: "Red Bull", partnershipLabel: "Energy Partner", displayOrder: "10" },
      audit: { actorUserId: "11111111-1111-4111-8111-111111111111", source: "admin" },
    });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "sponsor.created");
    assert.equal(audits[0].targetType, "EventSponsor");
    assert.equal(audits[0].actorUserId, "11111111-1111-4111-8111-111111111111");
    assert.equal(audits[0].beforeData, null);
    assert.equal(audits[0].afterData.name, "Red Bull");
    assert.equal(audits[0].afterData.seriesId, "event-1");
  } finally {
    restore();
  }
});

test("editing a sponsor keeps the values it replaced, which nothing else retains", async () => {
  const existing = sponsorRow({ partnershipLabel: "Energy Partner", displayOrder: 10 });
  const prisma = {
    eventSeries: { findUnique: async () => ({ id: "event-1" }) },
    eventSponsor: {
      findFirst: async () => existing,
      update: async ({ data }) => sponsorRow({ ...existing, ...data }),
    },
  };
  const { module: service, audits, restore } = load(prisma);
  try {
    await service.saveEventSponsor({
      eventId: "event-1",
      sponsorId: "sponsor-1",
      body: { name: "Red Bull", partnershipLabel: "Gift Partner", displayOrder: "5" },
      audit: { source: "admin" },
    });
    assert.equal(audits[0].action, "sponsor.updated");
    // The old label is only recoverable from here once the row is overwritten.
    assert.equal(audits[0].beforeData.partnershipLabel, "Energy Partner");
    assert.equal(audits[0].beforeData.displayOrder, 10);
    assert.equal(audits[0].afterData.partnershipLabel, "Gift Partner");
    assert.equal(audits[0].afterData.displayOrder, 5);
  } finally {
    restore();
  }
});

test("deleting a sponsor records the whole row, because nothing else will", async () => {
  const existing = sponsorRow();
  const prisma = {
    eventSponsor: {
      findFirst: async () => existing,
      delete: async () => existing,
    },
  };
  const { module: service, audits, restore } = load(prisma);
  try {
    await service.deleteEventSponsor({
      eventId: "event-1",
      sponsorId: "sponsor-1",
      audit: { source: "admin" },
    });
    assert.equal(audits[0].action, "sponsor.deleted");
    assert.equal(audits[0].targetId, "sponsor-1");
    assert.equal(audits[0].beforeData.name, "Red Bull");
    assert.equal(audits[0].beforeData.logoImageName, "red-bull.webp");
    assert.equal(audits[0].beforeData.websiteUrl, "https://redbull.example");
    assert.equal(audits[0].afterData.logoFileRemoved, true);
  } finally {
    restore();
  }
});
