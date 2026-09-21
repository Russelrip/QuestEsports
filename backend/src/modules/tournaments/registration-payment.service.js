const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeEmail, normalizeText } = require("../../lib/validation");
const { createPayHereCheckout } = require("../payments/payment.service");
const {
  buildBankTransferInstructions,
  getBankTransferAmountForSlot,
} = require("../payments/bank-transfer.service");
const {
  allocateLowestAvailableSlot,
  buildActiveRegistrationWhere,
  countTournamentCapacityUsage,
  hasAvailableCapacity,
} = require("./registration-eligibility");
const { removeTeamLogoIfUnreferenced } = require("../../lib/upload-cleanup");
const { assertNoCoachPlayerRoleConflict } = require("./role-conflict.service");
const {
  runSerializable,
  mapRegistrationResult,
  getRosterVerificationStatus,
  getCurrentTournamentForRegistration,
} = require("./registration-shared");

const buildCheckout = ({ payment, tournament, user, body }) =>
  createPayHereCheckout({
    transaction: payment,
    customer: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: normalizeText(body.phone || body.captainPhone || user.phone),
      address: "Tournament registration",
      city: "Colombo",
      country: normalizeText(body.country) || "Sri Lanka",
    },
    items: `${tournament.title} registration`,
    returnPath: `/tournaments/${tournament.slug}/payment?order=${encodeURIComponent(payment.providerOrderId)}`,
    cancelPath: `/tournaments/${tournament.slug}?payment=cancelled`,
  });

const buildPaymentOrderId = (paymentMethod) => {
  if (paymentMethod === "bank_transfer") {
    // Eight Crockford Base32 characters retain 40 bits of randomness while
    // being shorter and easier to read/type than the previous hexadecimal ID.
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let randomValue = 0n;
    for (const byte of crypto.randomBytes(5)) {
      randomValue = (randomValue << 8n) | BigInt(byte);
    }
    let reference = "";
    for (let index = 0; index < 8; index += 1) {
      reference = alphabet[Number(randomValue & 31n)] + reference;
      randomValue >>= 5n;
    }
    return reference;
  }
  return `TOUR-${crypto.randomUUID()}`;
};

const consumeAdminHoldOrQuoteSlot = async ({
  tx,
  registrationId,
  tournament,
  paymentMethod,
  feeAmount,
}) => {
  const adminHold = tx.adminSlotReservation?.findUnique
    ? await tx.adminSlotReservation.findUnique({ where: { registrationId } })
    : null;
  if (adminHold) {
    await tx.adminSlotReservation.delete({ where: { id: adminHold.id } });
    return {
      assignedSlotNumber: adminHold.assignedSlotNumber,
      quotedFeeAmount: Number(adminHold.quotedFeeAmount),
      quotedFeeCurrency: adminHold.quotedFeeCurrency,
    };
  }

  const assignedSlotNumber = paymentMethod === "bank_transfer"
    ? await allocateLowestAvailableSlot({
        tx,
        tournamentId: tournament.id,
        maxTeams: tournament.maxTeams,
        excludeRegistrationId: registrationId,
      })
    : null;
  return {
    assignedSlotNumber,
    quotedFeeAmount: paymentMethod === "bank_transfer"
      ? getBankTransferAmountForSlot(tournament, assignedSlotNumber)
      : feeAmount,
    quotedFeeCurrency: tournament.registrationFeeCurrency,
  };
};

const startExistingRegistrationPayment = async ({
  existing,
  tournament,
  paymentMethod,
  feeAmount,
  user,
}) => {
  const providerOrderId = buildPaymentOrderId(paymentMethod);
  const result = await runSerializable(async (tx) => {
    const currentRegistration = await tx.teamRegistration.findUnique({
      where: { id: existing.id },
      include: {
        members: {
          select: {
            role: true,
            inviteStatus: true,
            email: true,
            emailNormalized: true,
            riotId: true,
          },
        },
      },
    });
    if (!currentRegistration || currentRegistration.paymentStatus === "paid") {
      throw new HttpError(409, "This tournament registration is already paid.");
    }
    if (currentRegistration.status === "rejected") {
      throw new HttpError(409, "This tournament registration was rejected and cannot continue to payment.");
    }
    const currentVerificationStatus = getRosterVerificationStatus(
      currentRegistration.members,
      currentRegistration.verificationStatus
    );
    if (currentRegistration.entryType === "team" && currentVerificationStatus !== "verified") {
      throw new HttpError(
        409,
        currentVerificationStatus === "flagged"
          ? "A roster invitation was declined. Update the team before continuing to payment."
          : "Every roster member must accept the team invitation before payment."
      );
    }

    const currentTournament = await getCurrentTournamentForRegistration({
      tx,
      tournament,
      now: new Date(),
    });
    await assertNoCoachPlayerRoleConflict({
      tx,
      tournamentId: currentTournament.id,
      members: currentRegistration.members,
      excludeRegistrationId: existing.id,
    });
    const activeCount = await countTournamentCapacityUsage({ tx, tournamentId: currentTournament.id, excludeRegistrationId: existing.id });
    if (!hasAvailableCapacity(currentTournament, activeCount)) {
      throw new HttpError(409, "Registration slots are full.");
    }
    if (currentRegistration.entryType === "team") {
      const duplicateTeam = await tx.teamRegistration.findFirst({
        where: {
          id: { not: existing.id },
          tournamentId: currentTournament.id,
          entryType: "team",
          teamName: currentRegistration.teamName,
          ...buildActiveRegistrationWhere(),
        },
        select: { id: true },
      });
      if (duplicateTeam) {
        throw new HttpError(409, "A team with this name is already registered.");
      }
    }
    const {
      assignedSlotNumber,
      quotedFeeAmount,
      quotedFeeCurrency,
    } = await consumeAdminHoldOrQuoteSlot({
      tx,
      registrationId: existing.id,
      tournament: currentTournament,
      paymentMethod,
      feeAmount,
    });
    const reservedUntil = new Date(
      Date.now() + currentTournament.reservationMinutes * 60 * 1000
    );

    await tx.paymentTransaction.updateMany({
      where: {
        registrationId: existing.id,
        status: { in: ["created", "pending", "review_required"] },
      },
      data: {
        status: "expired",
        statusMessage: "Superseded after roster verification completed.",
      },
    });
    const registration = await tx.teamRegistration.update({
      where: { id: existing.id },
      data: {
        paymentStatus: "pending",
        verificationStatus: currentVerificationStatus,
        reservedUntil,
        assignedSlotNumber,
        quotedFeeAmount,
        quotedFeeCurrency,
      },
    });
    const payment = await tx.paymentTransaction.create({
      data: {
        id: crypto.randomUUID(),
        purpose: "tournament_registration",
        provider: paymentMethod,
        providerOrderId,
        registrationId: existing.id,
        amount: quotedFeeAmount,
        currency: quotedFeeCurrency,
        method: paymentMethod === "bank_transfer" ? "bank_transfer" : null,
      },
    });
    return { registration, payment, tournament: currentTournament };
  });

  const checkoutBody = {
    phone: existing.captainPhone,
    country: existing.country,
  };
  return {
    registration: mapRegistrationResult(result.registration),
    paymentOrderId: providerOrderId,
    checkout: paymentMethod === "payhere"
      ? buildCheckout({ payment: result.payment, tournament: result.tournament, user, body: checkoutBody })
      : null,
    bankTransfer: paymentMethod === "bank_transfer"
      ? buildBankTransferInstructions({
          transaction: result.payment,
          registration: result.registration,
          tournament: result.tournament,
        })
      : null,
    awaitingTeamVerification: false,
    readyForPayment: false,
  };
};

const cancelUnpaidRegistration = async ({ slug, user }) => {
  const tournamentSlug = normalizeText(slug).toLowerCase();
  const registration = await runSerializable(async (tx) => {
    const current = await tx.teamRegistration.findFirst({
      where: {
        tournament: { slug: tournamentSlug },
        OR: [
          { userId: user.id },
          { userId: null, captainEmail: normalizeEmail(user.email) },
        ],
      },
      select: {
        id: true,
        paymentStatus: true,
        teamLogoName: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!current) throw new HttpError(404, "Tournament registration not found.");
    if (current.payments?.[0]?.status === "expired") {
      throw new HttpError(
        409,
        "This expired registration must be reviewed by an administrator."
      );
    }
    if (current.paymentStatus !== "unpaid") {
      throw new HttpError(
        409,
        "This registration cannot be cancelled after payment or a payment reservation has started. Contact an administrator for help."
      );
    }
    const deleted = await tx.teamRegistration.deleteMany({
      where: {
        id: current.id,
        paymentStatus: "unpaid",
      },
    });
    if (!deleted.count) {
      throw new HttpError(
        409,
        "This registration cannot be cancelled after payment or a payment reservation has started. Contact an administrator for help."
      );
    }
    return current;
  });
  if (registration.teamLogoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: registration.teamLogoName,
      context: { operation: "cancelUnpaidRegistration", registrationId: registration.id },
    });
  }
};

module.exports = {
  buildCheckout,
  buildPaymentOrderId,
  consumeAdminHoldOrQuoteSlot,
  startExistingRegistrationPayment,
  cancelUnpaidRegistration,
};
