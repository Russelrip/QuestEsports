const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Load .env the same way the app does so the guard below sees the database this
// run would actually write to.
require("dotenv").config({ quiet: true });

const {
  resolveDatabaseIntegrationTarget,
} = require("../tests/helpers/database-integration-guard");

// Run the real-database suite only against a dedicated local test database.
// The integration tests skip themselves unless this flag is set.
process.env.RUN_DATABASE_INTEGRATION_TESTS = "true";

// Invoking this script is an explicit request to run the suite, so an unsafe
// database target is an error here rather than a silent skip.
const target = resolveDatabaseIntegrationTarget();
if (!target.run) {
  console.error(`Refusing to run the database integration suite: ${target.reason}`);
  process.exitCode = 1;
  return;
}

const result = spawnSync(
  process.execPath,
  ["--test", "tests/database-integration.test.js"],
  {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  }
);

if (result.error) {
  console.error("Could not run database integration tests.", result.error);
  process.exitCode = 1;
} else if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
