const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { Prisma } = require("../../generated/prisma");
const { sendTicketOrderEmail } = require("../../lib/mail/sendTicketOrderEmail");

const PAYHERE_STATUS = {
  2: "paid",
  0: "pending",
  "-1": "cancelled",
  "-2": "failed",
  "-3": "charged_back",
};
const TERMINAL_FAILURE_STATUSES = new Set([
  "cancelled",
  "failed",
  "charged_back",
  "expired",
  "review_required",
  "refunded",
]);

const md5 = (value) =>
  crypto.createHash("md5").update(String(value)).digest("hex");
const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const formatAmount = (value) => Number(value).toFixed(2);
const RETRYABLE_PAYMENT_TRANSACTION_ERROR_CODES = new Set([
  "P2024",
  "P2028",
  "P2034",
  "P2037",
]);
const markTournamentProjectionChange = (value, changed) => {
  if (value && typeof value === "object") {
    Object.defineProperty(value, "__tournamentProjectionChanged", {
      value: Boolean(changed),
      enumerable: false,
      configurable: true,
    });
  }
  return value;
};
const waitBeforeTransactionRetry = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, attempt * 100));
const runSerializable = async (work) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10 * 1000,
        timeout: 20 * 1000,
      });
    } catch (error) {
      const shouldRetry =
        RETRYABLE_PAYMENT_TRANSACTION_ERROR_CODES.has(error?.code) &&
        attempt < 3;
      if (!shouldRetry) throw error;
      await waitBeforeTransactionRetry(attempt);
    }
  }
  throw new Error("Payment transaction retry limit was exhausted.");
};

const queueTicketOrderConfirmation = async (ticketOrderId) => {
  return prisma.$transaction(async (tx) => {
    const claimedAt = new Date();
    const claimed = await tx.ticketOrder.updateMany({
      where: {
        id: ticketOrderId,
        status: "paid",
        confirmationEmailQueuedAt: null,
      },
      data: { confirmationEmailQueuedAt: claimedAt },
    });
    if (!claimed.count) return false;
    const order = await tx.ticketOrder.findUnique({
      where: { id: ticketOrderId },
      include: { event: { select: { title: true } } },
    });
    if (!order) throw new Error("Claimed ticket order could not be loaded.");
    await sendTicketOrderEmail({
      orderId: order.id,
      email: order.email,
      firstName: order.firstName,
      eventTitle: order.event.title,
      quantity: order.quantity,
      rawToken: order.publicToken,
      database: tx,
    });
    return true;
  });
};

module.exports = {
  PAYHERE_STATUS,
  TERMINAL_FAILURE_STATUSES,
  md5,
  sha256,
  formatAmount,
  markTournamentProjectionChange,
  runSerializable,
  queueTicketOrderConfirmation,
};
