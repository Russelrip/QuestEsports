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

const load = (prisma = {}) => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma },
  [envPath]: { env: { SHOP_DELIVERY_FEE_LKR: 500, SHOP_ORDER_RESERVATION_MINUTES: 30 } },
  [paymentPath]: {
    assertPayHereConfigured: () => undefined,
    createPayHereCheckout: () => ({ actionUrl: "https://sandbox.payhere.lk/pay/checkout", fields: {} }),
    isPayHereConfigured: () => false,
    releaseOrderStock: async () => true,
    expireStaleCommerceReservations: async () => ({ expiredOrders: 0, expiredRegistrations: 0 }),
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
