const { env } = require("../config/env");
const { logger, redact } = require("./logger");
const { schedulePostJson } = require("./observability-transport");

const summarizeError = (error) => {
  if (!error) {
    return null;
  }

  return redact(error);
};

const truncate = (value, limit) => {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
};

const buildDiscordPayload = (payload) => {
  const context = payload.context || {};
  const error = payload.error || {};
  const fields = [
    { name: "Environment", value: truncate(payload.environment, 1024), inline: true },
    { name: "Status", value: truncate(context.statusCode || 500, 1024), inline: true },
    { name: "Request ID", value: truncate(context.requestId || "Unavailable", 1024), inline: false },
    { name: "Request", value: truncate(`${context.method || "UNKNOWN"} ${context.path || "Unknown path"}`, 1024), inline: false },
  ];

  return {
    username: "Quest E-sports Monitor",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Backend exception",
        description: truncate(error.message || "An unexpected backend error occurred.", 4096),
        color: 0xdc2626,
        fields,
        footer: { text: "Quest E-sports API" },
        timestamp: payload.timestamp,
      },
    ],
  };
};

const captureException = (error, context = {}) => {
  const payload = {
    type: "exception",
    level: "error",
    timestamp: new Date().toISOString(),
    service: "quest-esports-backend",
    environment: env.NODE_ENV,
    context: redact(context),
    error: summarizeError(error),
  };

  logger.error("Monitoring capture", payload);

  schedulePostJson({
    url: env.MONITORING_WEBHOOK_URL,
    token: env.MONITORING_WEBHOOK_TOKEN,
    payload,
    onError: (transportError) => {
      logger.warn("Failed to ship monitoring event.", {
        error: transportError,
        originalError: error,
      });
    },
  });

  schedulePostJson({
    url: env.DISCORD_ALERT_WEBHOOK_URL,
    payload: buildDiscordPayload(payload),
    onError: (transportError) => {
      logger.warn("Failed to ship Discord exception alert.", {
        error: transportError,
        originalError: error,
      });
    },
  });
};

const monitoringStatus = () => ({
  provider: env.DISCORD_ALERT_WEBHOOK_URL
    ? "discord"
    : env.MONITORING_WEBHOOK_URL
    ? "webhook"
    : env.LOG_DRAIN_URL
      ? "log-drain"
      : "logger",
  enabled: Boolean(
    env.DISCORD_ALERT_WEBHOOK_URL || env.MONITORING_WEBHOOK_URL || env.LOG_DRAIN_URL
  ),
  logDrainEnabled: Boolean(env.LOG_DRAIN_URL),
  exceptionWebhookEnabled: Boolean(env.MONITORING_WEBHOOK_URL),
  discordAlertsEnabled: Boolean(env.DISCORD_ALERT_WEBHOOK_URL),
});

module.exports = {
  captureException,
  buildDiscordPayload,
  monitoringStatus,
};
