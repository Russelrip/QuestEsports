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

test("errorHandler maps duck-typed upstream errors (FastApiError/InternalServiceError) to their mapped status", () => {
  const { module: handlers, restore } = loadErrorHandler();

  try {
    const response = buildResponse();

    handlers.errorHandler(
      {
        name: "FastApiError",
        code: "TEAM_NOT_FOUND",
        status: 404,
        message: "VALORANT team not found",
        requestId: "upstream-req-1",
        responseSummary: { code: "TEAM_NOT_FOUND", message: "Team not found" },
      },
      {
        requestId: "request-1",
        method: "GET",
        originalUrl: "/api/v1/admin/valorant/teams",
      },
      response,
      () => {}
    );

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.success, false);
    assert.deepEqual(response.body.error, {
      code: "TEAM_NOT_FOUND",
      message: "VALORANT team not found",
      request_id: "upstream-req-1",
    });
    assert.ok(response.body.meta.serverNow);
  } finally {
    restore();
  }
});

test("errorHandler preserves custom uppercase HttpError codes on versioned requests", () => {
  const { module: handlers, restore } = loadErrorHandler();

  try {
    const response = buildResponse();
    const { HttpError } = require("../src/lib/http-error");
    const error = new HttpError(
      400,
      "You must keep a verified password or another linked OAuth provider."
    );
    error.code = "OAUTH_LAST_LOGIN_METHOD";

    handlers.errorHandler(
      error,
      {
        requestId: "request-1",
        method: "POST",
        originalUrl: "/api/v1/auth/oauth/google/link",
      },
      response,
      () => {}
    );

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, error.message);
    assert.equal(response.body.error.code, "OAUTH_LAST_LOGIN_METHOD");
    assert.equal(response.body.error.message, error.message);
  } finally {
    restore();
  }
});

test("errorHandler keeps the generic 500 envelope for unmapped errors carrying no numeric status", () => {
  const { module: handlers, restore } = loadErrorHandler();

  try {
    const response = buildResponse();

    handlers.errorHandler(
      { code: "P2002", message: "Unique constraint failed" },
      {
        requestId: "request-1",
        method: "POST",
        originalUrl: "/api/v1/admin/valorant/teams/bind",
      },
      response,
      () => {}
    );

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.error.code, "internal_error");
  } finally {
    restore();
  }
});
