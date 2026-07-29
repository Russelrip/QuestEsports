const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("production restore passes the target database through pg_restore --dbname", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8"
  );

  assert.match(restoreScript, /pg_restore --dbname="\$DIRECT_URL"/);
  assert.doesNotMatch(restoreScript, /pg_restore "\$DIRECT_URL"/);
});
