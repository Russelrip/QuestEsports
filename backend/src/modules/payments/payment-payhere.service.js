const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const {
  countTournamentCapacityUsage,
  hasAvailableCapacity,
} = require("../tournaments/registration-eligibility");
const { maybeAutoApproveRegistration } = require("../tournaments/auto-approval.service");
const {
  assertNoCoachPlayerRoleConflict,
  COACH_PLAYER_ROLE_CONFLICT_MESSAGE,
} = require("../tournaments/role-conflict.service");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const { sendTicketOrderEmail } = require("../../lib/mail/sendTicketOrderEmail");
const {
  PAYHERE_STATUS,
  TERMINAL_FAILURE_STATUSES,
  md5,
  sha256,
  formatAmount,
  markTournamentProjectionChange,
  runSerializable,
} = require("./payment-shared");
const { releaseOrderStock } = require("./payment-reservations.service");

const isPayHereConfigured = () =>
  Boolean(
    env.PAYHERE_MERCHANT_ID &&
      env.PAYHERE_MERCHANT_SECRET &&
      env.PAYHERE_NOTIFY_URL &&
      env.APP_URL,
  );

const assertPayHereConfigured = () => {
  if (!isPayHereConfigured()) {
    throw new HttpError(
      503,
      "Online payments are not configured yet. Please contact Quest E-sports.",
    );
  }
};

const createCheckoutHash = ({ orderId, amount, currency }) => {
  assertPayHereConfigured();
  return md5(
    `${env.PAYHERE_MERCHANT_ID}${orderId}${formatAmount(amount)}${currency}${md5(
      env.PAYHERE_MERCHANT_SECRET,
    ).toUpperCase()}`,
  ).toUpperCase();
};

const createPayHereCheckout = ({
  transaction,
  customer,
  items,
  returnPath,
  cancelPath,
}) => {
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
      env.PAYHERE_MERCHANT_SECRET,
    ).toUpperCase()}`,
  ).toUpperCase();

  const received = String(body.md5sig || "").toUpperCase();
  if (!received || received.length !== localSignature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received),
    Buffer.from(localSignature),
  );
};

const applyTargetStatus = async ({
  tx,
  transaction,
  previousStatus,
  status,
}) => {
  let tournamentRegistrationChanged = false;
  if (transaction.registrationId) {
    if (tx.adminSlotReservation?.deleteMany) {
      const deleted = await tx.adminSlotReservation.deleteMany({
        where: { registrationId: transaction.registrationId },
      });
      tournamentRegistrationChanged = Boolean(deleted?.count);
    }
    if (status === "paid") {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "paid", reservedUntil: null },
      });
      // The fee was the last thing this registration was waiting on, so a
      // tournament that does not review registrations approves it here.
      await maybeAutoApproveRegistration({
        tx,
        registrationId: transaction.registrationId,
      });
      tournamentRegistrationChanged = true;
    } else if (
      ["cancelled", "failed", "charged_back", "refunded"].includes(status)
    ) {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "unpaid", reservedUntil: null },
      });
      tournamentRegistrationChanged = true;
    } else if (status === "pending") {
      await tx.teamRegistration.update({
        where: { id: transaction.registrationId },
        data: { paymentStatus: "pending" },
      });
      tournamentRegistrationChanged = true;
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
      !["cancelled", "failed", "charged_back", "refunded"].includes(
        previousStatus,
      )
    ) {
      const order = await tx.merchandiseOrder.findUnique({
        where: { id: transaction.merchandiseOrderId },
        select: { status: true },
      });
      await releaseOrderStock(
        tx,
        transaction.merchandiseOrderId,
        ["charged_back", "refunded"].includes(status)
          ? "refunded"
          : "cancelled",
        { restoreInventory: order?.status !== "fulfilled" },
      );
    }
  }

  if (transaction.ticketOrderId) {
    if (status === "paid") {
      const order = await tx.ticketOrder.update({
        where: { id: transaction.ticketOrderId },
        data: { status: "paid", capacityReleasedAt: null },
        include: { event: { select: { title: true } } },
      });
      await tx.ticket.updateMany({
        where: { orderId: transaction.ticketOrderId, status: "pending" },
        data: { status: "valid" },
      });
      if (!order.confirmationEmailQueuedAt) {
        await sendTicketOrderEmail({
          orderId: order.id,
          email: order.email,
          firstName: order.firstName,
          eventTitle: order.event.title,
          quantity: order.quantity,
          rawToken: order.publicToken,
          database: tx,
        });
        await tx.ticketOrder.update({
          where: { id: order.id },
          data: { confirmationEmailQueuedAt: new Date() },
        });
      }
    } else if (
      ["cancelled", "failed", "charged_back", "refunded"].includes(status)
    ) {
      const orderStatus = ["charged_back", "refunded"].includes(status)
        ? "refunded"
        : "cancelled";
      await tx.ticketOrder.updateMany({
        where: { id: transaction.ticketOrderId, status: { not: "expired" } },
        data: { status: orderStatus, capacityReleasedAt: new Date() },
      });
      await tx.ticket.updateMany({
        where: {
          orderId: transaction.ticketOrderId,
          status: { in: ["pending", "valid"] },
        },
        data: { status: orderStatus === "refunded" ? "refunded" : "cancelled" },
      });
    }
  }

  return tournamentRegistrationChanged;
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
    if (registration.members?.length) {
      await assertNoCoachPlayerRoleConflict({
        tx,
        tournamentId: registration.tournamentId,
        members: registration.members,
        excludeRegistrationId: registration.id,
        now,
      });
    }
    const activeCount = await countTournamentCapacityUsage({
      tx,
      tournamentId: registration.tournamentId,
      excludeRegistrationId: registration.id,
      now,
    });
    if (!hasAvailableCapacity(registration.tournament, activeCount)) {
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

  if (current.ticketOrderId) {
    const order = current.ticketOrder;
    if (
      !order ||
      order.capacityReleasedAt ||
      (order.status === "pending_payment" && order.expiresAt <= now) ||
      order.event.status === "cancelled"
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
    logger.warn("PayHere notification rejected: merchant mismatch", {
      orderId,
    });
    throw new HttpError(400, "Payment merchant does not match.");
  }
  if (!verifyNotificationSignature(body)) {
    logger.warn("PayHere notification rejected: invalid signature", {
      orderId,
    });
    throw new HttpError(400, "Payment notification signature is invalid.");
  }

  const transaction = await prisma.paymentTransaction.findUnique({
    where: { providerOrderId: orderId },
  });
  if (!transaction) throw new HttpError(404, "Payment transaction not found.");

  const currency = String(body.payhere_currency || "").toUpperCase();
  const amount = formatAmount(body.payhere_amount);
  if (
    currency !== transaction.currency ||
    amount !== formatAmount(transaction.amount)
  ) {
    logger.warn("PayHere notification rejected: amount or currency mismatch", {
      orderId,
      receivedAmount: amount,
      receivedCurrency: currency,
    });
    throw new HttpError(
      400,
      "Payment amount or currency does not match the order.",
    );
  }

  const status = PAYHERE_STATUS[String(body.status_code)];
  if (!status) throw new HttpError(400, "Payment status is invalid.");
  const digest = sha256(
    [
      orderId,
      body.payment_id,
      amount,
      currency,
      body.status_code,
      body.md5sig,
    ].join("|"),
  );

  const result = await runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transaction.id },
      include: {
        registration: {
          include: {
            members: true,
            tournament: { select: { maxTeams: true } },
          },
        },
        merchandiseOrder: true,
        ticketOrder: {
          include: { event: { select: { status: true, capacity: true } } },
        },
      },
    });
    const now = new Date();
    const previouslyProcessed = await tx.paymentNotificationAudit.findFirst({
      where: {
        transactionId: current.id,
        notificationDigest: digest,
      },
      select: { id: true },
    });
    if (previouslyProcessed) {
      return markTournamentProjectionChange(current, false);
    }

    let appliedStatus = status;
    let appliedStatusMessage = null;
    if (current.notificationDigest === digest) appliedStatus = current.status;
    else if (status === "paid") {
      try {
        appliedStatus = await resolvePaidStatus({ tx, current, now });
      } catch (error) {
        if (error?.statusCode !== 409 || error.message !== COACH_PLAYER_ROLE_CONFLICT_MESSAGE) {
          throw error;
        }
        appliedStatus = "review_required";
        appliedStatusMessage =
          "Payment was received, but the registration has a coach/player role conflict and requires administrator review.";
      }
    }
    else if (current.status === "paid" && status !== "charged_back")
      appliedStatus = current.status;
    else if (TERMINAL_FAILURE_STATUSES.has(current.status))
      appliedStatus = current.status;

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
      return markTournamentProjectionChange(current, false);
    }

    const updated = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: appliedStatus,
        providerPaymentId:
          String(body.payment_id || "").trim() || current.providerPaymentId,
        method: String(body.method || "").trim() || null,
        statusMessage:
          appliedStatusMessage || (appliedStatus === "review_required"
            ? "Payment was received after the reservation became unavailable and requires manual review or refund."
            : String(body.status_message || "").trim() || null),
        notificationDigest: digest,
        paidAt:
          appliedStatus === "paid" ? current.paidAt || now : current.paidAt,
      },
    });
    const targetChanged = await applyTargetStatus({
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
    return markTournamentProjectionChange(updated, targetChanged);
  });
  logger.info("PayHere notification reconciled", {
    orderId,
    transactionId: result.id,
    purpose: result.purpose,
    status: result.status,
    amount,
    currency,
  });
  if (result.status === "paid" && result.registrationId) {
    await activatePaidTeamRegistration(result.registrationId).catch((error) => {
      logger.error("Paid tournament registration team activation requires reconciliation", {
        transactionId: result.id,
        registrationId: result.registrationId,
        reconciliationRequired: true,
        error,
      });
    });
  }
  return result;
};

module.exports = {
  isPayHereConfigured,
  assertPayHereConfigured,
  createCheckoutHash,
  createPayHereCheckout,
  verifyNotificationSignature,
  applyTargetStatus,
  processPayHereNotification,
};
