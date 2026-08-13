const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const validationPath = path.join(__dirname, "../src/modules/valorant/valorant.validation.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);

const loadValidation = () => loadModuleWithMocks(validationPath, {
  [httpErrorPath]: { HttpError },
});

test("parseRiotId accepts a Name#Tag and rejects malformed values", () => {
  const { module: validation } = loadValidation();
  assert.deepEqual(validation.parseRiotId("TenZ#SEN"), { name: "TenZ", tag: "SEN" });
  assert.deepEqual(validation.parseRiotId("  Demon1#NA "), { name: "Demon1", tag: "NA" });
  for (const bad of ["", "NoTag", "a#b#c", "x#y#", "#tag", "name#", "#".repeat(40)]) {
    assert.throws(() => validation.parseRiotId(bad), (error) =>
      error instanceof HttpError && error.statusCode === 400);
  }
});

test("normalizeRiotId trims name and tag and rejects oversized values", () => {
  const { module: validation } = loadValidation();
  assert.deepEqual(validation.normalizeRiotId({ name: " TenZ ", tag: " SEN " }), { name: "TenZ", tag: "SEN" });
  assert.throws(() => validation.normalizeRiotId({ name: "x".repeat(33), tag: "SEN" }), HttpError);
  assert.throws(() => validation.normalizeRiotId({ name: "TenZ", tag: "y".repeat(17) }), HttpError);
});

test("generateExternalKey returns a uuid-shaped string", () => {
  const { module: validation } = loadValidation();
  assert.match(validation.generateExternalKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("assertSupportedFormat accepts bo1/bo3/bo5 and rejects everything else", () => {
  const { module: validation } = loadValidation();
  for (const format of ["bo1", "bo3", "bo5"]) validation.assertSupportedFormat(format);
  assert.throws(() => validation.assertSupportedFormat("bo7"), HttpError);
});
