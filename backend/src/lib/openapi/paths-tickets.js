const { createHeaderParameter, createOperation, idParameter } = require("./helpers");

const ticketsPaths = {
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
};

module.exports = { ticketsPaths };
