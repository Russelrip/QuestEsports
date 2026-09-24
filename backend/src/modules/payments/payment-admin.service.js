const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const {
  allocateLowestAvailableSlot,
  countTournamentCapacityUsage,
  hasAvailableCapacity,
} = require("../tournaments/registration-eligibility");
const { assertNoCoachPlayerRoleConflict } = require("../tournaments/role-conflict.service");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const {
  assertPaymentMutationAuditContext,
  recordPaymentMutationAudit,
} = require("./payment.audit");
const { getBankTransferAmountForSlot } = require("./bank-transfer.service");
const { markTournamentProjectionChange, runSerializable } = require("./payment-shared");
const { applyTargetStatus } = require("./payment-payhere.service");

const ADMIN_PAYMENT_DETAIL_INCLUDE = {
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
  ticketOrder: {
    select: {
      id: true,
      publicToken: true,
      email: true,
      firstName: true,
      lastName: true,
      event: { select: { id: true, title: true } },
    },
  },
};

const mapAdminPaymentDetail = (item) => ({
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
  ticketOrder: item.ticketOrder,
});

const mapAdminPaymentSummary = (item) => ({
  id: item.id,
  orderId: item.providerOrderId,
  paymentId: item.providerPaymentId,
  purpose: item.purpose,
  provider: item.provider,
  amount: Number(item.amount),
  currency: item.currency,
  status: item.status,
  method: item.method,
  createdAt: item.createdAt,
  customerName:
    item.registration?.teamName ||
    (item.ticketOrder
      ? `${item.ticketOrder.firstName} ${item.ticketOrder.lastName}`.trim()
      : "Merchandise customer"),
  customerEmail:
    item.registration?.contactEmail ||
    item.merchandiseOrder?.email ||
    item.ticketOrder?.email ||
    null,
  groupId:
    item.registration?.tournament?.id || item.ticketOrder?.event?.id || null,
  groupName:
    item.registration?.tournament?.title ||
    item.ticketOrder?.event?.title ||
    "Merchandise",
});

const listPaymentTransactions = async (query = {}) => {
  const status = String(query.status || "")
    .trim()
    .toLowerCase();
  const purpose = String(query.purpose || "")
    .trim()
    .toLowerCase();
  const search = String(query.search || "").trim();
  const where = {};
  if (
    [
      "created",
      "pending",
      "paid",
      "failed",
      "cancelled",
      "charged_back",
      "expired",
      "review_required",
      "refunded",
    ].includes(status)
  )
    where.status = status;
  if (
    ["tournament_registration", "merchandise_order", "ticket_order"].includes(
      purpose,
    )
  )
    where.purpose = purpose;
  if (query.eventId)
    where.ticketOrder = { is: { eventId: String(query.eventId) } };
  if (query.tournamentId)
    where.registration = { is: { tournamentId: String(query.tournamentId) } };
  if (search) {
    const textFilter = { contains: search, mode: "insensitive" };
    where.OR = [
      { providerOrderId: textFilter },
      { providerPaymentId: textFilter },
      {
        registration: {
          is: { OR: [{ teamName: textFilter }, { contactEmail: textFilter }] },
        },
      },
      { merchandiseOrder: { is: { email: textFilter } } },
      {
        ticketOrder: {
          is: {
            OR: [
              { email: textFilter },
              { firstName: textFilter },
              { lastName: textFilter },
              { event: { is: { title: textFilter } } },
            ],
          },
        },
      },
    ];
  }
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number.parseInt(query.pageSize, 10) || 20, 1),
    50,
  );
  const [total, items] = await prisma.$transaction([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        providerOrderId: true,
        providerPaymentId: true,
        purpose: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        method: true,
        createdAt: true,
        registration: {
          select: {
            teamName: true,
            contactEmail: true,
            tournament: { select: { id: true, title: true } },
          },
        },
        merchandiseOrder: { select: { email: true } },
        ticketOrder: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            event: { select: { id: true, title: true } },
          },
        },
      },
    }),
  ]);
  return {
    items: items.map(mapAdminPaymentSummary),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
};

const getAdminPaymentTransaction = async (transactionId) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    include: ADMIN_PAYMENT_DETAIL_INCLUDE,
  });
  if (!transaction) throw new HttpError(404, "Payment transaction not found.");
  return mapAdminPaymentDetail(transaction);
};

const reopenExpiredTournamentPayment = async ({ transactionId, admin, audit }) => {
  assertPaymentMutationAuditContext(audit, {
    action: "payment.reopened",
    decision: "reopen",
  });
  return runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transactionId },
      include: {
        bankTransferProof: true,
        registration: { include: { members: true, tournament: true } },
      },
    });
    if (!current || current.purpose !== "tournament_registration") {
      throw new HttpError(
        404,
        "Expired tournament registration payment was not found.",
      );
    }
    if (current.status !== "expired") {
      throw new HttpError(409, "Only expired payments can be reopened.");
    }
    if (!current.registration || current.registration.status === "rejected") {
      throw new HttpError(409, "This registration can no longer be reopened.");
    }
    if (current.registration.paymentStatus === "paid") {
      throw new HttpError(409, "This registration is already paid.");
    }
    if (current.registration.members?.length) {
      await assertNoCoachPlayerRoleConflict({
        tx,
        tournamentId: current.registration.tournamentId,
        members: current.registration.members,
        excludeRegistrationId: current.registration.id,
      });
    }

    const used = await countTournamentCapacityUsage({
      tx,
      tournamentId: current.registration.tournamentId,
      excludeRegistrationId: current.registration.id,
    });
    if (!hasAvailableCapacity(current.registration.tournament, used)) {
      throw new HttpError(409, "The tournament has no slot available.");
    }
    const isBankTransfer = current.provider === "bank_transfer";
    const assignedSlotNumber = isBankTransfer
      ? await allocateLowestAvailableSlot({
          tx,
          tournamentId: current.registration.tournamentId,
          maxTeams: current.registration.tournament.maxTeams,
          excludeRegistrationId: current.registration.id,
        })
      : null;
    const hasProof = isBankTransfer && Boolean(current.bankTransferProof);
    const holdMinutes = hasProof
      ? current.registration.tournament.bankTransferReviewMinutes
      : current.registration.tournament.reservationMinutes;
    const reservedUntil = new Date(Date.now() + holdMinutes * 60 * 1000);
    const amount = isBankTransfer
      ? getBankTransferAmountForSlot(
          current.registration.tournament,
          assignedSlotNumber,
        )
      : Number(current.amount);

    await tx.teamRegistration.update({
      where: { id: current.registration.id },
      data: {
        paymentStatus: "pending",
        assignedSlotNumber,
        quotedFeeAmount: amount,
        quotedFeeCurrency:
          current.registration.tournament.registrationFeeCurrency,
        reservedUntil,
      },
    });
    const payment = await tx.paymentTransaction.update({
      where: { id: current.id },
      data: {
        status: hasProof ? "review_required" : "pending",
        amount,
        currency: current.registration.tournament.registrationFeeCurrency,
        statusMessage: hasProof
          ? "Payment reopened by an administrator and awaits proof review."
          : "Payment reopened by an administrator.",
        reconciledAt: new Date(),
        reconciledById: admin.id,
        reconciliationNote: "Expired tournament payment reopened.",
      },
    });
    await recordPaymentMutationAudit(tx, payment, audit);
    return payment;
  });
};

const reconcilePayHerePayment = async ({
  transactionId,
  decision,
  note,
  providerRefundId,
  admin,
  audit,
}) => {
  const normalizedDecision = String(decision || "")
    .trim()
    .toLowerCase();
  const normalizedNote = String(note || "")
    .trim()
    .slice(0, 1000);
  const normalizedRefundId = String(providerRefundId || "")
    .trim()
    .slice(0, 200);
  if (!["accept", "mark_refunded"].includes(normalizedDecision)) {
    throw new HttpError(400, "Choose accept or mark_refunded.");
  }
  assertPaymentMutationAuditContext(audit, {
    action: "payment.payhere.reconciled",
    decision: normalizedDecision,
  });
  if (!normalizedNote)
    throw new HttpError(400, "A reconciliation note is required.");
  if (normalizedDecision === "mark_refunded" && !normalizedRefundId) {
    throw new HttpError(400, "The PayHere refund reference is required.");
  }

  const result = await runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transactionId },
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
    if (!current || current.provider !== "payhere") {
      throw new HttpError(404, "PayHere payment was not found.");
    }
    if (current.status !== "review_required") {
      throw new HttpError(
        409,
        "This payment is not awaiting manual reconciliation.",
      );
    }
    const now = new Date();
    if (normalizedDecision === "accept") {
      if (current.registrationId) {
        if (
          !current.registration ||
          current.registration.status === "rejected"
        ) {
          throw new HttpError(
            409,
            "This registration can no longer be confirmed; refund the payment.",
          );
        }
        if (current.registration.members?.length) {
          await assertNoCoachPlayerRoleConflict({
            tx,
            tournamentId: current.registration.tournamentId,
            members: current.registration.members,
            excludeRegistrationId: current.registration.id,
            now,
          });
        }
        const otherActiveCount = await countTournamentCapacityUsage({
          tx,
          tournamentId: current.registration.tournamentId,
          excludeRegistrationId: current.registrationId,
          now,
        });
        if (!hasAvailableCapacity(current.registration.tournament, otherActiveCount)) {
          throw new HttpError(
            409,
            "No registration slot remains; refund the payment.",
          );
        }
      }
      if (
        current.merchandiseOrderId &&
        current.merchandiseOrder?.inventoryReleasedAt
      ) {
        throw new HttpError(
          409,
          "Reserved inventory was released; refund the payment.",
        );
      }
      if (current.ticketOrderId && current.ticketOrder?.capacityReleasedAt) {
        throw new HttpError(
          409,
          "Reserved ticket capacity was released; refund the payment.",
        );
      }
      if (current.ticketOrderId && current.ticketOrder?.expiresAt <= now) {
        throw new HttpError(
          409,
          "The ticket reservation expired; refund the payment.",
        );
      }
      if (
        current.ticketOrderId &&
        current.ticketOrder?.event?.status === "cancelled"
      ) {
        throw new HttpError(
          409,
          "The ticketed event is cancelled; refund the payment.",
        );
      }
      if (current.ticketOrderId) {
        const reserved = await tx.ticketOrder.aggregate({
          where: {
            eventId: current.ticketOrder.eventId,
            id: { not: current.ticketOrder.id },
            OR: [
              { status: "paid" },
              {
                status: "pending_payment",
                capacityReleasedAt: null,
                expiresAt: { gt: now },
              },
            ],
          },
          _sum: { quantity: true },
        });
        const reservedQuantity = reserved._sum.quantity || 0;
        if (reservedQuantity + current.ticketOrder.quantity > current.ticketOrder.event.capacity) {
          throw new HttpError(
            409,
            "No ticket capacity remains; refund the payment.",
          );
        }
      }
      const updated = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "paid",
          paidAt: current.paidAt || now,
          statusMessage:
            "Payment accepted after manual PayHere reconciliation.",
          reconciledAt: now,
          reconciledById: admin.id,
          reconciliationNote: normalizedNote,
          providerRefundId: null,
        },
      });
      const targetChanged = await applyTargetStatus({
        tx,
        transaction: updated,
        previousStatus: current.status,
        status: "paid",
      });
      const payment = markTournamentProjectionChange(updated, targetChanged);
      await recordPaymentMutationAudit(tx, payment, audit);
      return payment;
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
    const targetChanged = await applyTargetStatus({
      tx,
      transaction: updated,
      previousStatus: current.status,
      status: "refunded",
    });
    const payment = markTournamentProjectionChange(updated, targetChanged);
    await recordPaymentMutationAudit(tx, payment, audit);
    return payment;
  });

  if (result.status === "paid" && result.registrationId) {
    try {
      await activatePaidTeamRegistration(result.registrationId);
    } catch (error) {
      logger.error("Paid tournament registration team activation requires reconciliation", {
        transactionId: result.id,
        registrationId: result.registrationId,
        reconciliationRequired: true,
        error,
      });
      throw error;
    }
  }
  logger.info("PayHere payment manually reconciled", {
    transactionId: result.id,
    status: result.status,
    adminId: admin.id,
  });
  return result;
};

const reconcileCashTicketPayment = async ({
  transactionId,
  decision,
  note,
  admin,
  audit,
}) => {
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  const normalizedNote = String(note || "").trim().slice(0, 1000);
  if (!["confirm", "cancel"].includes(normalizedDecision))
    throw new HttpError(400, "Choose confirm or cancel.");
  assertPaymentMutationAuditContext(audit, {
    action: "payment.cash.reconciled",
    decision: normalizedDecision,
  });
  if (!normalizedNote)
    throw new HttpError(400, "A cash reconciliation note is required.");

  return runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transactionId },
      include: { ticketOrder: { include: { event: true } } },
    });
    if (
      !current ||
      current.provider !== "cash" ||
      current.purpose !== "ticket_order" ||
      !current.ticketOrder
    ) {
      throw new HttpError(404, "Cash entrance payment was not found.");
    }
    if (current.status === "paid" && normalizedDecision === "confirm")
      return markTournamentProjectionChange(current, false);
    if (!["created", "pending"].includes(current.status))
      throw new HttpError(409, "This cash payment is no longer pending.");

    const now = new Date();
    if (
      normalizedDecision === "confirm" &&
      (current.ticketOrder.capacityReleasedAt ||
        current.ticketOrder.expiresAt <= now ||
        current.ticketOrder.event.status === "cancelled")
    ) {
      throw new HttpError(
        409,
        "The cash reservation expired or the event was cancelled.",
      );
    }
    const status = normalizedDecision === "confirm" ? "paid" : "cancelled";
    const updated = await tx.paymentTransaction.update({
      where: { id: current.id },
      data: {
        status,
        paidAt: status === "paid" ? now : null,
        statusMessage:
          status === "paid"
            ? "Cash collected and confirmed by Quest staff."
            : "Cash order cancelled by Quest staff.",
        reconciledAt: now,
        reconciledById: admin.id,
        reconciliationNote: normalizedNote,
      },
    });
    await applyTargetStatus({
      tx,
      transaction: updated,
      previousStatus: current.status,
      status,
    });
    const payment = markTournamentProjectionChange(updated, false);
    await recordPaymentMutationAudit(tx, payment, audit);
    return payment;
  });
};

module.exports = {
  listPaymentTransactions,
  getAdminPaymentTransaction,
  reopenExpiredTournamentPayment,
  reconcilePayHerePayment,
  reconcileCashTicketPayment,
};
