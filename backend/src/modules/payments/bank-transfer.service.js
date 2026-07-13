const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Prisma } = require("../../generated/prisma");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  bankTransferProofDirectory,
  persistBankTransferProofUpload,
  removeUploadFile,
} = require("../../middleware/upload");
const { buildActiveRegistrationWhere } = require("../tournaments/registration-eligibility");
const { activatePaidTeamRegistration } = require("../teams/team.service");

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

const buildBankTransferInstructions = ({ transaction, registration, tournament }) => ({
  orderId: transaction.providerOrderId,
  reference: transaction.providerOrderId,
  assignedSlotNumber: registration.assignedSlotNumber,
  amount: Number(transaction.amount),
  currency: transaction.currency,
  expiresAt: registration.reservedUntil,
  status: transaction.status,
  proofSubmitted: Boolean(transaction.bankTransferProof),
  bankAccount: {
    bankName: tournament.bankName,
    branch: tournament.bankBranch,
    accountName: tournament.bankAccountName,
    accountNumber: tournament.bankAccountNumber,
  },
});

const submitBankTransferProof = async ({ providerOrderId, user, file }) => {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { providerOrderId },
    include: {
      bankTransferProof: true,
      registration: { include: { tournament: true } },
    },
  });
  if (!transaction || transaction.provider !== "bank_transfer" || !transaction.registration) {
    throw new HttpError(404, "Bank-transfer payment was not found.");
  }
  if (transaction.registration.userId !== user.id) {
    throw new HttpError(403, "Payment access denied.");
  }
  if (transaction.status === "paid") {
    throw new HttpError(409, "This payment has already been approved.");
  }
  if (!["created", "pending", "review_required"].includes(transaction.status)) {
    throw new HttpError(409, "This payment is no longer accepting proof uploads.");
  }
  if (
    !transaction.registration.reservedUntil ||
    transaction.registration.reservedUntil <= new Date()
  ) {
    throw new HttpError(409, "This slot reservation expired. Start the registration again.");
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
        },
      });
      if (!current || current.provider !== "bank_transfer" || !current.registration) {
        throw new HttpError(404, "Bank-transfer payment was not found.");
      }
      if (current.registration.userId !== user.id) {
        throw new HttpError(403, "Payment access denied.");
      }
      if (current.status === "paid") {
        throw new HttpError(409, "This payment has already been approved.");
      }
      if (!["created", "pending", "review_required"].includes(current.status)) {
        throw new HttpError(409, "This payment is no longer accepting proof uploads.");
      }
      const now = new Date();
      if (!current.registration.reservedUntil || current.registration.reservedUntil <= now) {
        throw new HttpError(409, "This slot reservation expired. Start the registration again.");
      }

      const duplicate = await tx.bankTransferProof.findFirst({
        where: {
          sha256: persisted.sha256,
          transactionId: { not: current.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, "This payment proof has already been used for another registration.");
      }

      const reviewUntil = new Date(
        now.getTime() + current.registration.tournament.bankTransferReviewMinutes * 60 * 1000
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
      await tx.teamRegistration.update({
        where: { id: current.registrationId },
        data: { paymentStatus: "pending", reservedUntil: reviewUntil },
      });
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
      await removeUploadFile({
        directory: bankTransferProofDirectory,
        filename: saved.previousFilename,
      }).catch(() => undefined);
    }
    return { proof: saved.proof, reviewUntil: saved.reviewUntil };
  } catch (error) {
    await removeUploadFile({
      directory: bankTransferProofDirectory,
      filename: persisted.filename,
    }).catch(() => undefined);
    if (error?.code === "P2002") {
      throw new HttpError(409, "This payment proof has already been used for another registration.");
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
        registration: { include: { tournament: true } },
      },
    });
    if (!current || current.provider !== "bank_transfer" || !current.registration) {
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
      if (!current.registration.reservedUntil || current.registration.reservedUntil <= now) {
        throw new HttpError(409, "The reservation expired. Reject it and ask the team to register again.");
      }
      const otherActiveCount = await tx.teamRegistration.count({
        where: {
          id: { not: current.registration.id },
          tournamentId: current.registration.tournamentId,
          ...buildActiveRegistrationWhere({ now }),
        },
      });
      if (otherActiveCount >= current.registration.tournament.maxTeams) {
        throw new HttpError(409, "The tournament no longer has an available slot.");
      }
      await tx.teamRegistration.update({
        where: { id: current.registration.id },
        data: { paymentStatus: "paid", reservedUntil: null },
      });
      await tx.bankTransferProof.update({
        where: { transactionId: current.id },
        data: {
          reviewedAt: now,
          reviewedById: admin.id,
          rejectionReason: null,
        },
      });
      return tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "paid",
          paidAt: now,
          statusMessage: "Bank transfer verified by Quest E-sports.",
        },
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
    const result = await prisma.bankTransferProof.deleteMany({ where: { id: proof.id } });
    if (!result.count) continue;
    deleted += 1;
    await removeUploadFile({
      directory: bankTransferProofDirectory,
      filename: proof.storedFilename,
    }).catch(() => undefined);
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
