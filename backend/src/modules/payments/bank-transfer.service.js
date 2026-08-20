const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Prisma } = require("../../generated/prisma");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const {
  bankTransferProofDirectory,
  persistBankTransferProofUpload,
} = require("../../middleware/upload");
const { countTournamentCapacityUsage } = require("../tournaments/registration-eligibility");
const { assertNoCoachPlayerRoleConflict } = require("../tournaments/role-conflict.service");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const { sendTicketOrderEmail } = require("../../lib/mail/sendTicketOrderEmail");

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

const getFeeTiers = (tournament) =>
  Array.isArray(tournament.registrationFeeTiers)
    ? tournament.registrationFeeTiers
    : [];

const getBankTransferAmountForSlot = (tournament, slotNumber) => {
  const tier = getFeeTiers(tournament).find(
    (candidate) =>
      slotNumber >= Number(candidate.startSlot) &&
      slotNumber <= Number(candidate.endSlot)
  );
  return tier ? Number(tier.amount) : Number(tournament.registrationFeeAmount || 0);
};

const assertBankTransferConfigured = (tournament) => {
  if (
    !tournament.bankName ||
    !tournament.bankAccountName ||
    !tournament.bankAccountNumber
  ) {
    throw new HttpError(
      503,
      "Bank-transfer registration is not fully configured. Please contact Quest E-sports."
    );
  }
};

const buildBankTransferInstructions = ({
  transaction,
  registration,
  tournament,
  ticketOrder,
  ticketEvent,
}) => ({
  orderId: transaction.providerOrderId,
  reference: transaction.providerOrderId,
  assignedSlotNumber: registration?.assignedSlotNumber || null,
  amount: Number(transaction.amount),
  currency: transaction.currency,
  expiresAt: registration?.reservedUntil || ticketOrder?.expiresAt || null,
  status: transaction.status,
  proofSubmitted: Boolean(transaction.bankTransferProof),
  bankAccount: {
    bankName: tournament?.bankName || ticketEvent?.bankName,
    branch: tournament?.bankBranch || ticketEvent?.bankBranch,
    accountName: tournament?.bankAccountName || ticketEvent?.bankAccountName,
    accountNumber:
      tournament?.bankAccountNumber || ticketEvent?.bankAccountNumber,
  },
});

const submitBankTransferProof = async ({ providerOrderId, user, publicToken, file }) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { providerOrderId },
    include: {
      bankTransferProof: true,
      registration: { include: { tournament: true } },
      ticketOrder: { include: { event: true } },
    },
  });
  if (
    !transaction ||
    transaction.provider !== "bank_transfer" ||
    (!transaction.registration && !transaction.ticketOrder)
  ) {
    throw new HttpError(404, "Bank-transfer payment was not found.");
  }
  const ownsRegistration =
    transaction.registration && transaction.registration.userId === user?.id;
  const ownsTicketOrder =
    transaction.ticketOrder &&
    (transaction.ticketOrder.userId === user?.id ||
      transaction.ticketOrder.publicToken === publicToken);
  if (!ownsRegistration && !ownsTicketOrder) {
    throw new HttpError(403, "Payment access denied.");
  }
  if (
    transaction.registration &&
    transaction.registration.verificationStatus !== "verified"
  ) {
    throw new HttpError(409, "Every roster member must accept the team invitation before payment.");
  }
  if (transaction.status === "paid") {
    throw new HttpError(409, "This payment has already been approved.");
  }
  if (!["created", "pending", "review_required"].includes(transaction.status)) {
    throw new HttpError(409, "This payment is no longer accepting proof uploads.");
  }
  const initialDeadline =
    transaction.registration?.reservedUntil || transaction.ticketOrder?.expiresAt;
  if (!initialDeadline || initialDeadline <= new Date()) {
    throw new HttpError(409, "This payment reservation expired. Start again.");
  }

  const persisted = await persistBankTransferProofUpload(file);
  try {
    const saved = await runSerializable(async (tx) => {
      // Re-read inside the serializable transaction. An administrator may have
      // reviewed the proof between the initial authorization check and file persistence.
      const current = await tx.paymentTransaction.findUnique({
        where: { id: transaction.id },
        include: {
          bankTransferProof: true,
          registration: { include: { tournament: true } },
          ticketOrder: { include: { event: true } },
        },
      });
      if (
        !current ||
        current.provider !== "bank_transfer" ||
        (!current.registration && !current.ticketOrder)
      ) {
        throw new HttpError(404, "Bank-transfer payment was not found.");
      }
      const ownsCurrentRegistration =
        current.registration && current.registration.userId === user?.id;
      const ownsCurrentTicketOrder =
        current.ticketOrder &&
        (current.ticketOrder.userId === user?.id ||
          current.ticketOrder.publicToken === publicToken);
      if (!ownsCurrentRegistration && !ownsCurrentTicketOrder) {
        throw new HttpError(403, "Payment access denied.");
      }
      if (
        current.registration &&
        current.registration.verificationStatus !== "verified"
      ) {
        throw new HttpError(409, "Every roster member must accept the team invitation before payment.");
      }
      if (current.status === "paid") {
        throw new HttpError(409, "This payment has already been approved.");
      }
      if (!["created", "pending", "review_required"].includes(current.status)) {
        throw new HttpError(409, "This payment is no longer accepting proof uploads.");
      }
      const now = new Date();
      const currentDeadline =
        current.registration?.reservedUntil || current.ticketOrder?.expiresAt;
      if (!currentDeadline || currentDeadline <= now) {
        throw new HttpError(409, "This payment reservation expired. Start again.");
      }

      const duplicate = await tx.bankTransferProof.findFirst({
        where: {
          sha256: persisted.sha256,
          transactionId: { not: current.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, "This payment proof has already been used for another payment.");
      }

      const reviewMinutes = current.registration
        ? current.registration.tournament.bankTransferReviewMinutes
        : current.ticketOrder.event.bankTransferReviewMinutes;
      const reviewUntil = new Date(
        now.getTime() + reviewMinutes * 60 * 1000
      );
      const savedProof = await tx.bankTransferProof.upsert({
        where: { transactionId: current.id },
        create: {
          id: crypto.randomUUID(),
          transactionId: current.id,
          storedFilename: persisted.filename,
          originalFilename: persisted.originalFilename,
          contentType: persisted.contentType,
          byteSize: persisted.byteSize,
          sha256: persisted.sha256,
        },
        update: {
          storedFilename: persisted.filename,
          originalFilename: persisted.originalFilename,
          contentType: persisted.contentType,
          byteSize: persisted.byteSize,
          sha256: persisted.sha256,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
        },
      });
      await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "review_required",
          method: "bank_transfer",
          statusMessage: "Payment proof submitted and awaiting bank-account verification.",
        },
      });
      if (current.registrationId) {
        await tx.teamRegistration.update({
          where: { id: current.registrationId },
          data: { paymentStatus: "pending", reservedUntil: reviewUntil },
        });
      } else {
        await tx.ticketOrder.update({
          where: { id: current.ticketOrderId },
          data: { expiresAt: reviewUntil },
        });
      }
      return {
        proof: savedProof,
        reviewUntil,
        previousFilename: current.bankTransferProof?.storedFilename || null,
      };
    });

    if (
      saved.previousFilename &&
      saved.previousFilename !== persisted.filename
    ) {
      await removeUploadsQuietly(
        [{ directory: bankTransferProofDirectory, filename: saved.previousFilename }],
        { operation: "replaceBankTransferProof", transactionId: transaction.id }
      );
    }
    return { proof: saved.proof, reviewUntil: saved.reviewUntil };
  } catch (error) {
    await removeUploadsQuietly(
      [{ directory: bankTransferProofDirectory, filename: persisted.filename }],
      { operation: "rollbackBankTransferProofUpload", transactionId: transaction.id }
    );
    if (error?.code === "P2002") {
      throw new HttpError(409, "This payment proof has already been used for another payment.");
    }
    throw error;
  }
};

const getBankTransferProofFile = async (transactionId) => {
  const proof = await prisma.bankTransferProof.findUnique({
    where: { transactionId },
  });
  if (!proof) throw new HttpError(404, "Payment proof was not found.");
  if (path.basename(proof.storedFilename) !== proof.storedFilename) {
    throw new HttpError(404, "Payment proof was not found.");
  }
  try {
    return {
      ...proof,
      buffer: await fs.readFile(path.join(bankTransferProofDirectory, proof.storedFilename)),
    };
  } catch (error) {
    if (error?.code === "ENOENT") throw new HttpError(404, "Payment proof file is missing.");
    throw error;
  }
};

const reviewBankTransfer = async ({ transactionId, decision, reason, admin }) => {
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  const normalizedReason = String(reason || "").trim().slice(0, 500);
  if (!["approve", "reject"].includes(normalizedDecision)) {
    throw new HttpError(400, "Choose approve or reject.");
  }
  if (normalizedDecision === "reject" && !normalizedReason) {
    throw new HttpError(400, "Provide a reason when rejecting payment proof.");
  }

  const result = await runSerializable(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({
      where: { id: transactionId },
      include: {
        bankTransferProof: true,
        registration: { include: { members: true, tournament: true } },
        ticketOrder: { include: { event: true } },
      },
    });
    if (
      !current ||
      current.provider !== "bank_transfer" ||
      (!current.registration && !current.ticketOrder)
    ) {
      throw new HttpError(404, "Bank-transfer payment was not found.");
    }
    if (!current.bankTransferProof) {
      throw new HttpError(409, "No payment proof has been submitted.");
    }
    if (current.status === "paid") return current;
    if (current.status !== "review_required") {
      throw new HttpError(409, "This payment is not awaiting review.");
    }

    const now = new Date();
    if (normalizedDecision === "approve") {
      const deadline =
        current.registration?.reservedUntil || current.ticketOrder?.expiresAt;
      if (!deadline || deadline <= now) {
        throw new HttpError(409, "The reservation expired. Reject it and ask the buyer to start again.");
      }
      if (current.registration) {
        await assertNoCoachPlayerRoleConflict({
          tx,
          tournamentId: current.registration.tournamentId,
          members: current.registration.members || [],
          excludeRegistrationId: current.registration.id,
        });
        const otherActiveCount = await countTournamentCapacityUsage({ tx, tournamentId: current.registration.tournamentId, excludeRegistrationId: current.registration.id, now });
        if (otherActiveCount >= current.registration.tournament.maxTeams) {
          throw new HttpError(409, "The tournament no longer has an available slot.");
        }
        if (tx.adminSlotReservation?.deleteMany) {
          await tx.adminSlotReservation.deleteMany({
            where: { registrationId: current.registration.id },
          });
        }
        await tx.teamRegistration.update({
          where: { id: current.registration.id },
          data: { paymentStatus: "paid", reservedUntil: null },
        });
      } else {
        await tx.ticketOrder.update({
          where: { id: current.ticketOrder.id },
          data: { status: "paid", capacityReleasedAt: null },
        });
        await tx.ticket.updateMany({
          where: { orderId: current.ticketOrder.id, status: "pending" },
          data: { status: "valid" },
        });
      }
      await tx.bankTransferProof.update({
        where: { transactionId: current.id },
        data: {
          reviewedAt: now,
          reviewedById: admin.id,
          rejectionReason: null,
        },
      });
      const payment = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "paid",
          paidAt: now,
          statusMessage: "Bank transfer verified by Quest E-sports.",
        },
      });
      if (current.ticketOrder && !current.ticketOrder.confirmationEmailQueuedAt) {
        await sendTicketOrderEmail({
          orderId: current.ticketOrder.id,
          email: current.ticketOrder.email,
          firstName: current.ticketOrder.firstName,
          eventTitle: current.ticketOrder.event.title,
          quantity: current.ticketOrder.quantity,
          rawToken: current.ticketOrder.publicToken,
          database: tx,
        });
        await tx.ticketOrder.update({
          where: { id: current.ticketOrder.id },
          data: { confirmationEmailQueuedAt: now },
        });
      }
      return payment;
    }

    if (current.registration) {
      if (tx.adminSlotReservation?.deleteMany) {
        await tx.adminSlotReservation.deleteMany({
          where: { registrationId: current.registration.id },
        });
      }
      await tx.teamRegistration.update({
        where: { id: current.registration.id },
        data: {
          paymentStatus: "unpaid",
          reservedUntil: null,
          assignedSlotNumber: null,
        },
      });
    } else {
      await tx.ticketOrder.update({
        where: { id: current.ticketOrder.id },
        data: { status: "cancelled", capacityReleasedAt: now },
      });
      await tx.ticket.updateMany({
        where: { orderId: current.ticketOrder.id, status: "pending" },
        data: { status: "cancelled" },
      });
    }
    await tx.bankTransferProof.update({
      where: { transactionId: current.id },
      data: {
        reviewedAt: now,
        reviewedById: admin.id,
        rejectionReason: normalizedReason,
      },
    });
    return tx.paymentTransaction.update({
      where: { id: current.id },
      data: { status: "failed", statusMessage: normalizedReason },
    });
  });

  if (result.status === "paid" && result.registrationId) {
    await activatePaidTeamRegistration(result.registrationId);
  }
  return result;
};

const cleanupRetainedBankTransferProofs = async ({ now = new Date(), batchSize = 50 } = {}) => {
  const cutoff = new Date(
    now.getTime() - env.BANK_TRANSFER_PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const proofs = await prisma.bankTransferProof.findMany({
    where: {
      transaction: { status: { in: ["paid", "failed", "charged_back", "expired"] } },
      OR: [
        { reviewedAt: { lte: cutoff } },
        { reviewedAt: null, submittedAt: { lte: cutoff } },
      ],
    },
    orderBy: { reviewedAt: "asc" },
    take: batchSize,
    select: { id: true, storedFilename: true },
  });

  let deleted = 0;
  for (const proof of proofs) {
    try {
      const fileRemoved = await removeUploadsQuietly(
        [{ directory: bankTransferProofDirectory, filename: proof.storedFilename }],
        { operation: "cleanupRetainedBankTransferProof", proofId: proof.id }
      );
      if (!fileRemoved) continue;
      const result = await prisma.bankTransferProof.deleteMany({ where: { id: proof.id } });
      if (result.count) deleted += 1;
    } catch (error) {
      logger.error("Retained bank-transfer proof cleanup failed", {
        proofId: proof.id,
        error,
      });
    }
  }
  return deleted;
};

module.exports = {
  assertBankTransferConfigured,
  buildBankTransferInstructions,
  getBankTransferAmountForSlot,
  getFeeTiers,
  submitBankTransferProof,
  getBankTransferProofFile,
  reviewBankTransfer,
  cleanupRetainedBankTransferProofs,
};
