const { recordAuditInTransaction } = require("../../lib/audit");
const { HttpError } = require("../../lib/http-error");

const ACTIONS = new Set([
  "payment.bank_transfer.reviewed",
  "payment.payhere.reconciled",
  "payment.cash.reconciled",
  "payment.reopened",
]);
const DECISIONS = new Set(["approve", "reject", "accept", "mark_refunded", "confirm", "cancel", "reopen"]);
const REASON_CODES = new Set(["approved", "rejected", "accepted", "refunded", "confirmed", "cancelled", "expired_payment_reopened"]);
const AUDIT_DECISION_BY_ACTION = {
  "payment.bank_transfer.reviewed": new Map([
    ["approve", "approved"],
    ["reject", "rejected"],
  ]),
  "payment.payhere.reconciled": new Map([
    ["accept", "accepted"],
    ["mark_refunded", "refunded"],
  ]),
  "payment.cash.reconciled": new Map([
    ["confirm", "confirmed"],
    ["cancel", "cancelled"],
  ]),
  "payment.reopened": new Map([["reopen", "expired_payment_reopened"]]),
};

const assertPaymentMutationAuditContext = (audit, expected = {}) => {
  const actionDecisions = audit && AUDIT_DECISION_BY_ACTION[audit.action];
  if (
    !audit ||
    typeof audit.actorUserId !== "string" ||
    !audit.actorUserId.trim() ||
    typeof audit.requestId !== "string" ||
    !audit.requestId.trim() ||
    typeof audit.ipAddress !== "string" ||
    !audit.ipAddress.trim() ||
    !ACTIONS.has(audit.action) ||
    !DECISIONS.has(audit.decision) ||
    !REASON_CODES.has(audit.reasonCode) ||
    !actionDecisions ||
    actionDecisions.get(audit.decision) !== audit.reasonCode ||
    (expected.action && audit.action !== expected.action) ||
    (expected.decision && audit.decision !== expected.decision)
  ) {
    throw new HttpError(500, "Payment mutation audit context is required.");
  }
};

const recordPaymentMutationAudit = async (tx, payment, audit) => {
  assertPaymentMutationAuditContext(audit);
  await recordAuditInTransaction(tx, {
    actorUserId: audit.actorUserId,
    action: audit.action,
    targetType: "PaymentTransaction",
    targetId: payment.id,
    afterData: {
      status: payment.status,
      decision: DECISIONS.has(audit.decision) ? audit.decision : null,
      reasonCode: REASON_CODES.has(audit.reasonCode) ? audit.reasonCode : null,
    },
    requestId: audit.requestId,
    ipAddress: audit.ipAddress,
  });
};

module.exports = { assertPaymentMutationAuditContext, recordPaymentMutationAudit };
