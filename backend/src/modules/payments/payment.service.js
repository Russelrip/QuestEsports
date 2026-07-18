const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { Prisma } = require("../../generated/prisma");
const { countTournamentCapacityUsage } = require("../tournaments/registration-eligibility");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const { buildBankTransferInstructions } = require("./bank-transfer.service");

const PAYHERE_STATUS = {
  "2": "paid",
  "0": "pending",
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

const md5 = (value) => crypto.createHash("md5").update(String(value)).digest("hex");
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const formatAmount = (value) => Number(value).toFixed(2);
const runSerializable = async (work) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error?.code !== "P2034" || attempt === 3) throw error;
    }
  }
};

const isPayHereConfigured = () =>
  Boolean(
    env.PAYHERE_MERCHANT_ID &&
      env.PAYHERE_MERCHANT_SECRET &&
      env.PAYHERE_NOTIFY_URL &&
      env.APP_URL
  );

const assertPayHereConfigured = () => {
  if (!isPayHereConfigured()) {
    throw new HttpError(
      503,
      "Online payments are not configured yet. Please contact Quest E-sports."
    );
  }
};

const createCheckoutHash = ({ orderId, amount, currency }) => {
  assertPayHereConfigured();
  return md5(
    `${env.PAYHERE_MERCHANT_ID}${orderId}${formatAmount(amount)}${currency}${md5(
      env.PAYHERE_MERCHANT_SECRET
    ).toUpperCase()}`
  ).toUpperCase();
};

const createPayHereCheckout = ({ transaction, customer, items, returnPath, cancelPath }) => {
  assertPayHereConfigured();
  const appUrl = env.APP_URL.replace(/\/$/, "");
  const currency = transaction.currency.toUpperCase();
  const amount = formatAmount(transaction.amount);

  return {
    actionUrl:
      env.PAYHERE_MODE === "live"
        ? "https://www.payhere.lk/pay/checkout"
        : "https://sandbox.payhere.lk/pay/checkout",
    fields: {
      merchant_id: env.PAYHERE_MERCHANT_ID,
      return_url: `${appUrl}${returnPath}`,
      cancel_url: `${appUrl}${cancelPath}`,
      notify_url: env.PAYHERE_NOTIFY_URL,
      first_name: customer.firstName,
      last_name: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      address: customer.address || "Not applicable",
      city: customer.city || "Colombo",
      country: customer.country || "Sri Lanka",
      order_id: transaction.providerOrderId,
      items,
      currency,
      amount,
      hash: createCheckoutHash({
        orderId: transaction.providerOrderId,
        amount,
        currency,
      }),
    },
  };
};

const verifyNotificationSignature = (body) => {
  assertPayHereConfigured();
  const localSignature = md5(
    `${body.merchant_id}${body.order_id}${body.payhere_amount}${body.payhere_currency}${body.status_code}${md5(
      env.PAYHERE_MERCHANT_SECRET
    ).toUpperCase()}`
  ).toUpperCase();

  const received = String(body.md5sig || "").toUpperCase();
  if (!received || received.length !== localSignature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(localSignature));
};

const releaseOrderStock = async (
  tx,
  orderId,
  orderStatus = "cancelled",
  { restoreInventory = true, claimWhere = {} } = {}
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

const applyTargetStatus = async ({ tx, transaction, previousStatus, status }) => {
  if (transaction.registrationId) {
    if (tx.adminSlotReservation?.deleteMany) {
      await tx.adminSlotReservation.deleteMany({
        where: { registrationId: transaction.registrationId },
      });
    }
    if (status === "paid") {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "paid", reservedUntil: null },
      });
    } else if (["cancelled", "failed", "charged_back", "refunded"].includes(status)) {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "unpaid", reservedUntil: null },
      });
    } else if (status === "pending") {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "pending" },
      });
    }
  }

  if (transaction.merchandiseOrderId) {
    if (status === "paid") {
      await tx.merchandiseOrder.update({
        where: { id: transaction.merchandiseOrderId },
        data: { status: "paid" },
      });
    } else if (
      ["cancelled", "failed", "charged_back", "refunded"].includes(status) &&
      !["cancelled", "failed", "charged_back", "refunded"].includes(previousStatus)
    ) {
      const order = await tx.merchandiseOrder.findUnique({
        where: { id: transaction.merchandiseOrderId },
        select: { status: true },
      });
      await releaseOrderStock(
        tx,
        transaction.merchandiseOrderId,
        ["charged_back", "refunded"].includes(status) ? "refunded" : "cancelled",
        { restoreInventory: order?.status !== "fulfilled" }
      );
    }
  }
};

const getSafeNotificationPayload = (body) => ({
  merchantId: String(body.merchant_id || ""),
  orderId: String(body.order_id || ""),
  paymentId: String(body.payment_id || ""),
  amount: String(body.payhere_amount || ""),
  currency: String(body.payhere_currency || ""),
  providerStatus: String(body.status_code || ""),
  method: String(body.method || ""),
  statusMessage: String(body.status_message || "").slice(0, 500),
});

const resolvePaidStatus = async ({ tx, current, now }) => {
  if (TERMINAL_FAILURE_STATUSES.has(current.status)) return "review_required";

  if (current.registrationId) {
    const registration = current.registration;
    if (
      !registration ||
      registration.status === "rejected" ||
      (registration.paymentStatus !== "paid" &&
        (!registration.reservedUntil || registration.reservedUntil <= now))
    ) {
      return "review_required";
    }
    const activeCount = await countTournamentCapacityUsage({ tx, tournamentId: registration.tournamentId, excludeRegistrationId: registration.id, now });
    if (activeCount >= registration.tournament.maxTeams) {
      return "review_required";
    }
  }

  if (current.merchandiseOrderId) {
    const order = current.merchandiseOrder;
    if (
      !order ||
      order.inventoryReleasedAt ||
      (order.status === "pending_payment" && order.expiresAt <= now)
    ) {
      return "review_required";
    }
  }

  return "paid";
};

const processPayHereNotification = async (body) => {
  const orderId = String(body.order_id || "").trim();
  if (!orderId) throw new HttpError(400, "Payment order ID is required.");
  if (String(body.merchant_id || "") !== env.PAYHERE_MERCHANT_ID) {
    logger.warn("PayHere notification rejected: merchant mismatch", { orderId });
    throw new HttpError(400, "Payment merchant does not match.");
  }
  if (!verifyNotificationSignature(body)) {
    logger.warn("PayHere notification rejected: invalid signature", { orderId });
    throw new HttpError(400, "Payment notification signature is invalid.");
  }

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { providerOrderId: orderId },
  });
  if (!transaction) throw new HttpError(404, "Payment transaction not found.");

  const currency = String(body.payhere_currency || "").toUpperCase();
  const amount = formatAmount(body.payhere_amount);
  if (currency !== transaction.currency || amount !== formatAmount(transaction.amount)) {
    logger.warn("PayHere notification rejected: amount or currency mismatch", { orderId, receivedAmount: amount, receivedCurrency: currency });
    throw new HttpError(400, "Payment amount or currency does not match the order.");
  }

  const status = PAYHERE_STATUS[String(body.status_code)];
  if (!status) throw new HttpError(400, "Payment status is invalid.");
  const digest = sha256(
    [orderId, body.payment_id, amount, currency, body.status_code, body.md5sig].join("|")
  );

  const result = await runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transaction.id },
      include: {
        registration: { include: { tournament: { select: { maxTeams: true } } } },
        merchandiseOrder: true,
      },
    });
    const now = new Date();
    let appliedStatus = status;
    if (current.notificationDigest === digest) appliedStatus = current.status;
    else if (status === "paid") appliedStatus = await resolvePaidStatus({ tx, current, now });
    else if (current.status === "paid" && status !== "charged_back") appliedStatus = current.status;
    else if (TERMINAL_FAILURE_STATUSES.has(current.status)) appliedStatus = current.status;

    if (appliedStatus === current.status) {
      await tx.paymentNotificationAudit.create({
        data: {
          id: crypto.randomUUID(),
          transactionId: current.id,
          notificationDigest: digest,
          providerStatus: status,
          appliedStatus,
          payload: getSafeNotificationPayload(body),
        },
      });
      return current;
    }

    const updated = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: appliedStatus,
        providerPaymentId: String(body.payment_id || "").trim() || current.providerPaymentId,
        method: String(body.method || "").trim() || null,
        statusMessage:
          appliedStatus === "review_required"
            ? "Payment was received after the reservation became unavailable and requires manual review or refund."
            : String(body.status_message || "").trim() || null,
        notificationDigest: digest,
        paidAt: appliedStatus === "paid" ? current.paidAt || now : current.paidAt,
      },
    });
    await applyTargetStatus({
      tx,
      transaction: updated,
      previousStatus: current.status,
      status: appliedStatus,
    });
    await tx.paymentNotificationAudit.create({
      data: {
        id: crypto.randomUUID(),
        transactionId: current.id,
        notificationDigest: digest,
        providerStatus: status,
        appliedStatus,
        payload: getSafeNotificationPayload(body),
      },
    });
    return updated;
  });
  logger.info("PayHere notification reconciled", { orderId, transactionId: result.id, purpose: result.purpose, status: result.status, amount, currency });
  if (result.status === "paid" && result.registrationId) {
    await activatePaidTeamRegistration(result.registrationId).catch((error) => {
      logger.error("Paid tournament registration team activation failed", {
        registrationId: result.registrationId,
        error,
      });
    });
  }
  return result;
};

const expireStaleCommerceReservations = async ({ now = new Date(), batchSize = 50 } = {}) => {
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
    const expired = await prisma.$transaction(async (tx) => {
      const released = await releaseOrderStock(tx, order.id, "cancelled", {
        claimWhere: {
          status: "pending_payment",
          expiresAt: { lte: now },
        },
      });
      if (!released) return false;
      await tx.paymentTransaction.updateMany({
        where: {
          merchandiseOrderId: order.id,
          status: { in: ["created", "pending"] },
        },
        data: { status: "expired" },
      });
      return true;
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
    const expired = await prisma.$transaction(async (tx) => {
      const released = await tx.teamRegistration.updateMany({
        where: {
          id: registration.id,
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
          registrationId: registration.id,
          status: { in: ["created", "pending", "review_required"] },
        },
        data: {
          status: "expired",
          statusMessage: "The slot reservation expired before payment verification was completed.",
        },
      });
      return true;
    });
    if (expired) expiredRegistrationCount += 1;
  }

  return {
    expiredOrders: expiredOrderCount,
    expiredRegistrations: expiredRegistrationCount,
  };
};

const getPaymentStatus = async ({ providerOrderId, userId, publicToken }) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { providerOrderId },
    include: {
      bankTransferProof: true,
      registration: {
        include: {
          tournament: {
            select: {
              bankName: true,
              bankBranch: true,
              bankAccountName: true,
              bankAccountNumber: true,
            },
          },
        },
      },
      merchandiseOrder: { select: { userId: true, publicToken: true } },
    },
  });
  if (!transaction) throw new HttpError(404, "Payment transaction not found.");

  const ownsRegistration = transaction.registration?.userId === userId;
  const ownsOrder =
    transaction.merchandiseOrder &&
    (transaction.merchandiseOrder.userId === userId ||
      transaction.merchandiseOrder.publicToken === publicToken);
  if (!ownsRegistration && !ownsOrder) throw new HttpError(403, "Payment access denied.");
  if (
    transaction.registration &&
    transaction.registration.verificationStatus !== "verified" &&
    transaction.status !== "paid"
  ) {
    throw new HttpError(409, "Every roster member must accept the team invitation before payment.");
  }

  return {
    orderId: transaction.providerOrderId,
    provider: transaction.provider,
    status: transaction.status,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    purpose: transaction.purpose,
    statusMessage: transaction.statusMessage,
    updatedAt: transaction.updatedAt,
    bankTransfer:
      transaction.provider === "bank_transfer" && transaction.registration
        ? buildBankTransferInstructions({
            transaction,
            registration: transaction.registration,
            tournament: transaction.registration.tournament,
          })
        : null,
  };
};

const listPaymentTransactions = async (query = {}) => {
  const status = String(query.status || "").trim().toLowerCase();
  const purpose = String(query.purpose || "").trim().toLowerCase();
  const where = {};
  if (["created", "pending", "paid", "failed", "cancelled", "charged_back", "expired", "review_required", "refunded"].includes(status)) where.status = status;
  if (["tournament_registration", "merchandise_order"].includes(purpose)) where.purpose = purpose;
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 50, 1), 100);
  const [total, items] = await prisma.$transaction([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      bankTransferProof: {
        select: {
          originalFilename: true,
          contentType: true,
          byteSize: true,
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
        },
      },
      registration: {
        select: {
          id: true,
          teamName: true,
          contactEmail: true,
          assignedSlotNumber: true,
          reservedUntil: true,
        },
      },
      merchandiseOrder: { select: { id: true, publicToken: true, email: true } },
    },
    }),
  ]);
  return {
    items: items.map((item) => ({
    id: item.id,
    orderId: item.providerOrderId,
    paymentId: item.providerPaymentId,
    purpose: item.purpose,
    provider: item.provider,
    amount: Number(item.amount),
    currency: item.currency,
    status: item.status,
    method: item.method,
    statusMessage: item.statusMessage,
    reconciledAt: item.reconciledAt,
    reconciliationNote: item.reconciliationNote,
    providerRefundId: item.providerRefundId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    registration: item.registration,
    bankTransferProof: item.bankTransferProof,
    merchandiseOrder: item.merchandiseOrder,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
};

const reconcilePayHerePayment = async ({ transactionId, decision, note, providerRefundId, admin }) => {
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  const normalizedNote = String(note || "").trim().slice(0, 1000);
  const normalizedRefundId = String(providerRefundId || "").trim().slice(0, 200);
  if (!["accept", "mark_refunded"].includes(normalizedDecision)) {
    throw new HttpError(400, "Choose accept or mark_refunded.");
  }
  if (!normalizedNote) throw new HttpError(400, "A reconciliation note is required.");
  if (normalizedDecision === "mark_refunded" && !normalizedRefundId) {
    throw new HttpError(400, "The PayHere refund reference is required.");
  }

  const result = await runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transactionId },
      include: {
        registration: { include: { tournament: { select: { maxTeams: true } } } },
        merchandiseOrder: true,
      },
    });
    if (!current || current.provider !== "payhere") {
      throw new HttpError(404, "PayHere payment was not found.");
    }
    if (current.status !== "review_required") {
      throw new HttpError(409, "This payment is not awaiting manual reconciliation.");
    }
    const now = new Date();
    if (normalizedDecision === "accept") {
      if (current.registrationId) {
        if (!current.registration || current.registration.status === "rejected") {
          throw new HttpError(409, "This registration can no longer be confirmed; refund the payment.");
        }
        const otherActiveCount = await countTournamentCapacityUsage({ tx, tournamentId: current.registration.tournamentId, excludeRegistrationId: current.registrationId, now });
        if (otherActiveCount >= current.registration.tournament.maxTeams) {
          throw new HttpError(409, "No registration slot remains; refund the payment.");
        }
      }
      if (current.merchandiseOrderId && current.merchandiseOrder?.inventoryReleasedAt) {
        throw new HttpError(409, "Reserved inventory was released; refund the payment.");
      }
      const updated = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "paid",
          paidAt: current.paidAt || now,
          statusMessage: "Payment accepted after manual PayHere reconciliation.",
          reconciledAt: now,
          reconciledById: admin.id,
          reconciliationNote: normalizedNote,
          providerRefundId: null,
        },
      });
      await applyTargetStatus({ tx, transaction: updated, previousStatus: current.status, status: "paid" });
      return updated;
    }

    const updated = await tx.paymentTransaction.update({
      where: { id: current.id },
      data: {
        status: "refunded",
        statusMessage: "Payment refunded after manual PayHere reconciliation.",
        reconciledAt: now,
        reconciledById: admin.id,
        reconciliationNote: normalizedNote,
        providerRefundId: normalizedRefundId,
      },
    });
    await applyTargetStatus({ tx, transaction: updated, previousStatus: current.status, status: "refunded" });
    return updated;
  });

  if (result.status === "paid" && result.registrationId) {
    await activatePaidTeamRegistration(result.registrationId);
  }
  logger.info("PayHere payment manually reconciled", {
    transactionId: result.id,
    status: result.status,
    adminId: admin.id,
  });
  return result;
};

module.exports = {
  assertPayHereConfigured,
  isPayHereConfigured,
  createCheckoutHash,
  createPayHereCheckout,
  processPayHereNotification,
  getPaymentStatus,
  verifyNotificationSignature,
  listPaymentTransactions,
  releaseOrderStock,
  expireStaleCommerceReservations,
  reconcilePayHerePayment,
};
