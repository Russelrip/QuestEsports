const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const apiRouter = require("./routes");
const v1Router = require("./routes/v1");
const { openApiDocument } = require("./lib/openapi");
const { checkDatabaseReadiness } = require("./lib/database");
const { checkUploadReadiness } = require("./middleware/upload");
const { logger } = require("./lib/logger");
const { getObservabilityTransportStatus } = require("./lib/observability-transport");
const {
  getRealtimeStatus,
  isRealtimeTransportReady,
} = require("./modules/realtime/realtime.service");
const { getApiCapabilities } = require("./lib/release");
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

const requiresRealtimeReadiness = () =>
  env.REALTIME_SSE_ENABLED && getRealtimeStatus().sharedTransportRequired;

app.set("trust proxy", env.TRUST_PROXY);

app.use(setSecurityHeaders);
app.use(attachRequestContext);
app.use(logRequestLifecycle);
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
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
    observability: getObservabilityTransportStatus(),
  })
);
app.get("/.well-known/assetlinks.json", (req, res) => {
  if (!env.MOBILE_ADMIN_ANDROID_CERT_SHA256) {
    return res.status(404).json({ success: false, message: "App link configuration is unavailable." });
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "lk.questesports.admin",
        sha256_cert_fingerprints: [env.MOBILE_ADMIN_ANDROID_CERT_SHA256],
      },
    },
  ]);
});
const readinessHandler = async (req, res) => {
  if (env.SITE_MAINTENANCE_MODE) {
    return sendMaintenanceResponse(req, res, {
      readiness: { dependencies: "maintenance" },
    });
  }

  try {
    const readinessChecks = [checkDatabaseReadiness(), checkUploadReadiness()];
    const realtimeReadinessRequired = requiresRealtimeReadiness();
    if (realtimeReadinessRequired) {
      readinessChecks.push(Promise.resolve().then(() => {
        if (!isRealtimeTransportReady()) throw new Error("Realtime transport is not ready.");
      }));
    }
    await Promise.all(readinessChecks);
    const readiness = { database: "ready", storage: "ready" };
    if (realtimeReadinessRequired) readiness.realtime = "ready";
    res.status(200).json({
      ...buildHealthPayload(),
      readiness,
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
app.get("/api/capabilities", (req, res) =>
  res.status(200).json({ success: true, ...getApiCapabilities() }),
);
app.use(requireSiteAvailable);
app.get("/api/openapi.json", (req, res) => res.status(200).json(openApiDocument));

app.use("/api/v1", v1Router);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
