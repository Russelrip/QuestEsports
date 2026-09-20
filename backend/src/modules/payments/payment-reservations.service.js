const { prisma } = require("../../lib/prisma");
const {
  markTournamentProjectionChange,
  queueTicketOrderConfirmation,
} = require("./payment-shared");

const releaseOrderStock = async (
  tx,
  orderId,
  orderStatus = "cancelled",
  { restoreInventory = true, claimWhere = {} } = {},
) => {
  const claimed = await tx.merchandiseOrder.updateMany({
    where: { id: orderId, inventoryReleasedAt: null, ...claimWhere },
    data: { inventoryReleasedAt: new Date(), status: orderStatus },
  });
  if (!claimed.count) return false;
  if (!restoreInventory) return true;
  const items = await tx.merchandiseOrderItem.findMany({
    where: { orderId, variantId: { not: null } },
    select: { variantId: true, quantity: true },
  });
  for (const item of items) {
    await tx.productVariant.updateMany({
      where: { id: item.variantId, stock: { not: null } },
      data: { stock: { increment: item.quantity } },
    });
  }
  return true;
};

const expireMerchandiseOrderReservation = async ({
  orderId,
  now = new Date(),
}) =>
  prisma.$transaction(async (tx) => {
    const released = await releaseOrderStock(tx, orderId, "cancelled", {
      claimWhere: {
        status: "pending_payment",
        expiresAt: { lte: now },
      },
    });
    if (!released) return false;
    await tx.paymentTransaction.updateMany({
      where: {
        merchandiseOrderId: orderId,
        status: { in: ["created", "pending"] },
      },
      data: { status: "expired" },
    });
    return true;
  });

const expireTournamentRegistrationReservation = async ({
  registrationId,
  now = new Date(),
}) =>
  prisma.$transaction(async (tx) => {
    const released = await tx.teamRegistration.updateMany({
      where: {
        id: registrationId,
        paymentStatus: "pending",
        reservedUntil: { lte: now },
      },
      data: {
        paymentStatus: "unpaid",
        reservedUntil: null,
        assignedSlotNumber: null,
      },
    });
    if (!released.count) return false;
    await tx.paymentTransaction.updateMany({
      where: {
        registrationId,
        status: { in: ["created", "pending", "review_required"] },
      },
      data: {
        status: "expired",
        statusMessage:
          "The payment window expired and the tournament slot was released. Contact an administrator for assistance.",
      },
    });
    return true;
  });

const reconcileTicketOrderConfirmations = async ({ batchSize = 25 } = {}) => {
  const orders = await prisma.ticketOrder.findMany({
    where: { status: "paid", confirmationEmailQueuedAt: null },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(Number(batchSize) || 25, 1), 100),
    select: { id: true },
  });
  let queued = 0;
  for (const order of orders) {
    if (await queueTicketOrderConfirmation(order.id)) queued += 1;
  }
  return queued;
};

const expireStaleCommerceReservations = async ({
  now = new Date(),
  batchSize = 50,
} = {}) => {
  const expiredOrders = await prisma.merchandiseOrder.findMany({
    where: {
      status: "pending_payment",
      expiresAt: { lte: now },
      inventoryReleasedAt: null,
    },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  let expiredOrderCount = 0;
  for (const order of expiredOrders) {
    const expired = await expireMerchandiseOrderReservation({
      orderId: order.id,
      now,
    });
    if (expired) expiredOrderCount += 1;
  }

  const expiredRegistrations = await prisma.teamRegistration.findMany({
    where: {
      paymentStatus: "pending",
      reservedUntil: { lte: now },
    },
    orderBy: { reservedUntil: "asc" },
    take: batchSize,
    select: { id: true },
  });
  let expiredRegistrationCount = 0;
  for (const registration of expiredRegistrations) {
    const expired = await expireTournamentRegistrationReservation({
      registrationId: registration.id,
      now,
    });
    if (expired) expiredRegistrationCount += 1;
  }

  const expiredTicketOrders = prisma.ticketOrder?.findMany
    ? await prisma.ticketOrder.findMany({
        where: {
          status: "pending_payment",
          capacityReleasedAt: null,
          expiresAt: { lte: now },
        },
        orderBy: { expiresAt: "asc" },
        take: batchSize,
        select: { id: true },
      })
    : [];
  let expiredTicketOrderCount = 0;
  const { expireTicketOrderReservation } = require("../tickets/ticket.service");
  for (const order of expiredTicketOrders) {
    const expired = await expireTicketOrderReservation({
      orderId: order.id,
      now,
    });
    if (expired) expiredTicketOrderCount += 1;
  }

  return markTournamentProjectionChange({
    expiredOrders: expiredOrderCount,
    expiredRegistrations: expiredRegistrationCount,
    expiredTicketOrders: expiredTicketOrderCount,
  }, expiredRegistrationCount > 0);
};

module.exports = {
  releaseOrderStock,
  expireMerchandiseOrderReservation,
  expireTournamentRegistrationReservation,
  reconcileTicketOrderConfirmations,
  expireStaleCommerceReservations,
};
