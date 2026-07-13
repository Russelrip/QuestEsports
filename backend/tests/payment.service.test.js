const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const md5 = (value) => crypto.createHash("md5").update(String(value)).digest("hex");
const env = { PAYHERE_MERCHANT_ID: "1210000", PAYHERE_MERCHANT_SECRET: "secret", PAYHERE_NOTIFY_URL: "https://example.com/api/payments/payhere/notify", APP_URL: "https://example.com", PAYHERE_MODE: "sandbox" };
const signature = (body) => md5(`${body.merchant_id}${body.order_id}${body.payhere_amount}${body.payhere_currency}${body.status_code}${md5(env.PAYHERE_MERCHANT_SECRET).toUpperCase()}`).toUpperCase();
const load = (prisma = {}) => loadModuleWithMocks(servicePath, {
  [envPath]: { env },
  [prismaPath]: { prisma },
  [teamServicePath]: { activatePaidTeamRegistration: async () => undefined },
});

test("PayHere checkout hashes are generated only from the configured merchant values", () => {
  const { module: service, restore } = load();
  try {
    const expected = md5(`${env.PAYHERE_MERCHANT_ID}order-1${Number(6).toFixed(2)}USD${md5(env.PAYHERE_MERCHANT_SECRET).toUpperCase()}`).toUpperCase();
    assert.equal(service.createCheckoutHash({ orderId: "order-1", amount: 6, currency: "USD" }), expected);
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
