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
