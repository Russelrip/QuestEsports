const { createQueryParameter, createOperation, idParameter } = require("./helpers");

const adminPaths = {
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
  "/api/admin/team-registrations/{registrationId}/members/{memberId}/resend-invite": {
    post: createOperation(
      "Admin",
      "Send a registration roster member's unanswered invitation again",
      {
        authenticated: true,
        parameters: [...idParameter("registrationId"), ...idParameter("memberId")],
      },
    ),
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
  "/api/admin/teams/{teamId}/members/{memberId}/resend-invite": {
    post: createOperation(
      "Admin",
      "Send a saved-team member's unanswered invitation again",
      {
        authenticated: true,
        parameters: [...idParameter("teamId"), ...idParameter("memberId")],
      },
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
  "/api/admin/events/{eventId}/sponsors": {
    get: createOperation("Admin", "List event sponsors", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
    post: createOperation("Admin", "Create an event sponsor", {
      authenticated: true,
      parameters: idParameter("eventId"),
    }),
  },
  "/api/admin/events/{eventId}/sponsors/{sponsorId}": {
    patch: createOperation("Admin", "Update an event sponsor", {
      authenticated: true,
      parameters: [...idParameter("eventId"), ...idParameter("sponsorId")],
    }),
    delete: createOperation("Admin", "Delete an event sponsor", {
      authenticated: true,
      parameters: [...idParameter("eventId"), ...idParameter("sponsorId")],
    }),
  },
};

module.exports = { adminPaths };
