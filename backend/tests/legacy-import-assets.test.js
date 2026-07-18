const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const servicePath = path.join(
  __dirname,
  "../src/modules/media/legacy-import.service.js"
);
const source = fs.readFileSync(servicePath, "utf8");
const repositoryRoot = path.join(__dirname, "../..");

test("every declared legacy poster source is packaged in the repository", () => {
  const declaredPaths = [...source.matchAll(/filePath:\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );

  assert.ok(declaredPaths.length > 0, "expected legacy poster declarations");
  for (const relativePath of declaredPaths) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, relativePath)),
      true,
      `missing legacy poster source: ${relativePath}`
    );
  }
});
