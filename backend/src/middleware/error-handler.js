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

    res.status(normalizedError.statusCode).json({
      success: false,
      message: normalizedError.message,
      details: normalizedError.details || undefined,
      requestId: req.requestId,
    });
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

  res.status(500).json({
    success: false,
    message: "Internal server error.",
    requestId: req.requestId,
  });
};

module.exports = { notFoundHandler, errorHandler };
