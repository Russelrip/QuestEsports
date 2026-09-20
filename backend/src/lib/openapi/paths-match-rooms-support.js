const {
  createQueryParameter,
  createResponse,
  oauthProviderParameter,
  oauthRedirectResponse,
  linkedProvidersResponse,
  createOperation,
  idParameter,
  supportCreateRequestBody,
  supportReplyRequestBody,
} = require("./helpers");

const matchRoomsSupportPaths = {
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
    // Both content types are intentional: existing JSON clients remain valid
    // while screenshot uploads use repeated multipart `screenshots` fields.
    get: createOperation("Support", "List the signed-in user's support conversations", {
      authenticated: true,
      parameters: [
        createQueryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
        createQueryParameter("cursor", { type: "string", format: "date-time" }),
      ],
    }),
    post: createOperation("Support", "Create a support conversation", {
      authenticated: true,
      requestBody: supportCreateRequestBody,
    }),
  },
  "/api/v1/support/unread": {
    get: createOperation("Support", "Get the signed-in user's unread support conversation count", {
      authenticated: true,
    }),
  },
  "/api/v1/support/attachments/{attachmentId}/content": {
    get: createOperation("Support", "Download an authorized private support attachment", {
      authenticated: true,
      parameters: idParameter("attachmentId"),
      additionalResponses: {
        404: createResponse("Support attachment not found"),
      },
    }),
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
      requestBody: supportReplyRequestBody,
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
      requestBody: supportReplyRequestBody,
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
};

module.exports = { matchRoomsSupportPaths };
