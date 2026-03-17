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
          registrationCount: { type: "integer" },
          maxTeams: { type: "integer" },
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
  },
  "x-quest-operations": {
    monitoring: monitoringStatus(),
    suggestedBackgroundJobs: suggestedJobBackends,
  },
};

module.exports = {
  openApiDocument,
};
