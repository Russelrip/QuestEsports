const test = require("node:test");
const assert = require("node:assert/strict");

const { Prisma, PrismaClient } = require("../src/generated/prisma");

test("generated Prisma client exposes support conversation delegates", () => {
  const models = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));
  const client = new PrismaClient();

  try {
    assert.ok(models.has("SupportConversation"));
    assert.ok(models.has("SupportMessage"));
    assert.equal(typeof client.supportConversation, "object");
    assert.equal(typeof client.supportMessage, "object");
  } finally {
    client.$disconnect();
  }
});
