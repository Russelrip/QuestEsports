const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const ticketEmailPath = path.join(__dirname, "../src/lib/mail/sendTicketOrderEmail.js");
const md5 = (value) => crypto.createHash("md5").update(String(value)).digest("hex");
const env = { PAYHERE_MERCHANT_ID: "1210000", PAYHERE_MERCHANT_SECRET: "secret", PAYHERE_NOTIFY_URL: "https://example.com/api/payments/payhere/notify", APP_URL: "https://example.com", PAYHERE_MODE: "sandbox" };
const signature = (body) => md5(`${body.merchant_id}${body.order_id}${body.payhere_amount}${body.payhere_currency}${body.status_code}${md5(env.PAYHERE_MERCHANT_SECRET).toUpperCase()}`).toUpperCase();
const load = (prisma = {}, additionalMocks = {}) => loadModuleWithMocks(servicePath, {
  [envPath]: { env },
  [prismaPath]: { prisma },
  [teamServicePath]: { activatePaidTeamRegistration: async () => undefined },
  ...additionalMocks,
});

test("PayHere checkout hashes are generated only from the configured merchant values", () => {
  const { module: service, restore } = load();
  try {
    const expected = md5(`${env.PAYHERE_MERCHANT_ID}order-1${Number(6).toFixed(2)}USD${md5(env.PAYHERE_MERCHANT_SECRET).toUpperCase()}`).toUpperCase();
    assert.equal(service.createCheckoutHash({ orderId: "order-1", amount: 6, currency: "USD" }), expected);
  } finally { restore(); }
});

test("tournament payment details stay locked while roster invitations are pending", async () => {
  const prisma = {
    paymentTransaction: {
      findUnique: async () => ({
        providerOrderId: "TOUR-locked",
        provider: "payhere",
        status: "created",
        registration: {
          userId: "captain-1",
          verificationStatus: "pending",
          tournament: {},
        },
        merchandiseOrder: null,
      }),
    },
  };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.getPaymentStatus({ providerOrderId: "TOUR-locked", userId: "captain-1" }),
      (error) => error.statusCode === 409 && /Every roster member/.test(error.message)
    );
  } finally { restore(); }
});

test("PayHere notification signatures reject tampering", () => {
  const { module: service, restore } = load();
  try {
    const body = { merchant_id: env.PAYHERE_MERCHANT_ID, order_id: "order-2", payhere_amount: "1000.00", payhere_currency: "LKR", status_code: "2" };
    body.md5sig = signature(body);
    assert.equal(service.verifyNotificationSignature(body), true);
    assert.equal(service.verifyNotificationSignature({ ...body, payhere_amount: "999.00" }), false);
  } finally { restore(); }
});

test("notification processing rejects amount and currency mismatches", async () => {
  const prisma = { paymentTransaction: { findUnique: async () => ({ id: "tx-1", amount: 1000, currency: "LKR" }) } };
  const { module: service, restore } = load(prisma);
  try {
    const body = { merchant_id: env.PAYHERE_MERCHANT_ID, order_id: "order-3", payment_id: "pay-1", payhere_amount: "900.00", payhere_currency: "LKR", status_code: "2" };
    body.md5sig = signature(body);
    await assert.rejects(service.processPayHereNotification(body), (error) => error.statusCode === 400 && /amount or currency/.test(error.message));
  } finally { restore(); }
});

test("duplicate notifications are idempotent", async () => {
  let updateCalls = 0;
  const body = { merchant_id: env.PAYHERE_MERCHANT_ID, order_id: "order-4", payment_id: "pay-2", payhere_amount: "1000.00", payhere_currency: "LKR", status_code: "2", method: "VISA" };
  body.md5sig = signature(body);
  const digest = crypto.createHash("sha256").update([body.order_id, body.payment_id, body.payhere_amount, body.payhere_currency, body.status_code, body.md5sig].join("|")).digest("hex");
  const current = { id: "tx-2", providerOrderId: body.order_id, amount: 1000, currency: "LKR", status: "paid", notificationDigest: digest };
  const tx = {
    paymentTransaction: { findUnique: async () => current, update: async () => { updateCalls += 1; } },
    paymentNotificationAudit: { create: async () => undefined },
  };
  const prisma = { paymentTransaction: { findUnique: async () => current }, $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    assert.equal(await service.processPayHereNotification(body), current);
    assert.equal(updateCalls, 0);
  } finally { restore(); }
});

test("late successful notifications are routed to manual review", async () => {
  const body = { merchant_id: env.PAYHERE_MERCHANT_ID, order_id: "order-late", payment_id: "pay-late", payhere_amount: "1000.00", payhere_currency: "LKR", status_code: "2", method: "VISA" };
  body.md5sig = signature(body);
  const current = { id: "tx-late", providerOrderId: body.order_id, amount: 1000, currency: "LKR", status: "expired", notificationDigest: null, registrationId: null, merchandiseOrderId: null };
  let appliedStatus = null;
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => ({ ...current, ...data }),
    },
    paymentNotificationAudit: {
      create: async ({ data }) => { appliedStatus = data.appliedStatus; },
    },
  };
  const prisma = { paymentTransaction: { findUnique: async () => current }, $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.processPayHereNotification(body);
    assert.equal(result.status, "review_required");
    assert.equal(appliedStatus, "review_required");
  } finally { restore(); }
});

test("PayHere role conflicts preserve the signed payment as review_required with an audit", async () => {
  const body = {
    merchant_id: env.PAYHERE_MERCHANT_ID,
    order_id: "order-role-conflict",
    payment_id: "pay-role-conflict",
    payhere_amount: "1000.00",
    payhere_currency: "LKR",
    status_code: "2",
    method: "VISA",
  };
  body.md5sig = signature(body);
  const current = {
    id: "tx-role-conflict",
    providerOrderId: body.order_id,
    amount: 1000,
    currency: "LKR",
    status: "pending",
    notificationDigest: null,
    registrationId: "registration-1",
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      status: "pending",
      paymentStatus: "pending",
      reservedUntil: new Date(Date.now() + 60_000),
      members: [{ role: "PLAYER", email: "player@example.com", riotId: "Player#001" }],
      tournament: { maxTeams: 10 },
    },
    merchandiseOrderId: null,
    ticketOrderId: null,
  };
  let updateData;
  let auditData;
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => {
        updateData = data;
        return { ...current, ...data };
      },
    },
    teamRegistration: {
      findMany: async () => [{ members: [{ role: "COACH", email: "coach@example.com", riotId: "Player#001" }] }],
    },
    paymentNotificationAudit: {
      create: async ({ data }) => { auditData = data; },
    },
  };
  const { module: service, restore } = load({
    paymentTransaction: { findUnique: async () => current },
    $transaction: async (callback) => callback(tx),
  });
  try {
    const result = await service.processPayHereNotification(body);
    assert.equal(result.status, "review_required");
    assert.equal(updateData.status, "review_required");
    assert.match(updateData.statusMessage, /coach\/player role conflict/);
    assert.equal(auditData.appliedStatus, "review_required");
  } finally {
    restore();
  }
});

test("paid ticket state and its confirmation job commit in one transaction", async () => {
  const body = {
    merchant_id: env.PAYHERE_MERCHANT_ID,
    order_id: "ticket-order-payment",
    payment_id: "pay-ticket",
    payhere_amount: "2000.00",
    payhere_currency: "LKR",
    status_code: "2",
    method: "VISA",
  };
  body.md5sig = signature(body);
  const current = {
    id: "tx-ticket",
    providerOrderId: body.order_id,
    amount: 2000,
    currency: "LKR",
    status: "pending",
    notificationDigest: null,
    registrationId: null,
    merchandiseOrderId: null,
    ticketOrderId: "ticket-order-1",
    ticketOrder: {
      id: "ticket-order-1",
      status: "pending_payment",
      capacityReleasedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      event: { status: "on_sale" },
    },
  };
  const ticketOrderUpdates = [];
  const emailCalls = [];
  const order = {
    id: "ticket-order-1",
    email: "buyer@example.com",
    firstName: "Buyer",
    quantity: 2,
    publicToken: "public-token",
    confirmationEmailQueuedAt: null,
    event: { title: "Quest LAN" },
  };
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => ({ ...current, ...data }),
    },
    ticketOrder: {
      update: async (args) => {
        ticketOrderUpdates.push(args);
        return order;
      },
    },
    ticket: { updateMany: async () => ({ count: 2 }) },
    paymentNotificationAudit: { create: async () => undefined },
  };
  const prisma = {
    paymentTransaction: { findUnique: async () => current },
    $transaction: async (callback) => callback(tx),
  };
  const { module: service, restore } = load(prisma, {
    [ticketEmailPath]: {
      sendTicketOrderEmail: async (args) => emailCalls.push(args),
    },
  });
  try {
    const result = await service.processPayHereNotification(body);
    assert.equal(result.status, "paid");
    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0].database, tx);
    assert.equal(emailCalls[0].rawToken, "public-token");
    assert.ok(ticketOrderUpdates[1].data.confirmationEmailQueuedAt instanceof Date);
  } finally {
    restore();
  }
});

test("ticket confirmation repair claims and enqueues within one transaction", async () => {
  const emailCalls = [];
  const tx = {
    ticketOrder: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({
        id: "ticket-order-repair",
        email: "buyer@example.com",
        firstName: "Buyer",
        quantity: 1,
        publicToken: "repair-token",
        event: { title: "Quest LAN" },
      }),
    },
  };
  const prisma = {
    ticketOrder: {
      findMany: async () => [{ id: "ticket-order-repair" }],
    },
    $transaction: async (callback) => callback(tx),
  };
  const { module: service, restore } = load(prisma, {
    [ticketEmailPath]: {
      sendTicketOrderEmail: async (args) => emailCalls.push(args),
    },
  });

  try {
    assert.equal(await service.reconcileTicketOrderConfirmations(), 1);
    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0].database, tx);
  } finally {
    restore();
  }
});

test("admin cash confirmation activates pending entrance tickets", async () => {
  const emailCalls = [];
  const ticketOrder = {
    id: "cash-order-1",
    email: "cash@example.com",
    firstName: "Cash",
    quantity: 1,
    publicToken: "cash-token",
    confirmationEmailQueuedAt: null,
    capacityReleasedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    event: { title: "Quest LAN", status: "on_sale" },
  };
  const current = {
    id: "cash-payment-1",
    provider: "cash",
    purpose: "ticket_order",
    status: "pending",
    ticketOrderId: ticketOrder.id,
    ticketOrder,
  };
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => ({ ...current, ...data }),
    },
    ticketOrder: {
      update: async ({ data }) => ({ ...ticketOrder, ...data }),
    },
    ticket: { updateMany: async () => ({ count: 1 }) },
  };
  const { module: service, restore } = load(
    { $transaction: async (callback) => callback(tx) },
    {
      [ticketEmailPath]: {
        sendTicketOrderEmail: async (args) => emailCalls.push(args),
      },
    },
  );
  try {
    const result = await service.reconcileCashTicketPayment({
      transactionId: current.id,
      decision: "confirm",
      note: "Collected at Gate A",
      admin: { id: "admin-1" },
    });
    assert.equal(result.status, "paid");
    assert.equal(emailCalls.length, 1);
  } finally {
    restore();
  }
});

test("expired registration maintenance releases review-required bank transfers", async () => {
  const transactionUpdates = [];
  const registrationUpdates = [];
  const now = new Date("2026-07-14T12:00:00.000Z");
  const prisma = {
    merchandiseOrder: { findMany: async () => [] },
    teamRegistration: {
      findMany: async () => [{ id: "registration-expired" }],
    },
    $transaction: async (callback) => callback({
      teamRegistration: {
        updateMany: async (args) => {
          registrationUpdates.push(args);
          return { count: 1 };
        },
      },
      paymentTransaction: {
        updateMany: async (args) => {
          transactionUpdates.push(args);
          return { count: 1 };
        },
      },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.expireStaleCommerceReservations({ now });
    assert.equal(result.expiredRegistrations, 1);
    assert.deepEqual(transactionUpdates[0].where.status.in, [
      "created",
      "pending",
      "review_required",
    ]);
    assert.equal(transactionUpdates[0].data.status, "expired");
    assert.equal(registrationUpdates[0].data.assignedSlotNumber, null);
  } finally {
    restore();
  }
});

test("payment status immediately expires a stale tournament reservation", async () => {
  const expiredAt = new Date("2026-07-14T11:59:00.000Z");
  const current = {
    id: "payment-expired",
    providerOrderId: "TOUR-expired",
    provider: "payhere",
    status: "pending",
    amount: 2500,
    currency: "LKR",
    purpose: "tournament_registration",
    statusMessage: null,
    updatedAt: expiredAt,
    bankTransferProof: null,
    merchandiseOrder: null,
    registration: {
      id: "registration-expired",
      userId: "captain-1",
      paymentStatus: "pending",
      verificationStatus: "verified",
      reservedUntil: expiredAt,
      assignedSlotNumber: null,
      tournament: { contactLink: "https://discord.gg/quest" },
    },
  };
  const prisma = {
    paymentTransaction: { findUnique: async () => current },
    $transaction: async (callback) => callback({
      teamRegistration: {
        updateMany: async () => {
          current.registration.paymentStatus = "unpaid";
          current.registration.reservedUntil = null;
          return { count: 1 };
        },
      },
      paymentTransaction: {
        updateMany: async ({ data }) => {
          Object.assign(current, data);
          return { count: 1 };
        },
      },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.getPaymentStatus({
      providerOrderId: current.providerOrderId,
      userId: "captain-1",
    });
    assert.equal(result.status, "expired");
    assert.equal(result.registration.expiresAt, null);
    assert.equal(result.registration.contactLink, "https://discord.gg/quest");
    assert.match(result.statusMessage, /Contact an administrator/);
  } finally {
    restore();
  }
});

test("admins can reopen an expired PayHere tournament payment", async () => {
  let registrationUpdate;
  let paymentUpdate;
  const current = {
    id: "payment-payhere-expired",
    provider: "payhere",
    purpose: "tournament_registration",
    status: "expired",
    amount: 2500,
    bankTransferProof: null,
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      status: "pending",
      paymentStatus: "unpaid",
      tournament: {
        maxTeams: 16,
        reservationMinutes: 30,
        bankTransferReviewMinutes: 1440,
        registrationFeeCurrency: "LKR",
      },
    },
  };
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => {
        paymentUpdate = data;
        return { ...current, ...data };
      },
    },
    teamRegistration: {
      count: async () => 0,
      update: async ({ data }) => {
        registrationUpdate = data;
      },
    },
  };
  const { module: service, restore } = load({
    $transaction: async (callback) => callback(tx),
  });
  try {
    await service.reopenExpiredTournamentPayment({
      transactionId: current.id,
      admin: { id: "admin-1" },
    });
    assert.equal(registrationUpdate.paymentStatus, "pending");
    assert.equal(registrationUpdate.assignedSlotNumber, null);
    assert.ok(registrationUpdate.reservedUntil instanceof Date);
    assert.equal(paymentUpdate.status, "pending");
  } finally {
    restore();
  }
});

test("expired payment reopening rejects an active same-tournament coach/player conflict", async () => {
  const current = {
    id: "payment-payhere-expired-conflict",
    provider: "payhere",
    purpose: "tournament_registration",
    status: "expired",
    amount: 2500,
    bankTransferProof: null,
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      status: "pending",
      paymentStatus: "unpaid",
      members: [{ role: "PLAYER", email: "player@example.com", riotId: "Player#001" }],
      tournament: {
        maxTeams: 16,
        reservationMinutes: 30,
        bankTransferReviewMinutes: 1440,
        registrationFeeCurrency: "LKR",
      },
    },
  };
  const queryCalls = [];
  const tx = {
    paymentTransaction: { findUnique: async () => current },
    teamRegistration: {
      findMany: async (args) => {
        queryCalls.push(args);
        return [{ members: [{ role: "COACH", email: "coach@example.com", riotId: "Player#001" }] }];
      },
    },
  };
  const { module: service, restore } = load({
    $transaction: async (callback) => callback(tx),
  });
  try {
    await assert.rejects(
      service.reopenExpiredTournamentPayment({
        transactionId: current.id,
        admin: { id: "admin-1" },
      }),
      (error) => error.statusCode === 409 && /both a coach and a player/.test(error.message)
    );
    assert.equal(queryCalls[0].where.tournamentId, "tournament-1");
    assert.equal(queryCalls[0].where.id.not, "registration-1");
  } finally {
    restore();
  }
});

test("expired order maintenance cannot cancel an order that became paid", async () => {
  let inventoryQueries = 0;
  let paymentUpdates = 0;
  const now = new Date("2026-07-14T12:00:00.000Z");
  const prisma = {
    merchandiseOrder: { findMany: async () => [{ id: "order-paid" }] },
    teamRegistration: { findMany: async () => [] },
    $transaction: async (callback) => callback({
      merchandiseOrder: {
        updateMany: async ({ where }) => {
          assert.equal(where.status, "pending_payment");
          assert.deepEqual(where.expiresAt, { lte: now });
          return { count: 0 };
        },
      },
      merchandiseOrderItem: {
        findMany: async () => {
          inventoryQueries += 1;
          return [];
        },
      },
      paymentTransaction: {
        updateMany: async () => {
          paymentUpdates += 1;
          return { count: 1 };
        },
      },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    await service.expireStaleCommerceReservations({ now });
    assert.equal(inventoryQueries, 0);
    assert.equal(paymentUpdates, 0);
  } finally {
    restore();
  }
});

test("manual PayHere reconciliation records an externally completed refund", async () => {
  const current = {
    id: "tx-review",
    provider: "payhere",
    status: "review_required",
    registrationId: null,
    merchandiseOrderId: "order-review",
    merchandiseOrder: {
      id: "order-review",
      inventoryReleasedAt: new Date("2026-07-14T10:00:00.000Z"),
    },
  };
  let paymentUpdate = null;
  const tx = {
    paymentTransaction: {
      findUnique: async () => current,
      update: async ({ data }) => {
        paymentUpdate = data;
        return { ...current, ...data };
      },
    },
    merchandiseOrder: {
      findUnique: async () => ({ status: "cancelled" }),
      updateMany: async () => ({ count: 0 }),
    },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.reconcilePayHerePayment({
      transactionId: current.id,
      decision: "mark_refunded",
      note: "Refund completed in PayHere after the order expired.",
      providerRefundId: "refund-123",
      admin: { id: "admin-1" },
    });
    assert.equal(result.status, "refunded");
    assert.equal(paymentUpdate.providerRefundId, "refund-123");
    assert.equal(paymentUpdate.reconciledById, "admin-1");
  } finally {
    restore();
  }
});

test("manual PayHere acceptance refuses orders whose inventory was released", async () => {
  const current = {
    id: "tx-no-stock",
    provider: "payhere",
    status: "review_required",
    registrationId: null,
    merchandiseOrderId: "order-no-stock",
    merchandiseOrder: { inventoryReleasedAt: new Date() },
  };
  const prisma = {
    $transaction: async (callback) => callback({
      paymentTransaction: { findUnique: async () => current },
    }),
  };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.reconcilePayHerePayment({
        transactionId: current.id,
        decision: "accept",
        note: "Verified in PayHere.",
        admin: { id: "admin-1" },
      }),
      (error) => error.statusCode === 409 && /inventory was released/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("late PayHere acceptance rejects an active same-tournament coach/player conflict", async () => {
  const current = {
    id: "tx-late-conflict",
    provider: "payhere",
    status: "review_required",
    registrationId: "registration-1",
    registration: {
      id: "registration-1",
      tournamentId: "tournament-1",
      status: "pending",
      paymentStatus: "unpaid",
      members: [{ role: "PLAYER", email: "player@example.com", riotId: "Player#001" }],
      tournament: { maxTeams: 16 },
    },
    merchandiseOrderId: null,
    ticketOrderId: null,
  };
  const queryCalls = [];
  const tx = {
    paymentTransaction: { findUnique: async () => current },
    teamRegistration: {
      findMany: async (args) => {
        queryCalls.push(args);
        return [{ members: [{ role: "COACH", email: "coach@example.com", riotId: "Player#001" }] }];
      },
    },
  };
  const { module: service, restore } = load({
    $transaction: async (callback) => callback(tx),
  });
  try {
    await assert.rejects(
      service.reconcilePayHerePayment({
        transactionId: current.id,
        decision: "accept",
        note: "Verified in PayHere.",
        admin: { id: "admin-1" },
      }),
      (error) => error.statusCode === 409 && /both a coach and a player/.test(error.message)
    );
    assert.equal(queryCalls[0].where.tournamentId, "tournament-1");
    assert.equal(queryCalls[0].where.id.not, "registration-1");
  } finally {
    restore();
  }
});

test("listPaymentTransactions returns lightweight searchable summaries", async () => {
  const findManyCalls = [];
  const prisma = {
    paymentTransaction: {
      count: async () => 1,
      findMany: async (args) => {
        findManyCalls.push(args);
        return [{
          id: "payment-1",
          providerOrderId: "ORDER-001",
          providerPaymentId: null,
          purpose: "tournament_registration",
          provider: "bank_transfer",
          amount: 2500,
          currency: "LKR",
          status: "review_required",
          method: "bank_transfer",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          registration: { teamName: "Quest Five", contactEmail: "captain@example.com" },
          merchandiseOrder: null,
        }];
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.listPaymentTransactions({ search: "Quest", pageSize: "20" });
    assert.equal(findManyCalls[0].select.bankTransferProof, undefined);
    assert.equal(findManyCalls[0].where.OR[2].registration.is.OR[0].teamName.contains, "Quest");
    assert.equal(result.items[0].customerName, "Quest Five");
    assert.equal(result.items[0].bankTransferProof, undefined);
  } finally {
    restore();
  }
});

test("getAdminPaymentTransaction loads proof and reconciliation detail on demand", async () => {
  const prisma = {
    paymentTransaction: {
      findUnique: async () => ({
        id: "payment-1",
        providerOrderId: "ORDER-001",
        providerPaymentId: null,
        purpose: "tournament_registration",
        provider: "bank_transfer",
        amount: 2500,
        currency: "LKR",
        status: "review_required",
        method: "bank_transfer",
        statusMessage: "Awaiting review",
        reconciledAt: null,
        reconciliationNote: null,
        providerRefundId: null,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        updatedAt: new Date("2026-07-20T11:00:00.000Z"),
        registration: { id: "registration-1", teamName: "Quest Five", contactEmail: "captain@example.com", assignedSlotNumber: 1, reservedUntil: null },
        merchandiseOrder: null,
        bankTransferProof: { originalFilename: "receipt.png", contentType: "image/png", byteSize: 1000, submittedAt: new Date(), reviewedAt: null, rejectionReason: null },
      }),
    },
  };
  const { module: service, restore } = load(prisma);
  try {
    const result = await service.getAdminPaymentTransaction("payment-1");
    assert.equal(result.bankTransferProof.originalFilename, "receipt.png");
    assert.equal(result.registration.teamName, "Quest Five");
  } finally {
    restore();
  }
});
