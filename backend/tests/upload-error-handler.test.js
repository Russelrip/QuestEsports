const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const errorHandlerPath = path.join(__dirname, "../src/middleware/error-handler.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");
const monitoringModulePath = path.join(__dirname, "../src/lib/monitoring.js");
const prismaErrorsModulePath = path.join(__dirname, "../src/lib/prisma-errors.js");

const loadErrorHandler = () =>
  loadModuleWithMocks(errorHandlerPath, {
    [loggerModulePath]: {
      logger: {
        error: () => {},
      },
    },
    [monitoringModulePath]: {
      captureException: () => {},
    },
    [prismaErrorsModulePath]: {
      mapPrismaError: (error) => error,
    },
  });

const buildResponse = () => {
  const response = {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return response;
};

test("errorHandler maps Multer limit failures to 400 responses", () => {
  const { module: handlers, restore } = loadErrorHandler();

  try {
    const response = buildResponse();

    handlers.errorHandler(
      { code: "LIMIT_FIELD_NESTING" },
      {
        requestId: "request-1",
        method: "POST",
        originalUrl: "/api/admin/tournaments",
      },
      response,
      () => {}
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      success: false,
      message: "Upload field names are nested too deeply.",
      requestId: "request-1",
    });
  } finally {
    restore();
  }
});
