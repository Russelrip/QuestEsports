const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("committed .env.example files contain only placeholder values", () => {
  const questExample = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");
  const lines = questExample.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("=")) continue;
    const value = line.slice(line.indexOf("=") + 1).trim();
    // Values must be empty, placeholders, documented defaults, or URLs with
    // USER:PASSWORD style creds — never real secret-shaped values.
    assert.doesNotMatch(
      value,
      /^[A-Za-z0-9+/]{32,}={0,2}$/,
      `secret-shaped value in .env.example: ${line}`,
    );
  }
});
