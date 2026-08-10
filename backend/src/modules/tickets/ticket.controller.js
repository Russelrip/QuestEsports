const { asyncHandler } = require("../../lib/async-handler");
const service = require("./ticket.service");

const listEvents = asyncHandler(async (_req, res) =>
  res
    .status(200)
    .json({ success: true, events: await service.listPublicEvents() }),
);
const getEvent = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      event: await service.getPublicEvent(req.params.slug),
    }),
);
const quoteOrder = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      quote: await service.getTicketQuote({
        slug: req.params.slug,
        quantity: req.body.quantity,
      }),
    }),
);
const createOrder = asyncHandler(async (req, res) =>
  res
    .status(201)
    .json({
      success: true,
      ...(await service.createTicketOrder({
        slug: req.params.slug,
        body: req.body,
        user: req.user,
      })),
    }),
);
const getOrder = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      order: await service.getTicketOrderByToken(req.get("x-ticket-order-token")),
    }),
);
const getAdminEvents = asyncHandler(async (_req, res) =>
  res
    .status(200)
    .json({ success: true, events: await service.listAdminEvents() }),
);
const getAdminEvent = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      event: await service.getAdminEvent(req.params.eventId),
    }),
);
const createAdminEvent = asyncHandler(async (req, res) =>
  res
    .status(201)
    .json({
      success: true,
      event: await service.saveAdminEvent({ body: req.body }),
    }),
);
const updateAdminEvent = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      event: await service.saveAdminEvent({
        eventId: req.params.eventId,
        body: req.body,
      }),
    }),
);
const getAdminOrders = asyncHandler(async (req, res) => {
  const result = await service.listAdminOrders({
    eventId: req.params.eventId,
    query: req.query,
  });
  res
    .status(200)
    .json({
      success: true,
      orders: result.items,
      pagination: result.pagination,
    });
});
const getAdminTickets = asyncHandler(async (req, res) => {
  const result = await service.listAdminTickets({
    eventId: req.params.eventId,
    query: req.query,
  });
  res
    .status(200)
    .json({
      success: true,
      tickets: result.items,
      pagination: result.pagination,
    });
});
const scanTicket = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      scan: await service.scanTicket({
        eventId: req.params.eventId,
        payload: req.body.payload,
        admin: req.user,
      }),
    }),
);
const checkInTicket = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      scan: await service.checkInTicketById({
        eventId: req.params.eventId,
        ticketId: req.params.ticketId,
        admin: req.user,
      }),
    }),
);
const reissueTicket = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      ticket: await service.reissueTicket({ ticketId: req.params.ticketId }),
    }),
);
const updateTicket = asyncHandler(async (req, res) =>
  res
    .status(200)
    .json({
      success: true,
      ticket: await service.updateTicketStatus({
        ticketId: req.params.ticketId,
        status: req.body.status,
      }),
    }),
);
const exportReport = asyncHandler(async (req, res) => {
  const { event, rows } = await service.getEventReportRows(req.params.eventId);
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "Ticket",
    "Ticket status",
    "Buyer",
    "Email",
    "Phone",
    "Order status",
    "Order total",
    "Checked in at",
    "Checked in by",
  ];
  const csv = [
    headers,
    ...rows.map((row) => [
      row.ticketNumber,
      row.ticketStatus,
      row.buyerName,
      row.email,
      row.phone,
      row.orderStatus,
      row.orderTotal,
      row.checkedInAt?.toISOString() || "",
      row.checkedInBy,
    ]),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${event.slug}-ticket-report.csv"`,
  );
  res.status(200).send(`\uFEFF${csv}`);
});

module.exports = {
  listEvents,
  getEvent,
  quoteOrder,
  createOrder,
  getOrder,
  getAdminEvents,
  getAdminEvent,
  createAdminEvent,
  updateAdminEvent,
  getAdminOrders,
  getAdminTickets,
  scanTicket,
  checkInTicket,
  reissueTicket,
  updateTicket,
  exportReport,
};
