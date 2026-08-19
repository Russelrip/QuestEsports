const { HttpError } = require("../lib/http-error");
const { logger } = require("../lib/logger");
const { captureException } = require("../lib/monitoring");
const { mapPrismaError } = require("../lib/prisma-errors");

const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: "Uploaded file is too large.",
  LIMIT_FILE_COUNT: "Too many files were uploaded.",
  LIMIT_FIELD_KEY: "Upload field names are too long.",
  LIMIT_FIELD_VALUE: "Upload fields are too large.",
  LIMIT_FIELD_COUNT: "Too many upload fields were submitted.",
  LIMIT_FIELD_NESTING: "Upload field names are nested too deeply.",
  LIMIT_PART_COUNT: "Too many upload parts were submitted.",
  LIMIT_UNEXPECTED_FILE: "Unexpected upload field.",
};

const isVersionedRequest = (req) => req.originalUrl?.startsWith("/api/v1/");
const statusErrorCode = (statusCode) => ({
  400: "invalid_request",
  401: "authentication_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
  502: "upstream_unavailable",
  503: "service_unavailable",
  504: "upstream_timeout",
}[statusCode] || "request_failed");

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    requestId: req.requestId,
  });
};

const errorHandler = (error, req, res, next) => {
  const normalizedError = mapPrismaError(error);
  const sourceErrorCode =
    typeof error?.code === "string" ? error.code : undefined;

  if (res.headersSent) {
    next(normalizedError);
    return;
  }

  if (normalizedError instanceof HttpError) {
    if (normalizedError.statusCode >= 500) {
      logger.error("Handled API error", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: normalizedError.statusCode,
        sourceErrorCode,
        error: normalizedError,
      });
      captureException(normalizedError, {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: normalizedError.statusCode,
        sourceErrorCode,
      });
    }

    const body = {
      success: false,
      message: normalizedError.message,
      details: normalizedError.details || undefined,
      requestId: req.requestId,
    };
    if (isVersionedRequest(req)) {
      body.error = {
        code: /^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(sourceErrorCode || "")
          ? sourceErrorCode
          : statusErrorCode(normalizedError.statusCode),
        message: normalizedError.message,
      };
      body.meta = { serverNow: new Date().toISOString() };
    }
    res.status(normalizedError.statusCode).json(body);
    return;
  }

  if (normalizedError && MULTER_ERROR_MESSAGES[normalizedError.code]) {
    res.status(400).json({
      success: false,
      message: MULTER_ERROR_MESSAGES[normalizedError.code],
      requestId: req.requestId,
    });
    return;
  }

  // Mapped upstream (FastAPI/valorant-client) errors. Duck-typed on shape so
  // this shared middleware never imports the valorant client: FastApiError and
  // InternalServiceError both carry a STRING `code` and a NUMERIC `status` in
  // 400-599. Without this branch every mapped 409/404/422/429/502/503 would
  // collapse into the generic 500 and body.error.code (spec §6.5) would never
  // materialize.
  const upstreamStatus =
    typeof error?.code === "string" && typeof error?.status === "number" ? error.status : null;
  if (upstreamStatus !== null && upstreamStatus >= 400 && upstreamStatus <= 599) {
    if (upstreamStatus >= 500) {
      logger.error("Handled upstream API error", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: upstreamStatus,
        sourceErrorCode: error.code,
        error,
      });
      captureException(error, {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: upstreamStatus,
        sourceErrorCode: error.code,
      });
    }

    const body = {
      success: false,
      message: error.message,
      requestId: req.requestId,
    };
    if (isVersionedRequest(req)) {
      body.error = {
        code: error.code,
        message: error.message,
        request_id: error.requestId || null,
      };
      body.meta = { serverNow: new Date().toISOString() };
    }
    res.status(upstreamStatus).json(body);
    return;
  }

  logger.error("Unhandled API error", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: normalizedError,
  });
  captureException(normalizedError, {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: 500,
  });

  const body = {
    success: false,
    message: "Internal server error.",
    requestId: req.requestId,
  };
  if (isVersionedRequest(req)) {
    body.error = { code: "internal_error", message: "Internal server error." };
    body.meta = { serverNow: new Date().toISOString() };
  }
  res.status(500).json(body);
};

module.exports = { notFoundHandler, errorHandler };
