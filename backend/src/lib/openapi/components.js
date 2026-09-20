// Shared schemas for the OpenAPI document.
const { env } = require("../../config/env");
const { pageParameter, pageSizeParameter, searchParameter } = require("./helpers");

const components = {
  securitySchemes: {
    sessionCookie: {
      type: "apiKey",
      in: "cookie",
      name: env.SESSION_COOKIE_NAME,
      description:
        "HttpOnly session cookie issued by the login or OAuth flow.",
    },
    mobileBearer: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "opaque-session-token",
      description:
        "Revocable bearer session issued by Quest Admin mobile login.",
    },
  },
  parameters: {
    Page: pageParameter,
    PageSize: pageSizeParameter,
    Search: searchParameter,
  },
  schemas: {
    ApiError: {
      type: "object",
      properties: {
        success: { type: "boolean", const: false },
        message: { type: "string" },
        details: {},
      },
    },
    Pagination: {
      type: "object",
      properties: {
        page: { type: "integer" },
        pageSize: { type: "integer" },
        total: { type: "integer" },
        totalPages: { type: "integer" },
      },
    },
    Tournament: {
      type: "object",
      properties: {
        id: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        game: { type: "string" },
        status: { type: "string" },
        isPublished: { type: "boolean" },
        registrationState: { type: "string" },
        registrationOpenAt: { type: ["string", "null"], format: "date-time" },
        startDate: { type: ["string", "null"], format: "date-time" },
        startDateStatus: {
          type: "string",
          enum: ["scheduled", "tba", "tbd"],
        },
        endDate: { type: ["string", "null"], format: "date-time" },
        endDateStatus: { type: "string", enum: ["scheduled", "tba", "tbd"] },
        registrationDeadline: {
          type: ["string", "null"],
          format: "date-time",
        },
        registrationDeadlineStatus: {
          type: "string",
          enum: ["scheduled", "tba", "tbd"],
        },
        registrationCount: { type: "integer" },
        // Null when the tournament has no slot ceiling.
        maxTeams: { type: "integer", nullable: true },
      },
    },
    TournamentBracket: {
      type: "object",
      properties: {
        id: { type: "string" },
        tournamentId: { type: "string" },
        format: { type: "string" },
        status: { type: "string", enum: ["draft", "published"] },
        seedData: { type: "array", items: { type: "object" } },
        bracketData: { type: "object" },
        summary: { type: "object" },
        generatedAt: { type: "string", format: "date-time" },
        publishedAt: { type: ["string", "null"], format: "date-time" },
        lastUpdatedAt: { type: "string", format: "date-time" },
      },
    },
    TeamRegistration: {
      type: "object",
      properties: {
        id: { type: "string" },
        teamName: { type: "string" },
        status: { type: "string" },
        paymentStatus: { type: "string" },
        verificationStatus: { type: "string" },
        contactEmail: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  },
};

module.exports = { components };
