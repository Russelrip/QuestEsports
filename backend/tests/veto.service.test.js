const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/veto/veto.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const loadService = () => loadModuleWithMocks(servicePath, { [prismaPath]: { prisma: {} } });

test("built-in veto formats expose complete deterministic series", () => {
  const { module: service, restore } = loadService();
  try {
    for (const [format, played] of [["bo1", 1], ["bo3", 3], ["bo5", 5]]) {
      const steps = service.getBuiltInSteps(format);
      assert.equal(steps.filter((step) => ["pick", "decider"].includes(step.kind)).length, played);
      assert.doesNotThrow(() => service.validateSteps(steps, format, 7));
      assert.equal(steps.at(-1).kind, "side");
    }
  } finally { restore(); }
});

test("preset validation rejects non-deterministic and over-sized definitions", () => {
  const { module: service, restore } = loadService();
  try {
    assert.throws(() => service.validateSteps([{ kind: "pick", actor: "A", seriesIndex: 1 }], "bo3", 7), /requires 3 played maps/i);
    assert.throws(() => service.validateSteps([
      { kind: "ban", actor: "A" },
      { kind: "ban", actor: "B" },
      { kind: "pick", actor: "A", seriesIndex: 1 },
    ], "bo1", 2), /consumes more maps/i);
    assert.throws(() => service.validateSteps([{ kind: "side", actor: "C", seriesIndex: 1 }], "custom", 7), /Team A or Team B/i);
    assert.throws(() => service.validateSteps([
      { kind: "ban", actor: "A" },
      { kind: "decider", seriesIndex: 1 },
    ], "bo1", 7), /leave exactly one map/i);
    assert.throws(() => service.validateSteps([
      { kind: "pick", actor: "A", seriesIndex: 1 },
      { kind: "pick", actor: "B", seriesIndex: 1 },
      { kind: "pick", actor: "A", seriesIndex: 3 },
    ], "bo3", 7), /selected more than once/i);
  } finally { restore(); }
});
