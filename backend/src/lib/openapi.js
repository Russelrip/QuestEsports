const { env } = require("../config/env");
const { monitoringStatus } = require("./monitoring");
const { suggestedJobBackends } = require("./jobs");
const { PERMISSION_SCOPES } = require("../modules/permissions/permission.middleware");

const apiBaseUrl = env.API_PUBLIC_URL || `http://localhost:${env.PORT}`;

const createQueryParameter = (name, schema, description) => ({
  name,
  in: "query",
  schema,
  ...(description ? { description } : {}),
});

const createPathParameter = (name, schema) => ({
  name,
  in: "path",
  required: true,
  schema,
});

const createHeaderParameter = (
  name,
  schema,
  { required = false, description } = {},
) => ({
  name,
  in: "header",
  required,
  schema,
  ...(description ? { description } : {}),
});

const createResponse = (description) => ({ description });
const oauthProviderParameter = createPathParameter("provider", {
  type: "string",
  enum: ["google", "discord"],
});
const oauthRedirectResponse = (description) => ({
  description,
  headers: {
    Location: {
      required: true,
      schema: { type: "string", format: "uri-reference" },
    },
    "Set-Cookie": {
      required: true,
      schema: { type: "string" },
      description: "OAuth flow cookie or its expiry cookie; never a session cookie.",
    },
  },
});
const linkedProvidersSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["provider", "linked"],
    properties: {
      provider: { type: "string", enum: ["google", "discord"] },
      linked: { type: "boolean" },
    },
  },
};
const linkedProvidersResponse = {
  description: "Current OAuth provider link state",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["success", "providers"],
        properties: {
          success: { type: "boolean", const: true },
          providers: linkedProvidersSchema,
        },
      },
    },
  },
};
const createOperation = (
  tag,
  summary,
  {
    authenticated = false,
    parameters = [],
    additionalResponses = {},
    permissionScopes = [],
    requiredGlobalRole,
    permissionDescription,
  } = {},
) => ({
  tags: [tag],
  summary,
  ...(permissionDescription ? { description: permissionDescription } : {}),
  parameters,
  ...(permissionScopes.length ? { "x-required-permission-scopes": permissionScopes } : {}),
  ...(requiredGlobalRole ? { "x-required-global-role": requiredGlobalRole } : {}),
  ...(authenticated
    ? { security: [{ sessionCookie: [] }, { mobileBearer: [] }] }
    : {}),
  responses: {
    200: createResponse(summary),
    ...(authenticated
      ? { 401: createResponse("Authentication required") }
      : {}),
    ...(permissionScopes.length ? { 403: createResponse("Insufficient permission scope") } : {}),
    400: createResponse("Invalid request"),
    ...additionalResponses,
  },
});

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

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Quest E-sports API",
    version: "2.0.0",
    description:
      "Core contracts for auth, tournament series, configurable registrations, PayHere payments, merchandise, admin workflows, and readiness including the shared clustered realtime transport when enabled.",
  },
  servers: [{ url: apiBaseUrl }],
  tags: [
    { name: "System" },
    { name: "Auth" },
    { name: "Tournaments" },
    { name: "Registrations" },
    { name: "Series" },
    { name: "Shop" },
    { name: "Tickets" },
    { name: "Payments" },
    { name: "Account" },
    { name: "Contact" },
    { name: "Recruitment" },
    { name: "Games" },
    { name: "Rulebooks" },
    { name: "Media" },
    { name: "Teams" },
    { name: "Admin" },
    { name: "Match Rooms" },
    { name: "Notifications" },
    { name: "Support" },
  ],
  components: {
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
        summary: "Database, storage, and clustered realtime readiness check when enabled",
        responses: {
          200: createResponse("API health payload"),
        },
      },
    },
    "/api/health/live": {
      get: createOperation("System", "Process liveness check"),
    },
    "/api/health/ready": {
      get: createOperation(
        "System",
        "Database, storage, and clustered realtime readiness check when enabled",
      ),
    },
    "/api/capabilities": {
      get: createOperation("System", "Frontend deployment compatibility capabilities"),
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
    "/api/auth/google/start": {
      get: createOperation("Auth", "Start Google OAuth login"),
    },
    "/api/auth/google/callback": {
      get: createOperation("Auth", "Complete Google OAuth login"),
    },
    "/api/auth/discord/start": {
      get: createOperation("Auth", "Start Discord OAuth login"),
    },
    "/api/auth/discord/callback": {
      get: createOperation("Auth", "Complete Discord OAuth login"),
    },
    "/api/signup": { post: createOperation("Auth", "Create an account") },
    "/api/login": {
      post: createOperation("Auth", "Create a password-authenticated session"),
    },
    "/api/mobile/auth/login": {
      post: createOperation(
        "Auth",
        "Sign in to the mobile admin app and issue a bearer session",
      ),
    },
    "/api/mobile/auth/oauth/google/start": {
      get: createOperation(
        "Auth",
        "Start Google sign-in for the mobile admin app",
      ),
    },
    "/api/mobile/auth/oauth/discord/start": {
      get: createOperation(
        "Auth",
        "Start Discord sign-in for the mobile admin app",
      ),
    },
    "/api/mobile/auth/oauth/exchange": {
      post: createOperation(
        "Auth",
        "Exchange a one-time mobile OAuth grant for a bearer session",
      ),
    },
    "/api/mobile/auth/logout": {
      post: createOperation(
        "Auth",
        "Revoke the current mobile bearer session",
        { authenticated: true },
      ),
    },
    "/api/mobile/auth/me": {
      get: createOperation("Account", "Get the current mobile admin session", {
        authenticated: true,
      }),
    },
    "/api/logout": {
      post: createOperation("Auth", "End the current session", {
        authenticated: true,
      }),
    },
    "/api/me": {
      get: createOperation("Account", "Get the current session", {
        authenticated: true,
      }),
    },
    "/api/email-verification/verify": {
      get: createOperation("Auth", "Verify an email token"),
    },
    "/api/email-verification/resend": {
      post: createOperation("Auth", "Resend email verification"),
    },
    "/api/email-change/request": {
      post: createOperation("Account", "Request an email address change", {
        authenticated: true,
      }),
    },
    "/api/email-change/confirm": {
      get: createOperation("Auth", "Confirm an email address change"),
    },
    "/api/forgot-password": {
      post: createOperation("Auth", "Request a password reset"),
    },
    "/api/reset-password": {
      post: createOperation("Auth", "Reset a password with a token"),
    },
    "/api/sessions": {
      get: createOperation("Account", "List active sessions", {
        authenticated: true,
      }),
    },
    "/api/sessions/{sessionId}": {
      delete: createOperation("Account", "Revoke a session", {
        authenticated: true,
        parameters: [createPathParameter("sessionId", { type: "string" })],
      }),
    },
    "/api/sessions/revoke-others": {
      post: createOperation("Account", "Revoke other sessions", {
        authenticated: true,
      }),
    },
    "/api/change-password": {
      post: createOperation("Account", "Change the current password", {
        authenticated: true,
      }),
    },
    "/api/users/{userId}": {
      get: createOperation("Account", "Get an authenticated user profile", {
        authenticated: true,
        parameters: [createPathParameter("userId", { type: "string" })],
      }),
      patch: createOperation("Account", "Update the current user profile", {
        authenticated: true,
        parameters: [createPathParameter("userId", { type: "string" })],
      }),
    },
    "/api/tournaments": createListResponse(
      "Tournaments",
      "List public tournaments",
      [createQueryParameter("game", { type: "string" })],
    ),
    "/api/tournaments/{slug}": {
      get: {
        tags: ["Tournaments"],
        summary:
          "Get tournament detail, schedule, participants, and published bracket",
        parameters: [
          createPathParameter("slug", { type: "string" }),
          createQueryParameter("participantPage", { type: "integer", minimum: 1 }),
          createQueryParameter("participantPageSize", { type: "integer", minimum: 1, maximum: 50 }),
        ],
        responses: { 200: createResponse("Tournament detail") },
      },
    },
    "/api/event-series": createListResponse(
      "Series",
      "List published event series",
    ),
    "/api/event-series/{slug}": {
      get: {
        tags: ["Series"],
        summary: "Get a published event series and child tournaments",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: { 200: createResponse("Event series detail") },
      },
    },
    "/api/products": createListResponse(
      "Shop",
      "List active merchandise products",
    ),
    "/api/products/{slug}": {
      get: {
        tags: ["Shop"],
        summary: "Get active product and variants",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: { 200: createResponse("Product detail") },
      },
    },
    "/api/commerce/capabilities": {
      get: {
        tags: ["Shop"],
        summary: "Get payment and checkout availability",
        responses: { 200: createResponse("Commerce capabilities") },
      },
    },
    "/api/orders/quote": {
      post: {
        tags: ["Shop"],
        summary: "Calculate an authoritative merchandise quote",
        responses: { 200: createResponse("Current cart quote") },
      },
    },
    "/api/orders": {
      post: {
        tags: ["Shop"],
        summary: "Create a merchandise order and signed PayHere checkout",
        responses: { 201: createResponse("Order and checkout payload") },
      },
    },
    "/api/orders/status": {
      get: {
        tags: ["Shop"],
        summary: "Get order status using the private X-Order-Token header",
        parameters: [
          createHeaderParameter(
            "X-Order-Token",
            { type: "string", pattern: "^[a-fA-F0-9]{48}$" },
            { required: true, description: "Private order capability" },
          ),
        ],
        responses: { 200: createResponse("Order status") },
      },
    },
    "/api/payments/payhere/notify": {
      post: {
        tags: ["Payments"],
        summary: "Receive and verify an authoritative PayHere notification",
        responses: { 200: createResponse("Notification accepted") },
      },
    },
    "/api/payments/{orderId}": {
      get: {
        tags: ["Payments"],
        summary: "Get locally verified payment status",
        parameters: [
          createPathParameter("orderId", { type: "string" }),
          createHeaderParameter(
            "X-Order-Token",
            { type: "string", pattern: "^[a-fA-F0-9]{48}$" },
            {
              description:
                "Private merchandise-order capability; omit for an authenticated owner",
            },
          ),
          {
            ...createQueryParameter("token", { type: "string" }),
            deprecated: true,
            description: "Legacy capability transport",
          },
        ],
        responses: { 200: createResponse("Payment status") },
      },
    },
    "/api/me/dashboard": createListResponse(
      "Account",
      "Get current and past registrations, teams, and orders",
    ),
    "/api/me/avatar": {
      post: {
        tags: ["Account"],
        summary: "Upload or replace the authenticated user's avatar",
        responses: { 200: createResponse("Updated user") },
      },
      delete: {
        tags: ["Account"],
        summary: "Remove the authenticated user's avatar",
        responses: { 200: createResponse("Updated user") },
      },
    },
    "/api/tournaments/{slug}/registrations": {
      post: {
        tags: ["Registrations"],
        summary: "Submit a slug-bound configurable solo or team registration",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: {
          201: createResponse("Registration and optional checkout payload"),
        },
      },
      delete: {
        tags: ["Registrations"],
        summary: "Cancel the current captain's unpaid registration",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: { 200: createResponse("Registration cancelled") },
      },
    },
    "/api/tournaments/{slug}/registration-status": {
      get: {
        tags: ["Registrations"],
        summary: "Check whether the current user already registered",
        parameters: [createPathParameter("slug", { type: "string" })],
        responses: {
          200: createResponse("Registration status result"),
        },
      },
    },
    "/api/events": createListResponse(
      "Series",
      "List published events",
    ),
    "/api/events/{slug}": {
      get: createOperation("Series", "Get a published event and child tournaments", {
        parameters: [createPathParameter("slug", { type: "string" })],
      }),
    },
    "/api/admin/tournaments": createListResponse(
      "Admin",
      "List tournaments for admins",
      [
        { $ref: "#/components/parameters/Page" },
        { $ref: "#/components/parameters/PageSize" },
        { $ref: "#/components/parameters/Search" },
        createQueryParameter("status", { type: "string" }),
        createQueryParameter("isPublished", { type: "boolean" }),
      ],
    ),
    "/api/admin/event-series": createListResponse(
      "Admin",
      "List and manage event series",
    ),
    "/api/admin/products": createListResponse(
      "Admin",
      "List and manage merchandise products",
    ),
    "/api/admin/orders": createListResponse(
      "Admin",
      "List and manage merchandise orders",
    ),
    "/api/admin/payments": createListResponse(
      "Admin",
      "Reconcile payment transactions",
      [
        createQueryParameter("status", { type: "string" }),
        createQueryParameter("purpose", { type: "string" }),
      ],
    ),
    "/api/admin/payments/{transactionId}/payhere-reconciliation": {
      patch: {
        tags: ["Admin"],
        summary: "Resolve a late PayHere payment after external verification",
        responses: { 200: createResponse("Payment reconciled") },
      },
    },
    "/api/admin/team-registrations": createListResponse(
      "Admin",
      "List team registrations for admins",
      [
        { $ref: "#/components/parameters/Page" },
        { $ref: "#/components/parameters/PageSize" },
        { $ref: "#/components/parameters/Search" },
      ],
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
        summary:
          "Generate a native double-elimination bracket from approved teams",
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

const idParameter = (name) => [createPathParameter(name, { type: "string" })];
const additionalPaths = {
  "/api/ticket-events": {
    get: createOperation("Tickets", "List public ticketed events"),
  },
  "/api/ticket-events/{slug}": {
    get: createOperation("Tickets", "Get a ticketed event", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/ticket-events/{slug}/quote": {
    post: createOperation(
      "Tickets",
      "Calculate authoritative bundle ticket pricing",
      { parameters: idParameter("slug") },
    ),
  },
  "/api/ticket-events/{slug}/orders": {
    post: createOperation(
      "Tickets",
      "Reserve capacity and create a signed ticket checkout",
      { parameters: idParameter("slug") },
    ),
  },
  "/api/ticket-orders/status": {
    get: createOperation(
      "Tickets",
      "Get a private ticket order and issued QR codes",
      {
        parameters: [
          createHeaderParameter(
            "X-Ticket-Order-Token",
            { type: "string", pattern: "^[a-fA-F0-9]{48}$" },
            { required: true, description: "Private ticket-order capability" },
          ),
        ],
      },
    ),
  },
  "/api/admin/ticket-events": {
    get: createOperation("Admin", "List grouped ticketed events", {
      authenticated: true,
    }),
    post: createOperation("Admin", "Create a ticketed event", {
      authenticated: true,
    }),
  },
  "/api/admin/ticket-events/{eventId}": {
    get: createOperation("Admin", "Get ticketed event metrics", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
    patch: createOperation("Admin", "Update a ticketed event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/ticket-events/{eventId}/orders": {
    get: createOperation("Admin", "List ticket orders for one event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/ticket-events/{eventId}/tickets": {
    get: createOperation("Admin", "List issued tickets for one event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/ticket-events/{eventId}/report": {
    get: createOperation(
      "Admin",
      "Export an event ticket and attendance report",
      { authenticated: true, parameters: idParameter("eventId") },
    ),
  },
  "/api/admin/ticket-events/{eventId}/scan": {
    post: createOperation(
      "Admin",
      "Verify and atomically check in a QR ticket",
      { authenticated: true, parameters: idParameter("eventId") },
    ),
  },
  "/api/admin/ticket-events/{eventId}/tickets/{ticketId}/check-in": {
    post: createOperation("Admin", "Manually check in an issued ticket", {
      authenticated: true,
      parameters: [...idParameter("eventId"), ...idParameter("ticketId")],
    }),
  },
  "/api/admin/tickets/{ticketId}/reissue": {
    post: createOperation("Admin", "Rotate an issued ticket QR code", {
      authenticated: true,
      parameters: idParameter("ticketId"),
    }),
  },
  "/api/admin/tickets/{ticketId}": {
    patch: createOperation("Admin", "Cancel or restore an issued ticket", {
      authenticated: true,
      parameters: idParameter("ticketId"),
    }),
  },
  "/api/v1/home": {
    get: createOperation(
      "Foundation",
      "Get the cached homepage tournament and live-match feed",
    ),
  },
  "/api/v1/tournaments/{slug}": {
    get: createOperation("Foundation", "Get slim versioned tournament detail", {
      parameters: [
        ...idParameter("slug"),
        createQueryParameter("participantPage", { type: "integer", minimum: 1 }),
        createQueryParameter("participantPageSize", { type: "integer", minimum: 1, maximum: 50 }),
      ],
    }),
  },
  "/api/v1/tournaments/{slug}/bracket": {
    get: createOperation(
      "Brackets",
      "Get the authoritative Challonge or native bracket snapshot",
      { parameters: idParameter("slug") },
    ),
  },
  "/api/v1/tournaments/{slug}/matches": {
    get: createOperation("Matches", "List a tournament's public matches", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/v1/matches": {
    get: createOperation("Matches", "List paginated public matches"),
  },
  "/api/v1/tournaments/{slug}/results": {
    get: createOperation("Matches", "List a tournament's public VALORANT results", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/anchors": {
    get: createOperation("Valorant", "Derive discovery anchors from approved rosters", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/fixtures": {
    get: createOperation("Valorant", "List bracket fixtures with their derived anchors", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/fixtures/{matchId}/discover": {
    post: createOperation("Valorant", "Propose matches for one fixture using derived anchors", {
      authenticated: true,
      parameters: [...idParameter("tournamentId"), ...idParameter("matchId")],
    }),
  },
  "/api/v1/valorant/series/{seriesId}": {
    get: createOperation("Matches", "Get a public VALORANT match scoreboard", {
      parameters: idParameter("seriesId"),
    }),
  },
  "/api/v1/matches/next": {
    get: createOperation(
      "Matches",
      "Get the next public or authenticated-user match",
    ),
  },
  "/api/v1/events": {
    get: {
      tags: ["Realtime"],
      summary: "Subscribe to public and authorized private invalidation events",
      description:
        "Subscribe to public topics such as matches and brackets, or to authorized user:{userId} and match-room:{code} topics. Events are invalidation hints that trigger a refresh of persisted state; shared transport recovery also sends a public reconciliation update. This endpoint provides no durable replay.",
      security: [{ sessionCookie: [] }, {}],
      parameters: [
        createQueryParameter(
          "topics",
          { type: "string", default: "matches,brackets" },
          "Comma-separated public topics or authorized private topics (user:{userId} and match-room:{code}). Exact topics and their public roots are supported.",
        ),
      ],
      responses: {
        200: {
          description: "SSE stream of invalidation hints",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        204: createResponse("Realtime disabled; EventSource must not reconnect"),
        401: createResponse("Authentication required for private match-room topics"),
        403: createResponse("The requested private topic is not authorized"),
        429: createResponse("Too many live-update connections"),
        503: createResponse("Clustered realtime transport is unavailable; retry later"),
      },
    },
  },
  "/api/v1/match-rooms/mine": {
    get: createOperation("Match Rooms", "List the signed-in user's match rooms", { authenticated: true }),
  },
  "/api/v1/match-rooms/{code}": {
    get: createOperation("Match Rooms", "Get an authorized match-room snapshot", { authenticated: true, parameters: idParameter("code") }),
  },
  "/api/v1/match-rooms/{code}/messages": {
    get: createOperation("Match Rooms", "List paginated match-room messages", { authenticated: true, parameters: idParameter("code") }),
    post: createOperation("Match Rooms", "Send a player or official match-room message", { authenticated: true, parameters: idParameter("code") }),
  },
  "/api/v1/match-rooms/{code}/read": {
    patch: createOperation("Match Rooms", "Advance the member's room read cursor", { authenticated: true, parameters: idParameter("code") }),
  },
  "/api/v1/match-rooms/{code}/support": {
    get: createOperation("Match Rooms", "List visible match-support requests", { authenticated: true, parameters: idParameter("code") }),
    post: createOperation("Match Rooms", "Open a private match-support request", { authenticated: true, parameters: idParameter("code") }),
  },
  "/api/v1/match-rooms/{code}/support/{requestId}/messages": {
    post: createOperation("Match Rooms", "Reply to a match-support request", { authenticated: true, parameters: [...idParameter("code"), ...idParameter("requestId")] }),
  },
  "/api/v1/match-rooms/{code}/support/{requestId}/resolve": {
    post: createOperation("Match Rooms", "Resolve a match-support request", { authenticated: true, parameters: [...idParameter("code"), ...idParameter("requestId")] }),
  },
  "/api/v1/match-rooms/{code}/messages/{messageId}/hide": {
    post: createOperation("Match Rooms", "Hide a room message with an audit reason", { authenticated: true, parameters: [...idParameter("code"), ...idParameter("messageId")] }),
  },
  "/api/v1/match-rooms/{code}/members/{memberId}/mute": {
    patch: createOperation("Match Rooms", "Mute or unmute a room member", { authenticated: true, parameters: [...idParameter("code"), ...idParameter("memberId")] }),
  },
  "/api/v1/match-rooms/{code}/chat-lock": {
    patch: createOperation("Match Rooms", "Lock or unlock match-room chat", { authenticated: true, parameters: idParameter("code") }),
  },
  "/api/v1/auth/oauth/providers": {
    get: {
      tags: ["Auth"],
      summary: "List the signed-in user's linked OAuth providers",
      security: [{ sessionCookie: [] }, { mobileBearer: [] }],
      responses: {
        200: linkedProvidersResponse,
        401: createResponse("Authentication required"),
      },
    },
  },
  "/api/v1/auth/oauth/{provider}/link": {
    get: {
      tags: ["Auth"],
      summary: "Start an authenticated OAuth account-link flow",
      security: [{ sessionCookie: [] }, { mobileBearer: [] }],
      parameters: [oauthProviderParameter],
      responses: {
        302: oauthRedirectResponse("Redirect to the OAuth provider authorization page"),
        400: createResponse("Unsupported OAuth provider"),
        401: createResponse("Authentication required"),
        503: createResponse("OAuth provider is not configured"),
      },
    },
  },
  "/api/v1/auth/oauth/{provider}/link/callback": {
    get: {
      tags: ["Auth"],
      summary: "Complete an authenticated OAuth account-link flow",
      security: [{ sessionCookie: [] }, { mobileBearer: [] }],
      parameters: [
        oauthProviderParameter,
        { ...createQueryParameter("code", { type: "string" }), required: true },
        { ...createQueryParameter("state", { type: "string" }), required: true },
      ],
      responses: {
        302: oauthRedirectResponse("Redirect to the profile account-linking result"),
        400: createResponse("Unsupported OAuth provider"),
        401: createResponse("Authentication required"),
      },
    },
  },
  "/api/v1/auth/oauth/{provider}": {
    delete: {
      tags: ["Auth"],
      summary: "Unlink an OAuth provider from the signed-in account",
      security: [{ sessionCookie: [] }, { mobileBearer: [] }],
      parameters: [oauthProviderParameter],
      responses: {
        200: linkedProvidersResponse,
        400: createResponse("Unsupported provider or last login method"),
        401: createResponse("Authentication required"),
        404: createResponse("OAuth provider is not linked"),
        409: createResponse("OAuth provider conflict"),
      },
    },
  },
  "/api/v1/support/conversations": {
    get: createOperation("Support", "List the signed-in user's support conversations", {
      authenticated: true,
      parameters: [
        createQueryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
        createQueryParameter("cursor", { type: "string", format: "date-time" }),
      ],
    }),
    post: createOperation("Support", "Create a support conversation", { authenticated: true }),
  },
  "/api/v1/support/conversations/{conversationId}": {
    get: createOperation("Support", "Get an owned support conversation and its messages", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/support/conversations/{conversationId}/messages": {
    post: createOperation("Support", "Reply to an owned support conversation", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/support/conversations/{conversationId}/read": {
    patch: createOperation("Support", "Mark an owned support conversation read", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/support/conversations/{conversationId}/resolve": {
    post: createOperation("Support", "Resolve an owned support conversation", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/support/conversations/{conversationId}/reopen": {
    post: createOperation("Support", "Reopen an owned support conversation", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/admin/support/conversations": {
    get: createOperation("Support", "List the staff support queue", {
      authenticated: true,
      parameters: [
        createQueryParameter("status", { type: "string", enum: ["OPEN", "PENDING_USER", "PENDING_STAFF", "RESOLVED"] }),
        createQueryParameter("assigned", { type: "string" }),
        createQueryParameter("search", { type: "string" }),
        createQueryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
        createQueryParameter("cursor", { type: "string", format: "date-time" }),
      ],
    }),
  },
  "/api/v1/admin/support/conversations/{conversationId}": {
    get: createOperation("Support", "Get any support conversation for staff", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/admin/support/conversations/{conversationId}/read": {
    patch: {
      ...createOperation("Support", "Mark a support conversation read for the signed-in staff member", {
        authenticated: true,
        parameters: idParameter("conversationId"),
      }),
      "x-required-role": "admin",
    },
  },
  "/api/v1/admin/support/conversations/{conversationId}/assignment": {
    patch: createOperation("Support", "Assign or unassign a support conversation", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/admin/support/conversations/{conversationId}/messages": {
    post: createOperation("Support", "Reply to a support conversation as staff", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/admin/support/conversations/{conversationId}/status": {
    patch: createOperation("Support", "Change a support conversation status as staff", {
      authenticated: true,
      parameters: idParameter("conversationId"),
    }),
  },
  "/api/v1/notifications": {
    get: createOperation("Notifications", "List in-app notifications and delivery preferences", { authenticated: true }),
  },
  "/api/v1/notifications/read-all": {
    patch: createOperation("Notifications", "Mark every in-app notification read", { authenticated: true }),
  },
  "/api/v1/notifications/{id}/read": {
    patch: createOperation("Notifications", "Mark one in-app notification read", { authenticated: true, parameters: idParameter("id") }),
  },
  "/api/v1/notifications/push-subscriptions": {
    post: createOperation("Notifications", "Register a browser push subscription", { authenticated: true }),
    delete: createOperation("Notifications", "Revoke a browser push subscription", { authenticated: true }),
  },
  "/api/v1/notifications/preferences": {
    patch: createOperation("Notifications", "Update match-notification preferences", { authenticated: true }),
  },
  "/api/v1/veto-rooms/mine": {
    get: createOperation("Veto", "List the signed-in captain's active veto rooms", { authenticated: true }),
  },
  "/api/v1/veto-rooms/{code}": {
    get: createOperation("Veto", "Get an authorized live or published veto room", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/ready": {
    post: createOperation("Veto", "Set team readiness using account or role-link authority", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/toss": {
    post: createOperation("Veto", "Call and atomically resolve a digital Heads or Tails toss", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/team-a": {
    post: createOperation("Veto", "Let the toss winner choose Team A or Team B and start the veto", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/actions": {
    post: createOperation("Veto", "Commit the current authorized ban, pick, or side choice", { parameters: idParameter("code") }),
  },
  "/api/v1/admin/veto/catalog": {
    get: createOperation("Veto", "List maps, versioned pools, presets, and room templates", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: [createQueryParameter(
        "tournamentId",
        { type: "string" },
        "Optional; omit it for global catalog reads, or provide it to scope the catalog to a tournament.",
      )],
    }),
  },
  "/api/v1/admin/veto/maps": {
    post: createOperation("Veto", "Create a map in the veto catalog", { authenticated: true }),
  },
  "/api/v1/admin/veto/maps/{id}": {
    patch: createOperation("Veto", "Enable or disable a map in the veto catalog", { authenticated: true, parameters: idParameter("id") }),
  },
  "/api/v1/admin/veto/pools": {
    post: createOperation("Veto", "Create a versioned map pool", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/veto/presets": {
    post: createOperation("Veto", "Create a versioned veto rule preset", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/veto/templates": {
    post: createOperation("Veto", "Save a reusable room template", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/tournaments/{id}/veto-config": {
    get: createOperation("Veto", "Get a tournament's default veto configuration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: idParameter("id"),
    }),
    put: createOperation("Veto", "Set a tournament's default veto configuration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/veto-rooms": {
    get: createOperation("Veto", "List veto rooms available to staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: [createQueryParameter(
        "tournamentId",
        { type: "string" },
        "Optional; without it, the service returns rooms for the authenticated staff assignments.",
      )],
    }),
    post: createOperation("Veto", "Create a linked or standalone veto room", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS],
    }),
  },
  "/api/v1/admin/veto-rooms/{roomId}": {
    get: createOperation("Veto", "Get a veto room for staff operation", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: idParameter("roomId"),
    }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/start": {
    post: createOperation("Veto", "Start or force-start the toss/veto lifecycle", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/open": {
    post: createOperation("Veto", "Open a room for team readiness", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/assign-team-a": {
    post: createOperation("Veto", "Manually assign Team A and Team B", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/manual-toss": {
    post: createOperation("Veto", "Record the result of a physical coin toss", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/rewind": {
    post: createOperation("Veto", "Audit and rewind the latest committed veto action", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/reset": {
    post: createOperation("Veto", "Audit and reset a room to its pre-veto state", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/cancel": {
    post: createOperation("Veto", "Cancel an active veto room", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/rotate-link": {
    post: createOperation("Veto", "Rotate a private team or viewer access link", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/tournaments/{id}/challonge": {
    get: createOperation("Challonge", "Get Challonge integration status", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
    patch: createOperation("Challonge", "Configure a Challonge integration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/sync": {
    post: createOperation("Challonge", "Synchronize a Challonge tournament", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/logs": {
    get: createOperation("Challonge", "List sanitized synchronization logs", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participants": {
    post: createOperation(
      "Challonge",
      "Create a participant in a connected Challonge tournament",
      { authenticated: true, permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION], parameters: idParameter("id") },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participants/{participantId}": {
    put: createOperation("Challonge", "Update a participant in Challonge", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: [...idParameter("id"), ...idParameter("participantId")],
    }),
    delete: createOperation(
      "Challonge",
      "Delete or deactivate a participant in Challonge",
      {
        authenticated: true,
        permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
        parameters: [...idParameter("id"), ...idParameter("participantId")],
      },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participant-mappings/{participantId}":
    {
      patch: createOperation(
        "Challonge",
        "Confirm an external participant mapping",
        {
          authenticated: true,
          permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
          parameters: [...idParameter("id"), ...idParameter("participantId")],
        },
      ),
    },
  "/api/v1/admin/tournaments/{id}/challonge/state": {
    put: createOperation(
      "Challonge",
      "Change the connected Challonge tournament state",
      { authenticated: true, permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION], parameters: idParameter("id") },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/matches/{matchId}": {
    put: createOperation("Challonge", "Report a Challonge match result", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: [...idParameter("id"), ...idParameter("matchId")],
    }),
  },
  "/api/v1/admin/tournaments/{id}/matches": {
    get: createOperation("Matches", "List tournament matches for staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: idParameter("id"),
    }),
    post: createOperation("Matches", "Create a Quest-managed match", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/matches/{matchId}": {
    patch: createOperation("Matches", "Update Quest-owned match operations", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS],
      parameters: idParameter("matchId"),
    }),
  },
  "/api/v1/admin/matches/{matchId}/room": {
    post: createOperation("Match Rooms", "Create or resynchronize a match room", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS], parameters: idParameter("matchId") }),
  },
  "/api/v1/admin/match-rooms": {
    get: createOperation("Match Rooms", "List match rooms visible to tournament staff or directly assigned match staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
    }),
  },
  "/api/v1/admin/tournaments/{id}/staff": {
    get: createOperation("Permissions", "List tournament staff assignments", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
      requiredGlobalRole: "admin",
      permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
      parameters: idParameter("id"),
    }),
    post: createOperation("Permissions", "Assign tournament staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
      requiredGlobalRole: "admin",
      permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/staff/{assignmentId}": {
    delete: createOperation(
      "Permissions",
      "Remove a tournament staff assignment",
      {
        authenticated: true,
        permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
        requiredGlobalRole: "admin",
        permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
        parameters: [...idParameter("id"), ...idParameter("assignmentId")],
      },
    ),
  },
  "/api/v1/admin/valorant/teams": {
    get: createOperation("valorant", "List VALORANT team bindings with their FastAPI teams", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/bind": {
    post: createOperation("valorant", "Bind a SavedTeam to a VALORANT team (create-or-get by quest_saved_team_id)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{bindingId}/detach": {
    delete: createOperation("valorant", "Detach a VALORANT team binding (Quest-local, never touches VALORANT data)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/discover": {
    post: createOperation("valorant", "Run a two-player VALORANT match search", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/import": {
    post: createOperation("valorant", "Import a selected Henrik match (idempotent, created=true/false)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/by-henrik-id/{henrikMatchId}": {
    get: createOperation("valorant", "Get a match detail by Henrik match id", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches": {
    get: createOperation("valorant", "List VALORANT matches", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series": {
    post: createOperation("valorant", "Create a draft VALORANT series with anchors and external key", { authenticated: true }),
    get: createOperation("valorant", "List Quest VALORANT series projections", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/manual": {
    post: createOperation("valorant", "Create and finalize a manual-result VALORANT series (no games; idempotent by external key)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}": {
    get: createOperation("valorant", "Get a Quest VALORANT series projection", { authenticated: true }),
    delete: createOperation("valorant", "Delete a draft VALORANT series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{seriesId}": {
    patch: createOperation("valorant", "Update a draft VALORANT series playedAt", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{seriesId}/matches": {
    get: createOperation("valorant", "List matches relevant to a series (anchor-aware, with anchor side)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games": {
    post: createOperation("valorant", "Attach an imported match as a game with side mapping", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/order": {
    put: createOperation("valorant", "Set the absolute desired game order (draft only, idempotent)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/{gameId}": {
    delete: createOperation("valorant", "Remove a game from a draft series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/preview": {
    get: createOperation("valorant", "Preview a series validity and calculated winner", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/finalize": {
    post: createOperation("valorant", "Finalize a series with a rating mode and optional override", { authenticated: true }),
  },
  "/api/v1/admin/valorant/rankings": {
    get: createOperation("valorant", "List VALORANT team rankings", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/rating-history": {
    get: createOperation("valorant", "Get a VALORANT team rating history", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/series": {
    get: createOperation("valorant", "List a VALORANT team's series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/reconciliation": {
    get: createOperation("valorant", "Get the VALORANT reconciliation report", { authenticated: true }),
  },
  "/api/v1/valorant/leaderboard": {
    get: createOperation("valorant", "List the public VALORANT player leaderboard (paginated, ELO-desc)"),
  },
  "/api/v1/valorant/leaderboard/search": {
    get: createOperation("valorant", "Search the public VALORANT player leaderboard by Discord username, Riot name, tag, or name#tag"),
  },
  "/api/v1/valorant/leaderboard/register/discord/login": {
    get: createOperation("valorant", "Get the Discord OAuth login URL for leaderboard registration"),
  },
  "/api/v1/valorant/leaderboard/register/discord/callback": {
    get: createOperation("valorant", "Complete the Discord OAuth callback for leaderboard registration"),
  },
  "/api/v1/valorant/leaderboard/register/check-puuid": {
    post: createOperation("valorant", "Check whether a PUUID is already registered for the leaderboard"),
  },
  "/api/v1/valorant/leaderboard/register/preview": {
    post: createOperation("valorant", "Preview leaderboard registration for a PUUID"),
  },
  "/api/v1/valorant/leaderboard/register/submit": {
    post: createOperation("valorant", "Submit leaderboard registration for a PUUID"),
  },
  "/api/v1/game-accounts/valorant/resolve": {
    post: createOperation(
      "Game accounts",
      "Resolve a Riot ID to its stable identifier and current display identity",
      { authenticated: true },
    ),
  },
  "/api/v1/game-accounts/valorant/link": {
    post: createOperation(
      "Game accounts",
      "Link a resolved VALORANT account to the signed-in Quest account",
      { authenticated: true },
    ),
  },
  "/api/v1/users/me/game-accounts": {
    get: createOperation("Game accounts", "List the signed-in user's linked game accounts", {
      authenticated: true,
    }),
  },
  "/api/v1/game-accounts/valorant/change-request": {
    post: createOperation(
      "Game accounts",
      "Refresh a renamed account, or open an admin-reviewed account replacement",
      { authenticated: true },
    ),
  },
  "/api/v1/admin/game-accounts/change-requests": {
    get: createOperation("Game accounts", "List game account change requests", {
      authenticated: true,
    }),
  },
  "/api/v1/admin/game-accounts/change-requests/{requestId}/review": {
    post: createOperation("Game accounts", "Approve or reject a game account change request", {
      authenticated: true,
    }),
  },
  "/api/v1/teams/{teamId}/registration-readiness": {
    get: createOperation(
      "Game accounts",
      "Server-computed roster readiness for a saved team, optionally scoped to a tournament",
      { authenticated: true },
    ),
  },
  "/api/contact": {
    post: createOperation("Contact", "Submit a contact message"),
  },
  "/api/recruitment-applications": {
    post: createOperation("Recruitment", "Submit a recruitment application", {
      authenticated: true,
    }),
  },
  "/api/game-categories": {
    get: createOperation("Games", "List public game categories"),
  },
  "/api/games": {
    get: createOperation("Games", "List active games"),
  },
  "/api/players/{publicId}": {
    get: createOperation("Players", "Get a public player profile", {
      parameters: idParameter("publicId"),
    }),
  },
  "/api/rulebooks": {
    get: createOperation("Rulebooks", "List published rulebooks"),
  },
  "/api/rulebooks/{slug}": {
    get: createOperation("Rulebooks", "Get a published rulebook", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/posters": {
    get: createOperation("Media", "List public posters"),
    post: createOperation("Media", "Create a poster", { authenticated: true }),
  },
  "/api/posters/{posterId}": {
    get: createOperation("Media", "Get a public poster", {
      parameters: idParameter("posterId"),
    }),
    delete: createOperation("Media", "Delete a poster", {
      authenticated: true,
      parameters: idParameter("posterId"),
    }),
    patch: createOperation("Media", "Update tournament media", {
      authenticated: true,
      parameters: idParameter("posterId"),
    }),
  },
  "/api/posters/{posterId}/image": {
    get: createOperation("Media", "Stream a poster image", {
      parameters: idParameter("posterId"),
    }),
  },
  "/api/event-albums": {
    get: createOperation("Media", "List published event albums"),
  },
  "/api/event-albums/{slug}": {
    get: createOperation("Media", "Get a published event album", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/event-albums/{slug}/photos/{photoId}/image": {
    get: createOperation("Media", "Stream a published album photo", {
      parameters: [...idParameter("slug"), ...idParameter("photoId")],
    }),
  },
  "/api/admin/event-albums": {
    get: createOperation("Media", "List all event albums", { authenticated: true }),
    post: createOperation("Media", "Create an event album", { authenticated: true }),
  },
  "/api/admin/event-albums/{albumId}": {
    get: createOperation("Media", "Get an event album for editing", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
    patch: createOperation("Media", "Update an event album", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
    delete: createOperation("Media", "Delete an event album", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos": {
    post: createOperation("Media", "Upload event album photos", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/{photoId}/image": {
    get: createOperation("Media", "Stream an event album photo for editing", {
      authenticated: true,
      parameters: [...idParameter("albumId"), ...idParameter("photoId")],
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/reorder": {
    patch: createOperation("Media", "Reorder event album photos", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/{photoId}": {
    delete: createOperation("Media", "Delete an event album photo", {
      authenticated: true,
      parameters: [...idParameter("albumId"), ...idParameter("photoId")],
    }),
  },
  "/api/images": {
    get: createOperation("Media", "List managed images", {
      authenticated: true,
    }),
    post: createOperation("Media", "Upload managed images", {
      authenticated: true,
    }),
  },
  "/api/images/{imageId}": {
    get: createOperation("Media", "Get managed image metadata", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
    delete: createOperation("Media", "Delete a managed image", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
  },
  "/api/images/{imageId}/binary": {
    get: createOperation("Media", "Stream a managed image", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
  },
  "/api/admin/media/files": {
    get: createOperation("Media", "List public upload files", {
      authenticated: true,
    }),
  },
  "/api/teams/profile": {
    get: createOperation("Teams", "List the current user's teams", {
      authenticated: true,
    }),
  },
  "/api/me/invitations": {
    get: createOperation("Teams", "List pending team invitations addressed to the signed-in user", {
      authenticated: true,
    }),
  },
  "/api/teams": {
    post: createOperation("Teams", "Create a saved team", {
      authenticated: true,
    }),
  },
  "/api/teams/{teamId}": {
    patch: createOperation("Teams", "Update a saved team", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
    delete: createOperation("Teams", "Delete a saved team", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
  },
  "/api/teams/{teamId}/members/{memberId}/resend-invite": {
    post: createOperation("Teams", "Resend a pending team invitation", {
      authenticated: true,
      parameters: [...idParameter("teamId"), ...idParameter("memberId")],
    }),
  },
  "/api/team-invite": {
    get: createOperation("Teams", "Preview a team invitation"),
  },
  "/api/team-invite/respond": {
    post: createOperation("Teams", "Respond to a team invitation", {
      authenticated: true,
    }),
  },
  "/api/payments/{orderId}/bank-transfer-proof": {
    post: createOperation("Payments", "Upload bank-transfer evidence", {
      authenticated: true,
      parameters: idParameter("orderId"),
    }),
  },
  "/api/products/{productId}/images/{imageId}": {
    get: createOperation("Shop", "Stream a product image", {
      parameters: [...idParameter("productId"), ...idParameter("imageId")],
    }),
  },
  "/api/admin/dashboard": {
    get: createOperation("Admin", "Get administration dashboard metrics", {
      authenticated: true,
    }),
  },
  "/api/admin/expense-targets": {
    get: createOperation("Admin", "List tournaments and events available for expense tracking", {
      authenticated: true,
    }),
  },
  "/api/admin/expenses": {
    get: createOperation("Admin", "List expenses for one tournament or event", {
      authenticated: true,
    }),
    post: createOperation("Admin", "Add an expense to a tournament or event", {
      authenticated: true,
    }),
  },
  "/api/admin/expenses/{expenseId}": {
    patch: createOperation("Admin", "Update an event expense", {
      authenticated: true,
      parameters: idParameter("expenseId"),
    }),
    delete: createOperation("Admin", "Delete an event expense", {
      authenticated: true,
      parameters: idParameter("expenseId"),
    }),
  },
  "/api/admin/tournaments": {
    post: createOperation("Admin", "Create a tournament", {
      authenticated: true,
    }),
  },
  "/api/admin/event-series": {
    post: createOperation("Admin", "Create an event series", {
      authenticated: true,
    }),
  },
  "/api/admin/events": {
    get: createOperation("Admin", "List events for admins", {
      authenticated: true,
    }),
    post: createOperation("Admin", "Create an event", {
      authenticated: true,
    }),
  },
  "/api/admin/events/{eventId}": {
    patch: createOperation("Admin", "Update an event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/events/{eventId}/registrations": {
    get: createOperation("Admin", "List registrations for an event", {
      authenticated: true,
      parameters: [
        ...idParameter("eventId"),
        { $ref: "#/components/parameters/Page" },
        { $ref: "#/components/parameters/PageSize" },
        { $ref: "#/components/parameters/Search" },
        createQueryParameter("tournament", { type: "string" }),
        createQueryParameter("game", { type: "string" }),
        createQueryParameter("status", { type: "string" }),
        createQueryParameter("paymentStatus", { type: "string" }),
        createQueryParameter("verificationStatus", { type: "string" }),
      ],
    }),
  },
  "/api/admin/events/{eventId}/archive": {
    post: createOperation("Admin", "Archive an event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/events/{eventId}/tournaments": {
    post: createOperation("Admin", "Add a tournament to an event", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/products": {
    post: createOperation("Admin", "Create a product", { authenticated: true }),
  },
  "/api/admin/users": {
    get: createOperation("Admin", "List users", { authenticated: true }),
    post: createOperation("Admin", "Create a user", { authenticated: true }),
  },
  "/api/admin/users/{userId}": {
    get: createOperation("Admin", "Get a user", {
      authenticated: true,
      parameters: idParameter("userId"),
    }),
    patch: createOperation("Admin", "Update a user", {
      authenticated: true,
      parameters: idParameter("userId"),
    }),
    delete: createOperation("Admin", "Delete a user", {
      authenticated: true,
      parameters: idParameter("userId"),
    }),
  },
  "/api/admin/contact-messages": {
    get: createOperation("Admin", "List contact messages", {
      authenticated: true,
    }),
  },
  "/api/admin/contact-messages/{messageId}": {
    patch: createOperation("Admin", "Update contact message status", {
      authenticated: true,
      parameters: idParameter("messageId"),
    }),
    delete: createOperation("Admin", "Delete a contact message", {
      authenticated: true,
      parameters: idParameter("messageId"),
    }),
  },
  "/api/admin/team-registrations/export": {
    get: createOperation("Admin", "Export tournament registrations", {
      authenticated: true,
    }),
  },
  "/api/admin/tournaments/{tournamentId}/registrations": {
    get: createOperation("Admin", "List registrations for a tournament", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}/status": {
    patch: createOperation("Admin", "Update registration status", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}/game-ids": {
    patch: createOperation("Admin", "Update registration roster Game IDs", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}/logo": {
    patch: createOperation("Admin", "Replace or remove an unlinked registration logo", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}/roster": {
    patch: createOperation("Admin", "Correct a registration roster", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}": {
    get: createOperation("Admin", "Get a tournament registration", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
    delete: createOperation("Admin", "Delete a registration", {
      authenticated: true,
      parameters: idParameter("registrationId"),
    }),
  },
  "/api/admin/team-registrations/{registrationId}/slot-reservation": {
    post: createOperation(
      "Admin",
      "Privately reserve a slot for a pending team",
      { authenticated: true, parameters: idParameter("registrationId") },
    ),
    delete: createOperation(
      "Admin",
      "Release a private team slot reservation",
      { authenticated: true, parameters: idParameter("registrationId") },
    ),
  },
  "/api/admin/recruitment-applications": {
    get: createOperation("Admin", "List recruitment applications", {
      authenticated: true,
    }),
  },
  "/api/admin/recruitment-applications/export": {
    get: createOperation("Admin", "Export recruitment applications", {
      authenticated: true,
    }),
  },
  "/api/admin/recruitment-applications/{applicationId}/status": {
    patch: createOperation("Admin", "Update recruitment application status", {
      authenticated: true,
      parameters: idParameter("applicationId"),
    }),
  },
  "/api/admin/recruitment-applications/{applicationId}": {
    delete: createOperation("Admin", "Delete a recruitment application", {
      authenticated: true,
      parameters: idParameter("applicationId"),
    }),
  },
  "/api/admin/media/import-legacy-posters": {
    post: createOperation("Admin", "Import legacy poster media", {
      authenticated: true,
    }),
  },
  "/api/admin/media/migrate-image-assets": {
    post: createOperation("Admin", "Migrate poster image assets", {
      authenticated: true,
    }),
  },
  "/api/admin/teams": {
    get: createOperation("Admin", "List saved teams", { authenticated: true }),
  },
  "/api/admin/teams/{teamId}": {
    get: createOperation("Admin", "Get a saved team and roster", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
    patch: createOperation("Admin", "Update a saved team and roster", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
    delete: createOperation("Admin", "Delete a saved team", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
  },
  "/api/admin/teams/{teamId}/captain-transfer": {
    post: createOperation(
      "Admin",
      "Transfer saved-team captain and remove the former captain",
      { authenticated: true, parameters: idParameter("teamId") },
    ),
  },
  "/api/admin/teams/{teamId}/organization": {
    patch: createOperation("Admin", "Update team organization status", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
  },
  "/api/admin/games": {
    get: createOperation("Admin", "List games including inactive", {
      authenticated: true,
    }),
  },
  "/api/admin/game-categories": {
    get: createOperation("Admin", "List game categories", {
      authenticated: true,
    }),
    post: createOperation("Admin", "Create a game category", {
      authenticated: true,
    }),
  },
  "/api/admin/game-categories/{categoryId}": {
    patch: createOperation("Admin", "Update a game category", {
      authenticated: true,
      parameters: idParameter("categoryId"),
    }),
    delete: createOperation("Admin", "Delete a game category", {
      authenticated: true,
      parameters: idParameter("categoryId"),
    }),
  },
  "/api/admin/rulebooks": {
    post: createOperation("Admin", "Create a rulebook", {
      authenticated: true,
    }),
  },
  "/api/admin/rulebooks/{rulebookId}": {
    patch: createOperation("Admin", "Update a rulebook", {
      authenticated: true,
      parameters: idParameter("rulebookId"),
    }),
    delete: createOperation("Admin", "Delete a rulebook", {
      authenticated: true,
      parameters: idParameter("rulebookId"),
    }),
  },
  "/api/admin/event-series/{seriesId}": {
    patch: createOperation("Admin", "Update an event series", {
      authenticated: true,
      parameters: idParameter("seriesId"),
    }),
    delete: createOperation("Admin", "Delete an event series", {
      authenticated: true,
      parameters: idParameter("seriesId"),
    }),
  },
  "/api/admin/products/{productId}": {
    patch: createOperation("Admin", "Update a product", {
      authenticated: true,
      parameters: idParameter("productId"),
    }),
    delete: createOperation("Admin", "Archive a product", {
      authenticated: true,
      parameters: idParameter("productId"),
    }),
  },
  "/api/admin/orders/{orderId}": {
    patch: createOperation("Admin", "Update order fulfillment status", {
      authenticated: true,
      parameters: idParameter("orderId"),
    }),
  },
  "/api/admin/payments/{transactionId}": {
    get: createOperation("Admin", "Get a payment transaction", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/payments/{transactionId}/bank-transfer-proof": {
    get: createOperation("Admin", "Download bank-transfer evidence", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/payments/{transactionId}/bank-transfer-review": {
    patch: createOperation("Admin", "Review bank-transfer evidence", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/payments/{transactionId}/payhere-reconciliation": {
    patch: createOperation("Admin", "Reconcile a PayHere payment", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/payments/{transactionId}/cash-reconciliation": {
    patch: createOperation("Admin", "Confirm or cancel a cash entrance payment", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/payments/{transactionId}/reopen": {
    post: createOperation("Admin", "Reopen an expired tournament payment", {
      authenticated: true,
      parameters: idParameter("transactionId"),
    }),
  },
  "/api/admin/tournaments/{tournamentId}": {
    get: createOperation("Admin", "Get an admin tournament", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
    patch: createOperation("Admin", "Update a tournament", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
    delete: createOperation("Admin", "Delete a tournament", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/admin/tournaments/{tournamentId}/sponsors": {
    get: createOperation("Admin", "List tournament sponsors", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
    post: createOperation("Admin", "Create a tournament sponsor", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/admin/tournaments/{tournamentId}/sponsors/{sponsorId}": {
    patch: createOperation("Admin", "Update a tournament sponsor", {
      authenticated: true,
      parameters: [...idParameter("tournamentId"), ...idParameter("sponsorId")],
    }),
    delete: createOperation("Admin", "Delete a tournament sponsor", {
      authenticated: true,
      parameters: [...idParameter("tournamentId"), ...idParameter("sponsorId")],
    }),
  },
  "/api/uploads/tournament-banners/{filename}": {
    get: createOperation("Media", "Stream a tournament banner", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/poster-images/{filename}": {
    get: createOperation("Media", "Stream a poster image file", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/team-logos/{filename}": {
    get: createOperation("Media", "Stream a team logo", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/avatars/{filename}": {
    get: createOperation("Media", "Stream an avatar", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/game-assets/{filename}": {
    get: createOperation("Media", "Stream a game asset", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/sponsor-logos/{filename}": {
    get: createOperation("Media", "Stream a sponsor logo", {
      parameters: idParameter("filename"),
    }),
  },
};

for (const [path, operations] of Object.entries(additionalPaths)) {
  openApiDocument.paths[path] = {
    ...(openApiDocument.paths[path] || {}),
    ...operations,
  };
}

module.exports = {
  openApiDocument,
};
