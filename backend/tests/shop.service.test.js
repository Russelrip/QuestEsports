const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/shop/shop.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const paymentPath = path.join(__dirname, "../src/modules/payments/payment.service.js");

const variants = [
  {
    id: "variant-1",
    name: "Small",
    sku: "QUEST-S",
    price: 3500,
    stock: 4,
    isActive: true,
    product: { name: "Quest Shirt", currency: "LKR", status: "active" },
  },
];

const load = (prisma = {}, paymentOverrides = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [envPath]: { env: { SHOP_DELIVERY_FEE_LKR: 500, SHOP_ORDER_RESERVATION_MINUTES: 30 } },
  [paymentPath]: {
    assertPayHereConfigured: () => undefined,
    createPayHereCheckout: () => ({ actionUrl: "https://sandbox.payhere.lk/pay/checkout", fields: {} }),
    isPayHereConfigured: () => false,
    releaseOrderStock: async () => true,
    expireMerchandiseOrderReservation: async () => false,
    ...paymentOverrides,
  },
});

test("merchandise quotes use authoritative variant prices and delivery fee", async () => {
  const prisma = { productVariant: { findMany: async () => variants } };
  const { module: service, restore } = load(prisma);
  try {
    const quote = await service.getMerchandiseQuote([{ variantId: "variant-1", quantity: 2 }]);
    assert.equal(quote.subtotal, 7000);
    assert.equal(quote.deliveryFee, 500);
    assert.equal(quote.total, 7500);
    assert.equal(quote.currency, "LKR");
  } finally { restore(); }
});

test("checkout rejects a stale client total before reserving inventory", async () => {
  let transactionCalls = 0;
  const prisma = {
    productVariant: { findMany: async () => variants },
    $transaction: async () => { transactionCalls += 1; },
  };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.createMerchandiseOrder({
        body: {
          email: "player@example.com",
          firstName: "Quest",
          lastName: "Player",
          phone: "0712345678",
          address: "1 Main Street",
          city: "Colombo",
          expectedTotal: 7000,
          expectedCurrency: "LKR",
          items: [{ variantId: "variant-1", quantity: 2 }],
        },
      }),
      (error) => error.statusCode === 409 && /price changed/i.test(error.message)
    );
    assert.equal(transactionCalls, 0);
  } finally { restore(); }
});

test("checkout revalidates prices inside the inventory transaction", async () => {
  let reads = 0;
  let inventoryUpdates = 0;
  const changedVariants = [{ ...variants[0], price: 4000 }];
  const tx = {
    productVariant: {
      findMany: async () => {
        reads += 1;
        return changedVariants;
      },
      updateMany: async () => {
        inventoryUpdates += 1;
        return { count: 1 };
      },
    },
  };
  const prisma = {
    productVariant: { findMany: async () => variants },
    $transaction: async (callback) => callback(tx),
  };
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      service.createMerchandiseOrder({
        body: {
          email: "player@example.com",
          firstName: "Quest",
          lastName: "Player",
          phone: "0712345678",
          address: "1 Main Street",
          city: "Colombo",
          expectedTotal: 7500,
          expectedCurrency: "LKR",
          items: [{ variantId: "variant-1", quantity: 2 }],
        },
      }),
      (error) => error.statusCode === 409 && /price changed/i.test(error.message)
    );
    assert.equal(reads, 1);
    assert.equal(inventoryUpdates, 0);
  } finally {
    restore();
  }
});

test("admins cannot manually mark orders paid or refunded", async () => {
  const { module: service, restore } = load({});
  try {
    for (const status of ["paid", "refunded"]) {
      await assert.rejects(
        service.updateAdminOrderStatus({ orderId: "order-1", status }),
        (error) => error.statusCode === 400
      );
    }
  } finally { restore(); }
});

test("commerce capabilities disable checkout without provider credentials", () => {
  const { module: service, restore } = load({});
  try {
    assert.deepEqual(service.getCommerceCapabilities(), {
      paymentsAvailable: false,
      provider: null,
      shopCheckoutAvailable: false,
    });
  } finally { restore(); }
});

test("public order lookup does not run global reservation cleanup for an unknown token", async () => {
  let expirationCalls = 0;
  const { module: service, restore } = load(
    { merchandiseOrder: { findUnique: async () => null } },
    { expireMerchandiseOrderReservation: async () => { expirationCalls += 1; } }
  );
  try {
    await assert.rejects(
      service.getOrderByToken("a".repeat(48)),
      (error) => error.statusCode === 404
    );
    assert.equal(expirationCalls, 0);
  } finally { restore(); }
});

test("public order lookup expires only the matching stale order", async () => {
  const expirationCalls = [];
  let reads = 0;
  const expiredOrder = {
    id: "order-1",
    publicToken: "b".repeat(48),
    status: "pending_payment",
    inventoryReleasedAt: null,
    currency: "LKR",
    subtotal: 1000,
    deliveryFee: 500,
    total: 1500,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-01T00:30:00.000Z"),
    items: [],
    payments: [],
  };
  const prisma = {
    merchandiseOrder: {
      findUnique: async () => {
        reads += 1;
        return reads === 1
          ? expiredOrder
          : { ...expiredOrder, status: "cancelled", inventoryReleasedAt: new Date() };
      },
    },
  };
  const { module: service, restore } = load(prisma, {
    expireMerchandiseOrderReservation: async (args) => expirationCalls.push(args),
  });
  try {
    const order = await service.getOrderByToken("b".repeat(48));
    assert.equal(order.status, "cancelled");
    assert.deepEqual(expirationCalls, [{ orderId: "order-1" }]);
    assert.equal(reads, 2);
  } finally { restore(); }
});
