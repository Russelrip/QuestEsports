const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const apiRouter = require("./routes");
const v1Router = require("./routes/v1");
const { openApiDocument } = require("./lib/openapi");
const { checkDatabaseReadiness } = require("./lib/database");
const { checkUploadReadiness } = require("./middleware/upload");
const { logger } = require("./lib/logger");
const { getRealtimeStatus } = require("./modules/realtime/realtime.service");
const {
  requireSiteAvailable,
  sendMaintenanceResponse,
} = require("./middleware/maintenance");
const { notFoundHandler, errorHandler } = require("./middleware/error-handler");
const {
  attachRequestContext,
  logRequestLifecycle,
} = require("./middleware/observability");
const {
  protectAgainstCsrf,
  requireAllowedApiOrigin,
  setSecurityHeaders,
} = require("./middleware/security");

const app = express();

const buildHealthPayload = () => ({
  success: true,
  message: "Quest E-sports API is healthy.",
  timestamp: new Date().toISOString(),
});

app.set("trust proxy", env.TRUST_PROXY);

app.use(setSecurityHeaders);
app.use(attachRequestContext);
app.use(logRequestLifecycle);
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  })
);
app.use(requireAllowedApiOrigin);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 100 }));
app.use(protectAgainstCsrf);

app.get("/api/health/live", (req, res) =>
  res.status(200).json({
    success: true,
    message: "Quest E-sports API is live.",
    timestamp: new Date().toISOString(),
    maintenance: { enabled: env.SITE_MAINTENANCE_MODE },
    realtime: { enabled: env.REALTIME_SSE_ENABLED, ...getRealtimeStatus() },
  })
);
const readinessHandler = async (req, res) => {
  if (env.SITE_MAINTENANCE_MODE) {
    return sendMaintenanceResponse(req, res, {
      readiness: { dependencies: "maintenance" },
    });
  }

  try {
    await Promise.all([checkDatabaseReadiness(), checkUploadReadiness()]);
    res.status(200).json({
      ...buildHealthPayload(),
      readiness: { database: "ready", storage: "ready" },
    });
  } catch (error) {
    logger.warn("API readiness check failed", { error });
    res.status(503).json({
      success: false,
      message: "Quest E-sports API is not ready.",
      timestamp: new Date().toISOString(),
      readiness: { dependencies: "unavailable" },
    });
  }
};
app.get("/api/health", readinessHandler);
app.get("/api/health/ready", readinessHandler);
app.use(requireSiteAvailable);
app.get("/api/openapi.json", (req, res) => res.status(200).json(openApiDocument));

app.use("/api/v1", v1Router);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
