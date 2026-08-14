const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const modulePath = path.join(__dirname, "../src/lib/data-hygiene.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

test("data hygiene applies bounded retention cutoffs and protects rooms with open support", () => {
  const { module: hygiene, restore } = loadModuleWithMocks(modulePath, { [prismaPath]: { prisma: {} } });
  try {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const filters = hygiene.buildFilters(now);
    assert.equal(filters.succeededJobs.completedAt.lt.toISOString(), "2026-07-15T12:00:00.000Z");
    assert.equal(filters.failedJobs.failedAt.lt.toISOString(), "2026-05-16T12:00:00.000Z");
    assert.equal(filters.oldRoomMessages.createdAt.lt.toISOString(), "2026-02-15T12:00:00.000Z");
    assert.deepEqual(filters.oldRoomMessages.room.support, { none: { status: "open" } });
    assert.equal(filters.expiredRegistrationInvites.inviteStatus, "pending");
  } finally { restore(); }
});
