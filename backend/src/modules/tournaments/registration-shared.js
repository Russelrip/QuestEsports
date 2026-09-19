const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const {
  getRegistrationPublicReference,
  getTournamentRegistrationState,
} = require("./registration-state");
const { assertNoCoachPlayerRoleConflict } = require("./role-conflict.service");
const { sendRegistrationReceivedEmail } = require("../../lib/mail/sendRegistrationReceivedEmail");

const normalizeBoolean = (value) => [true, "true", "1", "on"].includes(value);
const VALORANT_RIOT_ID_PATTERN = /^[^#\r\n]{3,16}#[A-Za-z0-9]{3,5}$/;
const REGISTRATION_TRANSACTION_MAX_RETRIES = 3;
const REGISTRATION_TRANSACTION_MAX_WAIT_MS = 10 * 1000;
const REGISTRATION_TRANSACTION_TIMEOUT_MS = 20 * 1000;
const RETRYABLE_REGISTRATION_TRANSACTION_ERROR_CODES = new Set([
  "P2024",
  "P2028",
  "P2034",
  "P2037",
  "P2002",
]);
const waitBeforeTransactionRetry = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, attempt * 100));

const runRetryableRegistrationQuery = async (work) => {
  for (let attempt = 1; attempt <= REGISTRATION_TRANSACTION_MAX_RETRIES; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const shouldRetry =
        RETRYABLE_REGISTRATION_TRANSACTION_ERROR_CODES.has(error?.code) &&
        attempt < REGISTRATION_TRANSACTION_MAX_RETRIES;
      if (!shouldRetry) throw error;

      await waitBeforeTransactionRetry(attempt);
    }
  }

  throw new Error("Registration query retry limit was exhausted.");
};

const runSerializable = async (work) => {
  for (let attempt = 1; attempt <= REGISTRATION_TRANSACTION_MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: REGISTRATION_TRANSACTION_MAX_WAIT_MS,
        timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      const shouldRetry =
        RETRYABLE_REGISTRATION_TRANSACTION_ERROR_CODES.has(error?.code) &&
        attempt < REGISTRATION_TRANSACTION_MAX_RETRIES;

      if (!shouldRetry) {
        throw error;
      }

      await waitBeforeTransactionRetry(attempt);
    }
  }

  throw new Error("Registration transaction retry limit was exhausted.");
};
const parseJson = (value, fallback, label) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new HttpError(400, `${label} must be valid JSON.`);
  }
};

const mapRegistrationResult = (registration) => ({
  id: registration.id,
  entryType: registration.entryType,
  displayName:
    registration.entryType === "solo"
      ? registration.captainName || registration.teamName
      : registration.teamName,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
  verificationStatus: registration.verificationStatus,
  assignedSlotNumber: registration.assignedSlotNumber,
  waitlistPosition: registration.waitlistPosition || null,
  publicReference: getRegistrationPublicReference(registration),
  quotedFeeAmount: registration.quotedFeeAmount
    ? Number(registration.quotedFeeAmount)
    : null,
  quotedFeeCurrency: registration.quotedFeeCurrency,
  reservedUntil: registration.reservedUntil,
});

const getRosterVerificationStatus = (members = [], fallback = "pending") => {
  const rosterMembers = members.filter((member) => member.role !== "CAPTAIN");
  if (rosterMembers.some((member) => member.inviteStatus === "declined")) return "flagged";
  if (
    members.length > 0 &&
    rosterMembers.every((member) => member.inviteStatus === "accepted")
  ) {
    return "verified";
  }
  return fallback;
};

const queueRegistrationReceivedEmail = async ({
  registrationId,
  email,
  recipientName,
  teamName,
  tournamentTitle,
  pendingMemberCount,
}) => {
  try {
    await sendRegistrationReceivedEmail({
      registrationId,
      email,
      recipientName,
      teamName,
      tournamentTitle,
      pendingMemberCount,
    });
  } catch (error) {
    logger.error("Failed to queue tournament registration received email.", {
      registrationId,
      email,
      error,
    });
  }
};

const assertRegistrationStillOpen = (tournament, now, statusCode = 400) => {
  const state = getTournamentRegistrationState({ tournament, now, capacityUsed: -1 });
  if (state.state !== "registration_open" && state.state !== "waitlist_open") {
    throw new HttpError(statusCode, "Registration is closed for this tournament.");
  }
};

const buildPersistedRegistrationMembers = ({ members, coach }) => coach
  ? [
      ...members,
      {
        role: "COACH",
        order: 1,
        name: coach.name,
        email: coach.email,
        phone: coach.phone,
        discord: coach.discord,
        riotId: coach.riotId,
        additionalData: {},
      },
    ]
  : members;

const validateExistingRegistrationRoleConflict = async ({ registrationId, tournamentId }) => {
  await runSerializable(async (tx) => {
    const currentRegistration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        members: {
          select: {
            role: true,
            email: true,
            emailNormalized: true,
            riotId: true,
          },
        },
      },
    });
    if (!currentRegistration) return;
    await assertNoCoachPlayerRoleConflict({
      tx,
      tournamentId,
      members: currentRegistration.members,
      excludeRegistrationId: registrationId,
    });
  });
};

const getCurrentTournamentForRegistration = async ({
  tx,
  tournament,
  now,
  allowActivePaymentReservation = false,
}) => {
  const current = await tx.tournament.findUnique({
    where: { id: tournament.id },
    include: {
      series: {
        select: {
          registrationOpenAt: true,
          registrationCloseAt: true,
          registrationStatusOverride: true,
        },
      },
    },
  });
  const canFinishExistingReservation =
    allowActivePaymentReservation &&
    current?.isPublished &&
    ["registration_open", "upcoming"].includes(current.status);
  if (!canFinishExistingReservation) {
    assertRegistrationStillOpen(current, now, 409);
  }
  if (
    tournament.updatedAt &&
    current.updatedAt &&
    current.updatedAt.getTime() !== tournament.updatedAt.getTime()
  ) {
    throw new HttpError(
      409,
      "The tournament configuration changed. Review the latest details and submit again."
    );
  }
  return current;
};

module.exports = {
  normalizeBoolean,
  VALORANT_RIOT_ID_PATTERN,
  runRetryableRegistrationQuery,
  runSerializable,
  parseJson,
  mapRegistrationResult,
  getRosterVerificationStatus,
  queueRegistrationReceivedEmail,
  assertRegistrationStillOpen,
  buildPersistedRegistrationMembers,
  validateExistingRegistrationRoleConflict,
  getCurrentTournamentForRegistration,
};
