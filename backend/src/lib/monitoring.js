const { logger } = require("./logger");

const summarizeError = (error) => {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
};

const captureException = (error, context = {}) => {
  logger.error("Monitoring capture", {
    ...context,
    error: summarizeError(error),
  });
};

const monitoringStatus = () => ({
  provider: process.env.MONITORING_PROVIDER || "logger",
  enabled: Boolean(process.env.MONITORING_PROVIDER),
  notes:
    "Set MONITORING_PROVIDER and replace backend/src/lib/monitoring.js with your Sentry, Datadog, or OpenTelemetry transport.",
});

module.exports = {
  captureException,
  monitoringStatus,
};
