const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/registration.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const teamPath = path.join(__dirname, "../src/modules/teams/team.service.js");
const paymentPath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const generatedPath = path.join(__dirname, "../src/generated/prisma/index.js");

const load = () => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma: {} },
  [uploadPath]: {},
  [teamPath]: {},
  [paymentPath]: {},
  [generatedPath]: { Prisma: {} },
});

test("configured registration fields support entry and member scopes", () => {
  const { module: service, restore } = load();
  try {
    const result = service.validateConfiguredFields({
      definitions: [
        { key: "region", label: "Region", type: "select", scope: "entry", required: true, options: ["Sri Lanka", "India"] },
        { key: "pubgId", label: "PUBG Mobile ID", type: "number", scope: "member", required: true },
      ],
      entryData: { region: "Sri Lanka" },
      members: [{ additionalData: { pubgId: "12345" } }],
    });
    assert.deepEqual(result.entryData, { region: "Sri Lanka" });
    assert.deepEqual(result.members[0].additionalData, { pubgId: "12345" });
  } finally { restore(); }
});

test("configured registration fields reject missing, invalid select, and invalid number values", () => {
  const { module: service, restore } = load();
  try {
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "riot", label: "Riot ID", type: "text", scope: "entry", required: true }], entryData: {}, members: [] }), /Riot ID is required/);
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "region", label: "Region", type: "select", scope: "entry", required: true, options: ["LK"] }], entryData: { region: "EU" }, members: [] }), /Region has an invalid selection/);
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "id", label: "Player ID", type: "number", scope: "member", required: true }], entryData: {}, members: [{ additionalData: { id: "abc" } }] }), /Player ID must be a number/);
  } finally { restore(); }
});

test("Valorant registrations require a complete Riot ID for every roster member", () => {
  const { module: service, restore } = load();
  try {
    assert.doesNotThrow(() => service.validateGameIdentities({
      game: "Valorant",
      members: [{ riotId: "QuestCaptain#123" }, { riotId: "PlayerTwo#APAC" }],
    }));
    assert.throws(
      () => service.validateGameIdentities({ game: "Valorant", members: [{ riotId: "QuestCaptain" }] }),
      /PlayerName#123/
    );
    assert.throws(
      () => service.validateGameIdentities({ game: "Valorant", members: [{ riotId: "" }] }),
      /required for every roster member/
    );
  } finally { restore(); }
});
