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
const { requireWritesEnabled } = require("./middleware/write-freeze");
const { notFoundHandler, errorHandler } = require("./middleware/error-handler");
const {
  attachRequestContext,
  logRequestLifecycle,
} = require("./middleware/observability");
const {
  isInternalRequest,
  protectAgainstCsrf,
  requireAllowedApiOrigin,
  setSecurityHeaders,
} = require("./middleware/security");

const app = express();

// Express advertises itself on every response by default. It tells a caller
// nothing they need and tells a scanner which stack to look up.
app.disable("x-powered-by");

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
    exposedHeaders: ["Content-Disposition", "Retry-After", "X-Write-Freeze"],
  })
);
// This boundary deliberately precedes origin checks, body parsers, and CSRF
// validation so a frozen writer cannot be answered with a different
// client-input error first. CORS only adds response headers; it does not reject
// the request, so frozen browser mutations remain observable to callers.
app.get("/api/health/write-freeze", (req, res) =>
  res.status(200).json({
    mode: env.WRITE_FREEZE_MODE,
    writersEnabled: env.WRITE_FREEZE_MODE !== "validation",
  }),
);
app.use(requireWritesEnabled);
app.use(requireAllowedApiOrigin);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 100 }));
app.use(protectAgainstCsrf);

app.get("/api/health/live", (req, res) => {
  const payload = {
    success: true,
    message: "Quest E-sports API is live.",
    timestamp: new Date().toISOString(),
    maintenance: { enabled: env.SITE_MAINTENANCE_MODE },
    // The browser reads realtime.enabled before opening an EventSource, so
    // the flag stays public. Worker identity, connection and client counts,
    // published-event totals, and transport state do not.
    realtime: { enabled: env.REALTIME_SSE_ENABLED },
  };

  if (isInternalRequest(req)) {
    Object.assign(payload.realtime, getRealtimeStatus());
    payload.observability = getObservabilityTransportStatus();
  }

  return res.status(200).json(payload);
});
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
    // The release gate and the container healthcheck read per-dependency
    // state; a public caller gets the verdict the status code already
    // carries, so uptime monitoring is unaffected.
    if (!isInternalRequest(req)) {
      return res.status(200).json(buildHealthPayload());
    }

    const readiness = { database: "ready", storage: "ready" };
    if (realtimeReadinessRequired) readiness.realtime = "ready";
    return res.status(200).json({
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
// The contract lists every admin route, which in production only hands
// scanners a map (they fetched it and walked it in September 2026). Keep it
// for local and test use; production answers 404 like any unknown route.
if (env.NODE_ENV !== "production") {
  app.get("/api/openapi.json", (req, res) => res.status(200).json(openApiDocument));
}

app.use("/api/v1", v1Router);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
