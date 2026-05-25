const { env } = require("../config/env");
const { logger, redact } = require("./logger");
const { schedulePostJson } = require("./observability-transport");

const summarizeError = (error) => {
  if (!error) {
    return null;
  }

  return redact(error);
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
};

const monitoringStatus = () => ({
  provider: env.MONITORING_WEBHOOK_URL
    ? "webhook"
    : env.LOG_DRAIN_URL
      ? "log-drain"
      : "logger",
  enabled: Boolean(env.MONITORING_WEBHOOK_URL || env.LOG_DRAIN_URL),
  logDrainEnabled: Boolean(env.LOG_DRAIN_URL),
  exceptionWebhookEnabled: Boolean(env.MONITORING_WEBHOOK_URL),
});

module.exports = {
  captureException,
  monitoringStatus,
};
