const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Run the real-database suite only against a dedicated local test database.
// The integration tests skip themselves unless this flag is set.
process.env.RUN_DATABASE_INTEGRATION_TESTS = "true";

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
