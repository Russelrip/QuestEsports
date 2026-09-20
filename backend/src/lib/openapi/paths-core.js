// The document's original paths: health, auth, account, commerce and admin basics.
const {
  createQueryParameter,
  createPathParameter,
  createHeaderParameter,
  createResponse,
  createOperation,
  createListResponse,
} = require("./helpers");

const corePaths = {
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
};

module.exports = { corePaths };
