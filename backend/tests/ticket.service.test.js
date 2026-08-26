const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/tickets/ticket.service.js",
);
const envPath = path.join(__dirname, "../src/config/env.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const paymentServicePath = path.join(
  __dirname,
  "../src/modules/payments/payment.service.js",
);

const load = (prisma = {}) =>
  loadModuleWithMocks(servicePath, {
    [envPath]: {
      env: {
        AUTH_ENCRYPTION_KEY: "a".repeat(64),
        TICKET_ORDER_RESERVATION_MINUTES: 30,
      },
    },
    [prismaPath]: { prisma },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: () => ({}),
    },
  });

test("ticket pricing applies the pair bundle before one odd single", () => {
  const { module: service, restore } = load();
  try {
    const cases = [
      [1, 500],
      [2, 800],
      [3, 1300],
      [4, 1600],
      [5, 2100],
    ];
    for (const [quantity, expected] of cases) {
      const quote = service.calculateTicketPrice({
        quantity,
        singlePrice: 500,
        pairPrice: 800,
      });
      assert.equal(quote.total.toNumber(), expected);
      assert.equal(quote.pairCount, Math.floor(quantity / 2));
      assert.equal(quote.singleCount, quantity % 2);
    }
  } finally {
    restore();
  }
});

test("public ticket events aggregate reserved capacity in one grouped query", async () => {
  let groupCalls = 0;
  const future = new Date(Date.now() + 86_400_000);
  const events = [
    { id: "event-1", slug: "one", title: "One", description: "", venue: "A", startsAt: future, salesStartAt: new Date(0), salesEndAt: future, status: "on_sale", capacity: 100, maxTicketsPerOrder: 4, currency: "LKR", singlePrice: 500, pairPrice: 800 },
    { id: "event-2", slug: "two", title: "Two", description: "", venue: "B", startsAt: future, salesStartAt: new Date(0), salesEndAt: future, status: "on_sale", capacity: 50, maxTicketsPerOrder: 4, currency: "LKR", singlePrice: 500, pairPrice: 800 },
  ];
  const { module: service, restore } = load({
    ticketEvent: { findMany: async () => events },
    ticketOrder: {
      groupBy: async ({ by, where }) => {
        groupCalls += 1;
        assert.deepEqual(by, ["eventId"]);
        assert.deepEqual(where.eventId.in, ["event-1", "event-2"]);
        return [{ eventId: "event-1", _sum: { quantity: 7 } }];
      },
    },
  });
  try {
    const result = await service.listPublicEvents();
    assert.equal(groupCalls, 1);
    assert.equal(result[0].availableTickets, 93);
    assert.equal(result[1].availableTickets, 50);
  } finally {
    restore();
  }
});

test("a LAN event exposes only its linked active entrance fee", async () => {
  const future = new Date(Date.now() + 86_400_000);
  const event = {
    id: "event-1",
    seriesId: "series-1",
    series: {
      id: "series-1",
      slug: "quest-lan",
      title: "Quest LAN",
      isPublished: true,
    },
    slug: "quest-lan-entry",
    title: "Quest LAN Entry",
    description: "Venue entrance",
    venue: "Colombo",
    startsAt: future,
    salesStartAt: new Date(0),
    salesEndAt: future,
    status: "on_sale",
    capacity: 100,
    maxTicketsPerOrder: 4,
    currency: "LKR",
    singlePrice: 500,
    pairPrice: 800,
  };
  const { module: service, restore } = load({
    ticketEvent: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { seriesId: "series-1" });
        return event;
      },
    },
    ticketOrder: {
      aggregate: async () => ({ _sum: { quantity: 6 } }),
    },
  });
  try {
    const result = await service.getPublicEventForSeries("series-1");
    assert.equal(result.series.slug, "quest-lan");
    assert.equal(result.availableTickets, 94);
  } finally {
    restore();
  }
});

test("a valid ticket is atomically claimed once and audited", async () => {
  const ticket = {
    id: "a6a67b53-e59c-4f12-9de8-b9f0b38cd3b5",
    ticketNumber: "QES-A6A67B53E59C",
    tokenVersion: 1,
    eventId: "event-1",
    status: "valid",
    checkedInAt: null,
    order: {
      status: "paid",
      firstName: "Quest",
      lastName: "Guest",
      email: "guest@example.com",
    },
    event: { title: "Quest LAN" },
    checkedInBy: null,
  };
  const audits = [];
  const tx = {
    ticketEvent: {
      findUnique: async () => ({
        id: "event-1",
        title: "Quest LAN",
        status: "on_sale",
      }),
    },
    ticket: {
      findUnique: async () => ticket,
      updateMany: async () => ({ count: 1 }),
    },
    ticketScan: {
      create: async ({ data }) => {
        audits.push(data);
      },
    },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.scanTicket({
      eventId: "event-1",
      payload: service.buildQrPayload(ticket),
      admin: { id: "admin-1" },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.ticket.status, "checked_in");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].result, "accepted");
  } finally {
    restore();
  }
});

test("a previously checked-in ticket is rejected and audited without another claim", async () => {
  const ticket = {
    id: "a6a67b53-e59c-4f12-9de8-b9f0b38cd3b5",
    ticketNumber: "QES-A6A67B53E59C",
    tokenVersion: 1,
    eventId: "event-1",
    status: "checked_in",
    checkedInAt: new Date("2026-08-06T10:00:00.000Z"),
    order: {
      status: "paid",
      firstName: "Quest",
      lastName: "Guest",
      email: "guest@example.com",
    },
    event: { title: "Quest LAN" },
    checkedInBy: { firstName: "Gate", lastName: "Admin" },
  };
  let claims = 0;
  const audits = [];
  const tx = {
    ticketEvent: {
      findUnique: async () => ({
        id: "event-1",
        title: "Quest LAN",
        status: "on_sale",
      }),
    },
    ticket: {
      findUnique: async () => ticket,
      updateMany: async () => {
        claims += 1;
        return { count: 1 };
      },
    },
    ticketScan: {
      create: async ({ data }) => {
        audits.push(data);
      },
    },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.scanTicket({
      eventId: "event-1",
      payload: service.buildQrPayload(ticket),
      admin: { id: "admin-1" },
    });
    assert.equal(result.result, "already_used");
    assert.equal(result.accepted, false);
    assert.equal(claims, 0);
    assert.equal(audits[0].result, "already_used");
  } finally {
    restore();
  }
});

test("ticket QR payloads are signed and reject tampering or old versions", () => {
  const { module: service, restore } = load();
  try {
    const ticket = {
      id: "a6a67b53-e59c-4f12-9de8-b9f0b38cd3b5",
      tokenVersion: 3,
    };
    const payload = service.buildQrPayload(ticket);
    assert.deepEqual(service.parseQrPayload(payload), {
      ticketId: ticket.id,
      tokenVersion: 3,
    });
    assert.equal(service.parseQrPayload(payload.replace(".3.", ".2.")), null);
    assert.equal(service.parseQrPayload(`${payload.slice(0, -1)}A`), null);
  } finally {
    restore();
  }
});

test("a reissued ticket audits its QR version through the durable-audit sanitizer", async () => {
  const ticket = {
    id: "a6a67b53-e59c-4f12-9de8-b9f0b38cd3b5",
    ticketNumber: "QES-A6A67B53E59C",
    tokenVersion: 3,
    eventId: "event-1",
    status: "valid",
    checkedInAt: null,
    order: { status: "paid" },
  };
  const auditRows = [];
  const tx = {
    ticket: {
      findUnique: async () => ticket,
      update: async ({ data }) => ({ ...ticket, tokenVersion: ticket.tokenVersion + (data.tokenVersion?.increment || 0) }),
    },
    auditLog: { create: async ({ data }) => { auditRows.push(data); return data; } },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    await service.reissueTicket({
      ticketId: ticket.id,
      auditContext: {
        actorUserId: "3f1d4f4a-1f2e-4a0b-9c4d-2b7e5c8a9d10",
        requestId: "request-reissue",
        ipAddress: "127.0.0.1",
      },
    });
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "ticket.reissued");
    // The sanitizer redacts any key that reads as a credential, so the
    // non-secret reissue counter must be recorded under a name that survives
    // it — otherwise the row carries no before/after evidence at all, because
    // a reissue leaves the status unchanged.
    assert.equal(auditRows[0].beforeData.qrVersion, 3);
    assert.equal(auditRows[0].afterData.qrVersion, 4);
    assert.notEqual(auditRows[0].beforeData.qrVersion, "[REDACTED]");
    assert.notEqual(auditRows[0].afterData.qrVersion, "[REDACTED]");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Order creation and reservation release.
//
// This is the money path: it decides what a buyer is charged, whether an event
// can be oversold, and when reserved capacity returns to the pool. Every guard
// below fails open into either a wrong charge or a ticket that does not exist,
// so each one is asserted on its own rather than through one happy-path case.
// ---------------------------------------------------------------------------

const ticketEvent = (over = {}) => ({
  id: "event-1",
  slug: "finals-2026",
  title: "Grand Finals",
  status: "on_sale",
  salesStartAt: new Date(Date.now() - 86_400_000),
  salesEndAt: new Date(Date.now() + 86_400_000),
  singlePrice: 500,
  pairPrice: 800,
  currency: "LKR",
  capacity: 100,
  maxTicketsPerOrder: 10,
  paymentMethods: ["payhere", "bank_transfer", "cash"],
  bankName: "Bank",
  bankAccountName: "Quest",
  bankAccountNumber: "123",
  ...over,
});

const buyer = {
  email: "buyer@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+94770000000",
};

// Captures every write so a test can assert what was persisted, not merely
// that the call returned.
const orderPrisma = ({ event = ticketEvent(), reserved = 0 } = {}) => {
  const writes = { orders: [], tickets: [], payments: [] };
  const tx = {
    ticketEvent: { findUnique: async () => event },
    ticketOrder: {
      aggregate: async () => ({ _sum: { quantity: reserved } }),
      create: async ({ data }) => {
        writes.orders.push(data);
        return { ...data, status: "pending_payment" };
      },
    },
    ticket: { createMany: async ({ data }) => { writes.tickets.push(...data); return { count: data.length }; } },
    paymentTransaction: { create: async ({ data }) => { writes.payments.push(data); return data; } },
  };
  return { writes, prisma: { $transaction: async (work) => work(tx) } };
};

const orderBody = (over = {}) => ({
  ...buyer,
  quantity: 2,
  paymentMethod: "bank_transfer",
  expectedTotal: 800,
  expectedCurrency: "LKR",
  ...over,
});

test("a ticket order is priced by the server, not by the client's expected total", async () => {
  const { writes, prisma } = orderPrisma();
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.createTicketOrder({
      slug: "finals-2026",
      body: orderBody(),
      user: null,
    });
    // 2 tickets = one pair at 800, never 2 x 500.
    assert.equal(result.order.total, 800);
    assert.equal(writes.orders[0].total.toNumber(), 800);
    assert.equal(writes.orders[0].pairCount, 1);
    assert.equal(writes.orders[0].singleCount, 0);
    // One ticket row per seat, each with its own number and sequence.
    assert.equal(writes.tickets.length, 2);
    assert.deepEqual(writes.tickets.map((t) => t.sequence), [1, 2]);
    assert.equal(new Set(writes.tickets.map((t) => t.ticketNumber)).size, 2);
    // The payment is recorded for exactly the server-computed amount.
    assert.equal(writes.payments[0].amount.toNumber(), 800);
    assert.equal(writes.payments[0].currency, "LKR");
    assert.equal(writes.payments[0].purpose, "ticket_order");
  } finally {
    restore();
  }
});

test("an order whose expected total does not match the server price is refused", async () => {
  const { writes, prisma } = orderPrisma();
  const { module: service, restore } = load(prisma);
  try {
    // A client that submits a total it prefers must not be charged it.
    await assert.rejects(
      service.createTicketOrder({
        slug: "finals-2026",
        body: orderBody({ expectedTotal: 1 }),
        user: null,
      }),
      (error) => error.statusCode === 409 && /pricing changed/i.test(error.message),
    );
    // Nothing is persisted on a rejected price.
    assert.equal(writes.orders.length, 0);
    assert.equal(writes.tickets.length, 0);
    assert.equal(writes.payments.length, 0);
  } finally {
    restore();
  }
});

test("an order in a different currency to the event is refused", async () => {
  const { prisma } = orderPrisma();
  const { module: service, restore } = load(prisma);
  try {
    // Same number, different currency, would otherwise charge 800 USD for an
    // 800 LKR event.
    await assert.rejects(
      service.createTicketOrder({
        slug: "finals-2026",
        body: orderBody({ expectedCurrency: "USD" }),
        user: null,
      }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("capacity already reserved by other orders prevents an oversell", async () => {
  // 99 of 100 reserved; a 2-ticket order would take it to 101.
  const { writes, prisma } = orderPrisma({ reserved: 99 });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.createTicketOrder({ slug: "finals-2026", body: orderBody(), user: null }),
      (error) => error.statusCode === 409 && /no longer available/i.test(error.message),
    );
    assert.equal(writes.tickets.length, 0);
  } finally {
    restore();
  }
});

test("an order that exactly fills the remaining capacity is allowed", async () => {
  const { writes, prisma } = orderPrisma({ reserved: 98 });
  const { module: service, restore } = load(prisma);
  try {
    await service.createTicketOrder({ slug: "finals-2026", body: orderBody(), user: null });
    // The boundary must not be off by one in the cautious direction either.
    assert.equal(writes.tickets.length, 2);
  } finally {
    restore();
  }
});

test("orders are refused outside the sales window and off sale", async () => {
  const cases = [
    ["draft status", ticketEvent({ status: "draft" })],
    ["sales not started", ticketEvent({ salesStartAt: new Date(Date.now() + 3_600_000) })],
    ["sales ended", ticketEvent({ salesEndAt: new Date(Date.now() - 3_600_000) })],
  ];
  for (const [label, event] of cases) {
    const { prisma } = orderPrisma({ event });
    const { module: service, restore } = load(prisma);
    try {
      await assert.rejects(
        service.createTicketOrder({ slug: "finals-2026", body: orderBody(), user: null }),
        (error) => error.statusCode === 409,
        label,
      );
    } finally {
      restore();
    }
  }
});

test("a payment method the event does not offer is refused", async () => {
  const { prisma } = orderPrisma({ event: ticketEvent({ paymentMethods: ["payhere"] }) });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.createTicketOrder({
        slug: "finals-2026",
        body: orderBody({ paymentMethod: "cash" }),
        user: null,
      }),
      (error) => error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("bank transfer is refused when the event has no bank details to pay into", async () => {
  const { prisma } = orderPrisma({ event: ticketEvent({ bankAccountNumber: null }) });
  const { module: service, restore } = load(prisma);
  try {
    // 503 rather than 400: the buyer did nothing wrong, the event is
    // misconfigured, and taking the money with nowhere to send it is worse.
    await assert.rejects(
      service.createTicketOrder({ slug: "finals-2026", body: orderBody(), user: null }),
      (error) => error.statusCode === 503,
    );
  } finally {
    restore();
  }
});

test("an order above the per-order ticket limit is refused", async () => {
  const { prisma } = orderPrisma({ event: ticketEvent({ maxTicketsPerOrder: 2 }) });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.createTicketOrder({
        slug: "finals-2026",
        body: orderBody({ quantity: 4, expectedTotal: 1600 }),
        user: null,
      }),
      (error) => error.statusCode === 400,
    );
  } finally {
    restore();
  }
});

test("incomplete or oversized buyer details are refused before anything is reserved", async () => {
  const cases = [
    ["missing email", { email: "" }],
    ["malformed email", { email: "not-an-email" }],
    ["missing first name", { firstName: "" }],
    ["missing phone", { phone: "" }],
    ["email over 254 chars", { email: `${"a".repeat(250)}@example.com` }],
    ["name over 100 chars", { firstName: "a".repeat(101) }],
  ];
  for (const [label, over] of cases) {
    const { writes, prisma } = orderPrisma();
    const { module: service, restore } = load(prisma);
    try {
      await assert.rejects(
        service.createTicketOrder({ slug: "finals-2026", body: orderBody(over), user: null }),
        (error) => error.statusCode === 400,
        label,
      );
      // Validation runs before the transaction, so capacity is never touched.
      assert.equal(writes.orders.length, 0, label);
    } finally {
      restore();
    }
  }
});

test("buyer details fall back to the signed-in user when the body omits them", async () => {
  const { writes, prisma } = orderPrisma();
  const { module: service, restore } = load(prisma);
  try {
    await service.createTicketOrder({
      slug: "finals-2026",
      body: { quantity: 2, paymentMethod: "cash", expectedTotal: 800, expectedCurrency: "LKR" },
      user: { id: "user-1", ...buyer },
    });
    assert.equal(writes.orders[0].email, "buyer@example.com");
    assert.equal(writes.orders[0].userId, "user-1");
  } finally {
    restore();
  }
});

test("an expired reservation releases capacity, cancels its tickets and expires its payment", async () => {
  const calls = { orders: null, tickets: null, payments: null };
  const prisma = {
    $transaction: async (work) => work({
      ticketOrder: { updateMany: async (args) => { calls.orders = args; return { count: 1 }; } },
      ticket: { updateMany: async (args) => { calls.tickets = args; return { count: 2 }; } },
      paymentTransaction: { updateMany: async (args) => { calls.payments = args; return { count: 1 }; } },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    const now = new Date("2026-08-26T00:00:00Z");
    assert.equal(await service.expireTicketOrderReservation({ orderId: "order-1", now }), true);

    // Only a still-pending, not-yet-released, actually-expired order.
    assert.equal(calls.orders.where.status, "pending_payment");
    assert.equal(calls.orders.where.capacityReleasedAt, null);
    assert.deepEqual(calls.orders.where.expiresAt, { lte: now });
    // capacityReleasedAt is what stops a second release double-counting.
    assert.equal(calls.orders.data.capacityReleasedAt, now);
    assert.equal(calls.orders.data.status, "expired");

    assert.equal(calls.tickets.data.status, "cancelled");
    assert.equal(calls.payments.data.status, "expired");
    assert.deepEqual(calls.payments.where.status, {
      in: ["created", "pending", "review_required"],
    });
  } finally {
    restore();
  }
});

test("releasing an already-released reservation is a no-op, not a double release", async () => {
  let ticketWrites = 0;
  const prisma = {
    $transaction: async (work) => work({
      // The guarded updateMany matches nothing the second time round.
      ticketOrder: { updateMany: async () => ({ count: 0 }) },
      ticket: { updateMany: async () => { ticketWrites += 1; return { count: 0 }; } },
      paymentTransaction: { updateMany: async () => ({ count: 0 }) },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    assert.equal(await service.expireTicketOrderReservation({ orderId: "order-1" }), false);
    // It must stop at the order, not go on to cancel tickets a paid order owns.
    assert.equal(ticketWrites, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Ticket lifecycle guards.
//
// A ticket is a bearer instrument: once it is `valid` it admits somebody to a
// venue, and once it is `checked_in` that admission has already happened. Every
// rule below exists so a ticket cannot be made admissible without a paid order,
// and so a used ticket cannot be quietly restored.
// ---------------------------------------------------------------------------

const ticketRow = (over = {}) => ({
  id: "ticket-1",
  ticketNumber: "QES-ABC123",
  status: "valid",
  tokenVersion: 1,
  eventId: "event-1",
  order: { status: "paid" },
  ...over,
});

const lifecyclePrisma = (ticket) => {
  const writes = [];
  const tx = {
    ticket: {
      findUnique: async () => ticket,
      update: async (args) => { writes.push(args); return { ...ticket, ...args.data }; },
    },
    auditLog: { create: async () => ({}) },
  };
  return { writes, prisma: { $transaction: async (work) => work(tx) } };
};

test("a ticket cannot be made valid while its order is unpaid", async () => {
  const { writes, prisma } = lifecyclePrisma(
    ticketRow({ status: "cancelled", order: { status: "pending_payment" } }),
  );
  const { module: service, restore } = load(prisma);
  try {
    // Otherwise an unpaid order yields a ticket that opens the gate.
    await assert.rejects(
      service.updateTicketStatus({ ticketId: "ticket-1", status: "valid" }),
      (error) => error.statusCode === 409 && /paid order/i.test(error.message),
    );
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("a checked-in ticket can be neither cancelled nor restored", async () => {
  for (const status of ["valid", "cancelled"]) {
    const { writes, prisma } = lifecyclePrisma(ticketRow({ status: "checked_in" }));
    const { module: service, restore } = load(prisma);
    try {
      // The admission already happened; rewriting the record would hide it.
      await assert.rejects(
        service.updateTicketStatus({ ticketId: "ticket-1", status }),
        (error) => error.statusCode === 409,
        status,
      );
      assert.equal(writes.length, 0, status);
    } finally {
      restore();
    }
  }
});

test("only valid and cancelled are accepted as ticket statuses", async () => {
  for (const status of ["checked_in", "refunded", "", "VALID; DROP TABLE tickets"]) {
    const { prisma } = lifecyclePrisma(ticketRow());
    const { module: service, restore } = load(prisma);
    try {
      await assert.rejects(
        service.updateTicketStatus({ ticketId: "ticket-1", status }),
        (error) => error.statusCode === 400,
        JSON.stringify(status),
      );
    } finally {
      restore();
    }
  }
});

test("cancelling a paid ticket is allowed and writes the new status", async () => {
  const { writes, prisma } = lifecyclePrisma(ticketRow());
  const { module: service, restore } = load(prisma);
  try {
    await service.updateTicketStatus({ ticketId: "ticket-1", status: "Cancelled" });
    // Case-insensitive, because the value arrives from an admin UI.
    assert.equal(writes[0].data.status, "cancelled");
  } finally {
    restore();
  }
});

test("only a paid, unused ticket can be reissued", async () => {
  const cases = [
    ["unpaid order", ticketRow({ order: { status: "pending_payment" } })],
    ["cancelled ticket", ticketRow({ status: "cancelled" })],
    ["already checked in", ticketRow({ status: "checked_in" })],
  ];
  for (const [label, ticket] of cases) {
    const { writes, prisma } = lifecyclePrisma(ticket);
    const { module: service, restore } = load(prisma);
    try {
      await assert.rejects(
        service.reissueTicket({ ticketId: "ticket-1" }),
        (error) => error.statusCode === 409,
        label,
      );
      // No token version bump: the old QR must stay the only valid one.
      assert.equal(writes.length, 0, label);
    } finally {
      restore();
    }
  }
});

test("reissuing bumps the token version so the previous QR stops working", async () => {
  const { writes, prisma } = lifecyclePrisma(ticketRow());
  const { module: service, restore } = load(prisma);
  try {
    await service.reissueTicket({ ticketId: "ticket-1" });
    assert.deepEqual(writes[0].data.tokenVersion, { increment: 1 });
  } finally {
    restore();
  }
});

test("a missing ticket is a 404 rather than a silent no-op", async () => {
  const prisma = {
    ticket: { findUnique: async () => null },
    $transaction: async (work) => work({ ticket: { findUnique: async () => null } }),
  };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.updateTicketStatus({ ticketId: "nope", status: "cancelled" }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      service.reissueTicket({ ticketId: "nope" }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      service.checkInTicketById({ ticketId: "nope", eventId: "event-1", admin: {} }),
      (error) => error.statusCode === 404,
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Event configuration.
//
// Everything a buyer is later charged, and every seat that can be sold, comes
// from this validation. A bad price or capacity accepted here is not caught
// downstream -- the order path trusts the event row -- so each rule is asserted
// rather than covered incidentally by one happy-path save.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const eventInput = (over = {}) => ({
  seriesId: "series-1",
  title: "Grand Finals",
  slug: "finals-2026",
  description: "The finals.",
  venue: "Colombo",
  status: "on_sale",
  capacity: 100,
  maxTicketsPerOrder: 10,
  currency: "LKR",
  singlePrice: 500,
  pairPrice: 800,
  paymentMethods: ["payhere"],
  bankTransferReviewMinutes: 60,
  salesStartAt: new Date(Date.now() + HOUR).toISOString(),
  salesEndAt: new Date(Date.now() + 2 * HOUR).toISOString(),
  startsAt: new Date(Date.now() + 3 * HOUR).toISOString(),
  endsAt: new Date(Date.now() + 4 * HOUR).toISOString(),
  ...over,
});

// A save that would succeed: series exists, slug is free, nothing reserved.
const savePrisma = ({ existing = null, reserved = 0 } = {}) => {
  const writes = [];
  return {
    writes,
    prisma: {
      ticketEvent: {
        findUnique: async () => existing,
        findFirst: async () => null,
        create: async ({ data }) => { writes.push(data); return { id: "event-1", ...data }; },
        update: async ({ data }) => { writes.push(data); return { id: "event-1", ...data }; },
      },
      eventSeries: { findUnique: async () => ({ id: "series-1" }) },
      ticketOrder: {
        aggregate: async () => ({ _sum: { quantity: reserved, total: 0 } }),
        groupBy: async () => [],
      },
      ticket: { groupBy: async () => [] },
      // getEventStats passes an ARRAY of promises; saveAdminEvent passes a
      // callback only when there is audit context.
      $transaction: async (work) => (typeof work === "function" ? work({}) : Promise.all(work)),
    },
  };
};

const rejectsSave = async (service, over, predicate, label) => {
  await assert.rejects(
    service.saveAdminEvent({ body: eventInput(over) }),
    predicate,
    label,
  );
};

test("event capacity and per-order limits are bounded on both sides", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    // Zero capacity sells nothing; a million-plus is a typo, not an arena.
    for (const [label, over] of [
      ["zero capacity", { capacity: 0 }],
      ["capacity over one million", { capacity: 1_000_001 }],
      ["zero per-order limit", { maxTicketsPerOrder: 0 }],
      ["per-order limit over 100", { maxTicketsPerOrder: 101 }],
    ]) {
      await rejectsSave(service, over, (e) => e.statusCode === 400 && /capacity or order limit/i.test(e.message), label);
    }
  } finally {
    restore();
  }
});

test("a currency that is not a three-letter code is refused", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    for (const currency of ["L", "LKRR", "12A", "", "L K"]) {
      await rejectsSave(service, { currency }, (e) => e.statusCode === 400 && /three-letter/i.test(e.message), currency);
    }
    // Lowercase is not a rejection: the value is upper-cased first, so an admin
    // typing "lkr" saves the same event as one typing "LKR".
    await service.saveAdminEvent({ body: eventInput({ currency: "lkr" }) });
  } finally {
    restore();
  }
});

test("the sales window must end after it starts and before doors open", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    const cases = [
      ["sales end before they start", { salesEndAt: new Date(Date.now() + HOUR / 2).toISOString() }],
      ["sales end after the event begins", { salesEndAt: new Date(Date.now() + 3.5 * HOUR).toISOString() }],
      ["event begins before sales start", { startsAt: new Date(Date.now() + HOUR / 2).toISOString() }],
    ];
    for (const [label, over] of cases) {
      // Selling a ticket for a match that already started is worse than
      // refusing a save.
      await rejectsSave(service, over, (e) => e.statusCode === 400 && /sales must end/i.test(e.message), label);
    }
  } finally {
    restore();
  }
});

test("an unknown event status is refused", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    await rejectsSave(service, { status: "live" }, (e) => e.statusCode === 400 && /status is invalid/i.test(e.message));
  } finally {
    restore();
  }
});

test("bank transfer cannot be offered without an account to pay into", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    await rejectsSave(
      service,
      { paymentMethods: ["bank_transfer"], bankName: "Bank", bankAccountName: "Quest", bankAccountNumber: "" },
      (e) => e.statusCode === 400 && /bank account details/i.test(e.message),
    );
  } finally {
    restore();
  }
});

test("at least one recognised payment method is required", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    for (const paymentMethods of [[], ["crypto"], ["", null]]) {
      await rejectsSave(service, { paymentMethods }, (e) => e.statusCode === 400 && /payment method/i.test(e.message), JSON.stringify(paymentMethods));
    }
  } finally {
    restore();
  }
});

test("oversized event text is refused rather than silently truncated", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    for (const [label, over] of [
      ["title over 200", { title: "a".repeat(201) }],
      ["venue over 300", { venue: "a".repeat(301) }],
      ["description over 10k", { description: "a".repeat(10_001) }],
    ]) {
      await rejectsSave(service, over, (e) => e.statusCode === 400 && /exceed the allowed length/i.test(e.message), label);
    }
  } finally {
    restore();
  }
});

test("an entrance fee must be attached to a LAN event that exists", async () => {
  const { prisma } = savePrisma();
  const { module: service, restore } = load(prisma);
  try {
    await rejectsSave(service, { seriesId: "" }, (e) => e.statusCode === 400 && /choose the lan event/i.test(e.message));
  } finally {
    restore();
  }

  const missingSeries = savePrisma();
  missingSeries.prisma.eventSeries.findUnique = async () => null;
  const second = load(missingSeries.prisma);
  try {
    await assert.rejects(
      second.module.saveAdminEvent({ body: eventInput() }),
      (e) => e.statusCode === 400 && /lan event was not found/i.test(e.message),
    );
  } finally {
    second.restore();
  }
});

test("capacity cannot be cut below tickets already reserved or paid", async () => {
  const existing = { id: "event-1", seriesId: "series-1", capacity: 100 };
  const { prisma } = savePrisma({ existing, reserved: 40 });
  const { module: service, restore } = load(prisma);
  try {
    // Shrinking under the reserved count would oversell retroactively: the
    // tickets are already sold and the seats would no longer exist.
    await assert.rejects(
      service.saveAdminEvent({ eventId: "event-1", body: eventInput({ capacity: 30 }) }),
      (e) => e.statusCode === 409 && /cannot be lower/i.test(e.message),
    );
  } finally {
    restore();
  }
});

test("capacity may be cut down to exactly the reserved count", async () => {
  const existing = { id: "event-1", seriesId: "series-1", capacity: 100 };
  const { writes, prisma } = savePrisma({ existing, reserved: 40 });
  const { module: service, restore } = load(prisma);
  try {
    await service.saveAdminEvent({ eventId: "event-1", body: eventInput({ capacity: 40 }) });
    // The boundary is inclusive: 40 reserved seats still fit in 40.
    assert.equal(writes[0].capacity, 40);
  } finally {
    restore();
  }
});

test("saving a new event that does not exist is a 404, not a silent create", async () => {
  const { prisma } = savePrisma({ existing: null });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.saveAdminEvent({ eventId: "missing", body: eventInput() }),
      (e) => e.statusCode === 404,
    );
  } finally {
    restore();
  }
});
