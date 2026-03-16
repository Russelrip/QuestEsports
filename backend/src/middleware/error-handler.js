const { HttpError } = require("../lib/http-error");

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
    return;
  }

  if (error && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      success: false,
      message: "Team logo must be 5MB or smaller.",
    });
    return;
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
};

module.exports = { notFoundHandler, errorHandler };
