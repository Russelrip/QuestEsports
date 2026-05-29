const { env } = require("../config/env");
const { monitoringStatus } = require("./monitoring");
const { suggestedJobBackends } = require("./jobs");

const apiBaseUrl = env.CORS_ORIGINS[0] || "http://localhost:5001";

const createQueryParameter = (name, schema) => ({
  name,
  in: "query",
  schema,
});

const createPathParameter = (name, schema) => ({
  name,
  in: "path",
  required: true,
  schema,
});

const createResponse = (description) => ({ description });

const createListResponse = (tag, summary, parameters = []) => ({
  get: {
    tags: [tag],
    summary,
    parameters,
    responses: {
      200: createResponse(summary),
    },
  },
});

const pageParameter = createQueryParameter("page", {
  type: "integer",
  minimum: 1,
  default: 1,
});

const pageSizeParameter = createQueryParameter("pageSize", {
  type: "integer",
  minimum: 1,
  maximum: 50,
  default: 10,
});

const searchParameter = createQueryParameter("search", { type: "string" });

const registrationRequestBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: [
          "teamName",
          "captainName",
          "captainEmail",
          "captainPhone",
          "captainDiscord",
          "captainRiotId",
          "contactEmail",
          "tournamentSlug",
        ],
        properties: {
          tournamentSlug: { type: "string" },
          teamName: { type: "string" },
          teamLogo: { type: "string", format: "binary" },
          captainName: { type: "string" },
          captainEmail: { type: "string" },
          captainPhone: { type: "string" },
          captainDiscord: { type: "string" },
          captainRiotId: { type: "string" },
          contactEmail: { type: "string" },
        },
      },
    },
  },
};

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Quest Esports API",
    version: "1.0.0",
    description:
      "Core contracts for auth, tournaments, registrations, and admin workflows.",
  },
  servers: [{ url: apiBaseUrl }],
  tags: [
    { name: "System" },
    { name: "Auth" },
    { name: "Tournaments" },
    { name: "Registrations" },
    { name: "Admin" },
  ],
  components: {
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
          registrationCount: { type: "integer" },
          maxTeams: { type: "integer" },
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
  },
  paths: {
    "/api/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: {
          200: createResponse("API health payload"),
        },
      },
    },
    "/api/openapi.json": {
      get: {
        tags: ["System"],
        summary: "OpenAPI contract document",
        responses: {
          200: createResponse("OpenAPI JSON"),
        },
      },
    },
    "/api/tournaments": createListResponse("Tournaments", "List public tournaments", [
      createQueryParameter("game", { type: "string" }),
    ]),
    "/api/tournament-registration/status/{slug}": {
      get: {
        tags: ["Registrations"],
        summary: "Check whether the current user already registered",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: {
          200: createResponse("Registration status result"),
        },
      },
    },
    "/api/tournament-registration": {
      post: {
        tags: ["Registrations"],
        summary: "Submit a tournament registration",
        requestBody: registrationRequestBody,
        responses: {
          201: createResponse("Registration submitted"),
        },
      },
    },
    "/api/admin/tournaments": createListResponse("Admin", "List tournaments for admins", [
      { $ref: "#/components/parameters/Page" },
      { $ref: "#/components/parameters/PageSize" },
      { $ref: "#/components/parameters/Search" },
      createQueryParameter("status", { type: "string" }),
      createQueryParameter("isPublished", { type: "boolean" }),
    ]),
    "/api/admin/team-registrations": createListResponse(
      "Admin",
      "List team registrations for admins",
      [
        { $ref: "#/components/parameters/Page" },
        { $ref: "#/components/parameters/PageSize" },
        { $ref: "#/components/parameters/Search" },
      ]
    ),
    "/api/admin/tournaments/{tournamentId}/bracket": {
      get: {
        tags: ["Admin"],
        summary: "Get a tournament's native bracket",
        parameters: [createPathParameter("tournamentId", { type: "string" })],
        responses: {
          200: createResponse("Tournament bracket payload"),
        },
      },
    },
    "/api/admin/tournaments/{tournamentId}/bracket/generate": {
      post: {
        tags: ["Admin"],
        summary: "Generate a native double-elimination bracket from approved teams",
        parameters: [createPathParameter("tournamentId", { type: "string" })],
        responses: {
          201: createResponse("Generated tournament bracket"),
        },
      },
    },
    "/api/admin/tournaments/{tournamentId}/bracket/matches/{matchId}": {
      patch: {
        tags: ["Admin"],
        summary: "Update a native bracket match result",
        parameters: [
          createPathParameter("tournamentId", { type: "string" }),
          createPathParameter("matchId", { type: "integer" }),
        ],
        responses: {
          200: createResponse("Updated tournament bracket"),
        },
      },
    },
    "/api/admin/tournaments/{tournamentId}/bracket/publish": {
      patch: {
        tags: ["Admin"],
        summary: "Publish or unpublish a native bracket",
        parameters: [createPathParameter("tournamentId", { type: "string" })],
        responses: {
          200: createResponse("Updated bracket publication state"),
        },
      },
    },
  },
  "x-quest-operations": {
    monitoring: monitoringStatus(),
    suggestedBackgroundJobs: suggestedJobBackends,
  },
};

module.exports = {
  openApiDocument,
};
