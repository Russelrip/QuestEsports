const { HttpError } = require("../lib/http-error");
const { logger } = require("../lib/logger");
const { captureException } = require("../lib/monitoring");
const { mapPrismaError } = require("../lib/prisma-errors");

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const errorHandler = (error, req, res, next) => {
  const normalizedError = mapPrismaError(error);

  if (res.headersSent) {
    next(normalizedError);
    return;
  }

  if (normalizedError instanceof HttpError) {
    if (normalizedError.statusCode >= 500) {
      logger.error("Handled API error", {
        method: req.method,
        path: req.originalUrl,
        statusCode: normalizedError.statusCode,
        error: normalizedError,
      });
      captureException(normalizedError, {
        method: req.method,
        path: req.originalUrl,
        statusCode: normalizedError.statusCode,
      });
    }

    res.status(normalizedError.statusCode).json({
      success: false,
      message: normalizedError.message,
      details: normalizedError.details || undefined,
    });
    return;
  }

  if (normalizedError && normalizedError.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      success: false,
      message: "Uploaded image must be 5MB or smaller.",
    });
    return;
  }

  logger.error("Unhandled API error", {
    method: req.method,
    path: req.originalUrl,
    error: normalizedError,
  });
  captureException(normalizedError, {
    method: req.method,
    path: req.originalUrl,
    statusCode: 500,
  });

  res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
};

module.exports = { notFoundHandler, errorHandler };
