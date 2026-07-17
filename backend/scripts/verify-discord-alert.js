const { env } = require("../src/config/env");
const { buildDiscordPayload } = require("../src/lib/monitoring");
const { postJson } = require("../src/lib/observability-transport");

const run = async () => {
  if (!env.DISCORD_ALERT_WEBHOOK_URL) {
    throw new Error("Set DISCORD_ALERT_WEBHOOK_URL before running this test.");
  }

  await postJson({
    url: env.DISCORD_ALERT_WEBHOOK_URL,
    payload: buildDiscordPayload({
      type: "exception",
      level: "error",
      timestamp: new Date().toISOString(),
      service: "quest-esports-backend",
      environment: env.NODE_ENV,
      context: {
        requestId: "manual-alert-test",
        method: "TEST",
        path: "/api/monitoring/test",
        statusCode: 500,
      },
      error: { message: "Test alert: Discord monitoring is configured correctly." },
    }),
  });

  console.log("Discord monitoring test delivered successfully.");
};

run().catch((error) => {
  console.error(`Discord monitoring test failed: ${error.message}`);
  process.exitCode = 1;
});
