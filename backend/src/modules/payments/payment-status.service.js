const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { buildBankTransferInstructions } = require("./bank-transfer.service");
const { markTournamentProjectionChange } = require("./payment-shared");
const { expireTournamentRegistrationReservation } = require("./payment-reservations.service");

const loadPaymentStatusTransaction = (providerOrderId) =>
  prisma.paymentTransaction.findUnique({
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
              contactLink: true,
            },
          },
        },
      },
      merchandiseOrder: { select: { userId: true, publicToken: true } },
      ticketOrder: {
        select: {
          id: true,
          userId: true,
          publicToken: true,
          expiresAt: true,
          status: true,
          capacityReleasedAt: true,
          event: {
            select: {
              bankName: true,
              bankBranch: true,
              bankAccountName: true,
              bankAccountNumber: true,
            },
          },
        },
      },
    },
  });

const getPaymentStatus = async ({ providerOrderId, userId, publicToken }) => {
  let transaction = await loadPaymentStatusTransaction(providerOrderId);
  let tournamentProjectionChanged = false;
  if (!transaction) throw new HttpError(404, "Payment transaction not found.");

  const ownsRegistration = transaction.registration?.userId === userId;
  const ownsOrder =
    transaction.merchandiseOrder &&
    (transaction.merchandiseOrder.userId === userId ||
      transaction.merchandiseOrder.publicToken === publicToken);
  const ownsTicketOrder =
    transaction.ticketOrder &&
    (transaction.ticketOrder.userId === userId ||
      transaction.ticketOrder.publicToken === publicToken);
  if (!ownsRegistration && !ownsOrder && !ownsTicketOrder)
    throw new HttpError(403, "Payment access denied.");
  if (
    transaction.registration?.paymentStatus === "pending" &&
    transaction.registration.reservedUntil &&
    transaction.registration.reservedUntil <= new Date()
  ) {
    const expired = await expireTournamentRegistrationReservation({
      registrationId: transaction.registration.id,
    });
    tournamentProjectionChanged = expired;
    transaction = await loadPaymentStatusTransaction(providerOrderId);
    if (!transaction)
      throw new HttpError(404, "Payment transaction not found.");
  }
  if (
    transaction.ticketOrder?.status === "pending_payment" &&
    !transaction.ticketOrder.capacityReleasedAt &&
    transaction.ticketOrder.expiresAt <= new Date()
  ) {
    const { expireTicketOrderReservation } = require("../tickets/ticket.service");
    await expireTicketOrderReservation({ orderId: transaction.ticketOrder.id });
    transaction = await loadPaymentStatusTransaction(providerOrderId);
    if (!transaction)
      throw new HttpError(404, "Payment transaction not found.");
  }
  if (
    transaction.registration &&
    transaction.registration.verificationStatus !== "verified" &&
    transaction.status !== "paid"
  ) {
    throw new HttpError(
      409,
      "Every roster member must accept the team invitation before payment.",
    );
  }

  return markTournamentProjectionChange({
    orderId: transaction.providerOrderId,
    provider: transaction.provider,
    status: transaction.status,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    purpose: transaction.purpose,
    statusMessage: transaction.statusMessage,
    updatedAt: transaction.updatedAt,
    registration: transaction.registration
      ? {
          expiresAt: transaction.registration.reservedUntil,
          assignedSlotNumber: transaction.registration.assignedSlotNumber,
          contactLink: transaction.registration.tournament.contactLink,
        }
      : null,
    ticketOrder: transaction.ticketOrder
      ? { expiresAt: transaction.ticketOrder.expiresAt }
      : null,
    bankTransfer:
      transaction.provider === "bank_transfer" &&
      (transaction.registration || transaction.ticketOrder)
        ? buildBankTransferInstructions({
            transaction,
            registration: transaction.registration,
            tournament: transaction.registration?.tournament,
            ticketOrder: transaction.ticketOrder,
            ticketEvent: transaction.ticketOrder?.event,
          })
        : null,
  }, tournamentProjectionChanged);
};

module.exports = {
  getPaymentStatus,
};
