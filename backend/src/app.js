const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const apiRouter = require("./routes");
const { openApiDocument } = require("./lib/openapi");
const { monitoringStatus } = require("./lib/monitoring");
const { notFoundHandler, errorHandler } = require("./middleware/error-handler");
const {
  attachRequestContext,
  logRequestLifecycle,
} = require("./middleware/observability");
const { setSecurityHeaders, protectAgainstCsrf } = require("./middleware/security");

const app = express();

const buildHealthPayload = () => ({
  success: true,
  message: "Quest Esports API is healthy.",
  timestamp: new Date().toISOString(),
  monitoring: monitoringStatus(),
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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(protectAgainstCsrf);

app.get("/api/health", (req, res) => res.status(200).json(buildHealthPayload()));
app.get("/api/openapi.json", (req, res) => res.status(200).json(openApiDocument));

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
