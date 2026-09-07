const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { isValidEmail, normalizeEmail, normalizeText } = require("../../lib/validation");
const { persistTeamLogoUpload, teamLogoDirectory } = require("../../middleware/upload");
const {
  ensureTeamRegistrationSaved,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
} = require("../teams/team.service");
const { assertPayHereConfigured, createPayHereCheckout } = require("../payments/payment.service");
const {
  assertBankTransferConfigured,
  buildBankTransferInstructions,
  getBankTransferAmountForSlot,
} = require("../payments/bank-transfer.service");
const {
  allocateLowestAvailableSlot,
  buildActiveRegistrationWhere,
  countTournamentCapacityUsage,
  getNextWaitlistPosition,
  hasAvailableCapacity,
} = require("./registration-eligibility");
const { maybeAutoApproveRegistration } = require("./auto-approval.service");
const {
  buildPublicReference,
  getRegistrationPublicReference,
  getTournamentRegistrationState,
} = require("./registration-state");
const {
  removeTeamLogoIfUnreferenced,
  removeUploadsQuietly,
} = require("../../lib/upload-cleanup");
const { normalizeCoachSubmission, parseCoachInput } = require("./coach.validation");
const {
  getLinkedDiscordForUsers,
  requireLinkedDiscord,
} = require("../auth/discord-link.service");
const {
  assertNoLocalCoachPlayerRoleConflict,
  assertNoCoachPlayerRoleConflict,
} = require("./role-conflict.service");
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

const validateConfiguredFields = ({ definitions, entryData, members }) => {
  const validateValue = (field, value) => {
    const normalized = value === undefined || value === null ? "" : String(value).trim();
    if (field.required && !normalized) throw new HttpError(400, `${field.label} is required.`);
    if (normalized.length > 500) throw new HttpError(400, `${field.label} is too long.`);
    if (normalized && field.type === "number" && !Number.isFinite(Number(normalized))) {
      throw new HttpError(400, `${field.label} must be a number.`);
    }
    if (normalized && field.type === "select" && !field.options.includes(normalized)) {
      throw new HttpError(400, `${field.label} has an invalid selection.`);
    }
    if (normalized && field.type === "checkbox" && !["true", "false", "1", "0", "on", "off"].includes(normalized.toLowerCase())) {
      throw new HttpError(400, `${field.label} must be checked or unchecked.`);
    }
    if (normalized && field.type === "checkbox" && field.required && !["true", "1", "on"].includes(normalized.toLowerCase())) {
      throw new HttpError(400, `${field.label} must be accepted.`);
    }
    if (normalized && field.type === "url") {
      let parsed;
      try { parsed = new URL(normalized); } catch { parsed = null; }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        throw new HttpError(400, `${field.label} must be a valid HTTP or HTTPS URL.`);
      }
    }
    if (field.type === "checkbox") return ["true", "1", "on"].includes(normalized.toLowerCase());
    return normalized;
  };

  const normalizedEntry = {};
  for (const field of definitions.filter((field) => field.scope === "entry")) {
    normalizedEntry[field.key] = validateValue(field, entryData[field.key]);
  }
  const normalizedMembers = members.map((member) => {
    const data = {};
    for (const field of definitions.filter((field) => field.scope === "member")) {
      data[field.key] = validateValue(field, member.additionalData?.[field.key]);
    }
    return { ...member, additionalData: data };
  });
  return { entryData: normalizedEntry, members: normalizedMembers };
};

const isGameIdentityField = (field, game) => {
  const fieldText = `${field?.key || ""} ${field?.label || ""}`.toLowerCase();
  const gameWords = normalizeText(game)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  return /(?:riot|ign|in[ -]?game|player[ -]?id|game[ -]?id|uid)/i.test(fieldText) ||
    (/\bid\b/i.test(fieldText.replace(/[_-]/g, " ")) && gameWords.some((word) => fieldText.includes(word)));
};

const validateGameIdentities = ({ game, members }) => {
  const gameName = normalizeText(game) || "Game";
  const missingIdentity = members.some((member) => !normalizeText(member.riotId));
  if (missingIdentity) {
    throw new HttpError(400, `${gameName} IGN or player ID is required for every roster member.`);
  }
  if (
    gameName.toLowerCase().includes("valorant") &&
    members.some((member) => !VALORANT_RIOT_ID_PATTERN.test(normalizeText(member.riotId)))
  ) {
    throw new HttpError(
      400,
      "Every Valorant Riot ID must include the game name and # tagline, for example PlayerName#123."
    );
  }
};

const assertCoachInputAllowed = ({ tournament, body }) => {
  const coachInput = parseCoachInput(body);
  if (coachInput && !tournament.allowCoach) {
    throw new HttpError(400, "This tournament does not accept coach details.");
  }
  return coachInput;
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

// Roster Discord handles are never typed in. The captain's comes from their own
// linked account; everyone else's is resolved from the Quest account that owns
// their roster email.
//
// A roster member with no Quest account, or one whose account has no link, ends
// up with no handle at all, and that is correct rather than a failure: a captain
// registering a LAN entrant cannot connect Discord on their behalf. The
// tournament's `discordRequired` flag stays the single place that decides
// whether a missing link blocks registration, which is what keeps this resolver
// from quietly becoming a second, competing gate.
const attachConnectedDiscordIdentities = async ({ user, submission }) => {
  const captain = await requireLinkedDiscord(
    user.id,
    "Connect your Discord account before registering for a tournament."
  );
  // The snowflake is the fallback because it always exists and always resolves
  // to the right person; a blank cached username would leave an organiser with
  // nothing to search for.
  const captainHandle = captain.discordUsername || captain.discordId;

  const rosterEmails = [
    ...submission.members.map((member) => member.email),
    submission.coach?.email,
  ]
    .filter(Boolean)
    .map((email) => normalizeEmail(email));

  const accounts = rosterEmails.length > 0
    ? await prisma.user.findMany({
      where: { emailNormalized: { in: [...new Set(rosterEmails)] } },
      select: { id: true, emailNormalized: true },
    })
    : [];
  const linkedByUserId = await getLinkedDiscordForUsers(
    accounts.map((account) => account.id)
  );
  const handleByEmail = new Map(
    accounts
      .map((account) => {
        const identity = linkedByUserId.get(account.id);
        return [
          account.emailNormalized,
          identity ? identity.discordUsername || identity.discordId : null,
        ];
      })
      .filter(([, handle]) => Boolean(handle))
  );
  const handleFor = (email) => handleByEmail.get(normalizeEmail(email)) || null;

  return {
    ...submission,
    discord: captainHandle,
    members: submission.members.map((member) => (member.role === "CAPTAIN"
      ? { ...member, discord: captainHandle }
      : { ...member, discord: handleFor(member.email) })),
    coach: submission.coach
      ? { ...submission.coach, discord: handleFor(submission.coach.email) }
      : submission.coach,
  };
};

const normalizeRegistrationSubmission = ({ tournament, body, user }) => {
  const fullName = normalizeText(body.fullName || body.captainName) ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const displayName = tournament.entryType === "solo"
    ? fullName
    : normalizeText(body.teamName);
  const phone = normalizeText(body.phone || body.captainPhone || user.phone);
  // Deliberately not read from the body. Roster Discord handles come from
  // connected accounts and are filled in by attachConnectedDiscordIdentities.
  const discord = null;
  const contactEmail = normalizeEmail(body.contactEmail || user.email);
  const country = normalizeText(body.country) || "Sri Lanka";
  const teamTag = tournament.entryType === "solo"
    ? null
    : normalizeText(body.teamTag) || displayName?.slice(0, 12).toUpperCase();
  const rulebookAccepted = normalizeBoolean(body.rulebookAccepted ?? body.rulebook);
  const falsityWarningAccepted = normalizeBoolean(body.falsityWarningAccepted ?? body.falsityWarning);
  const additionalData = parseJson(body.additionalData, {}, "Additional registration data");
  const captainAdditionalData = parseJson(
    body.captainAdditionalData,
    {},
    "Captain registration data"
  );
  const coach = normalizeCoachSubmission({ tournament, body });
  let requestedMembers = parseJson(body.members, [], "Roster members");
  if (!Array.isArray(requestedMembers)) throw new HttpError(400, "Roster members must be a list.");

  if (!displayName || !fullName || !phone || !isValidEmail(contactEmail) || !rulebookAccepted || !falsityWarningAccepted) {
    throw new HttpError(400, "Complete the required registration details and agreements.");
  }
  if (
    displayName.length > 100 ||
    fullName.length > 100 ||
    phone.length > 50 ||
    contactEmail.length > 254 ||
    (teamTag && teamTag.length > 12) ||
    country.length > 100
  ) {
    throw new HttpError(400, "One or more registration fields exceed the allowed length.");
  }

  if (tournament.entryType === "solo") requestedMembers = [];
  const captainGameId = normalizeText(body.gameId || body.captainRiotId) || null;
  const registrationFields = Array.isArray(tournament.registrationFields)
    ? tournament.registrationFields
    : [];
  for (const field of registrationFields.filter(
    (field) => field.scope === "entry" && isGameIdentityField(field, tournament.game)
  )) {
    additionalData[field.key] = captainGameId;
  }
  for (const field of registrationFields.filter(
    (field) => field.scope === "member" && isGameIdentityField(field, tournament.game)
  )) {
    captainAdditionalData[field.key] = captainGameId;
  }
  const normalizedMembers = requestedMembers.map((member, index) => ({
    role: normalizeText(member.role).toUpperCase() === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER",
    order: index + 1,
    name: normalizeText(member.name),
    email: normalizeEmail(member.email),
    // Resolved from the member's connected account at submission time.
    discord: null,
    riotId: normalizeText(member.gameId || member.riotId) || null,
    additionalData: {
      ...(member.additionalData || {}),
      ...Object.fromEntries(
        registrationFields
          .filter((field) => field.scope === "member" && isGameIdentityField(field, tournament.game))
          .map((field) => [field.key, normalizeText(member.gameId || member.riotId) || null])
      ),
    },
  }));
  if (normalizedMembers.some((member) => !member.name || !isValidEmail(member.email))) {
    throw new HttpError(400, "Every roster member needs a name and valid email.");
  }
  if (normalizedMembers.some((member) =>
    member.name.length > 100 ||
    member.email.length > 254 ||
    (member.riotId && member.riotId.length > 100)
  )) {
    throw new HttpError(400, "One or more roster fields exceed the allowed length.");
  }
  const playerCount = 1 + normalizedMembers.filter((member) => member.role === "PLAYER").length;
  const substituteCount = normalizedMembers.filter((member) => member.role === "SUBSTITUTE").length;
  if (playerCount < tournament.minRosterSize || playerCount > tournament.maxRosterSize || substituteCount > tournament.maxSubstitutes) {
    const requiredPlayers = tournament.minRosterSize === tournament.maxRosterSize
      ? `exactly ${tournament.minRosterSize}`
      : `${tournament.minRosterSize}-${tournament.maxRosterSize}`;
    throw new HttpError(
      400,
      `This event requires ${requiredPlayers} active players, including the captain, and allows up to ${tournament.maxSubstitutes} substitutes. Your roster has ${playerCount} active players and ${substituteCount} substitutes.`
    );
  }

  const configured = validateConfiguredFields({
    definitions: registrationFields,
    entryData: additionalData,
    members: [
      {
        role: "CAPTAIN",
        order: 0,
        name: fullName,
        email: normalizeEmail(user.email),
        discord,
        riotId: captainGameId,
        additionalData: captainAdditionalData,
      },
      ...normalizedMembers,
    ],
  });
  const [configuredCaptain, ...configuredRosterMembers] = configured.members;
  const primaryGameId = captainGameId;
  const registrationMembers = [
    { ...configuredCaptain, riotId: primaryGameId },
    ...configuredRosterMembers,
  ];
  assertNoLocalCoachPlayerRoleConflict(
    buildPersistedRegistrationMembers({ members: registrationMembers, coach })
  );
  const emails = [normalizeEmail(user.email), ...normalizedMembers.map((member) => member.email)];
  if (new Set(emails).size !== emails.length) throw new HttpError(400, "Roster emails must be unique.");
  validateGameIdentities({ game: tournament.game, members: registrationMembers });

  return {
    fullName,
    displayName,
    phone,
    discord,
    contactEmail,
    country,
    teamTag,
    rulebookAccepted,
    falsityWarningAccepted,
    configuredEntryData: configured.entryData,
    primaryGameId,
    members: registrationMembers,
    coach,
  };
};

const createConfiguredRegistration = async ({ slug, body, file, user }) => {
  const submittedSlug = normalizeText(body.tournamentSlug || body.tournament);
  if (submittedSlug && submittedSlug !== slug) {
    throw new HttpError(400, "Tournament registration route and payload do not match.");
  }
  const tournament = await runRetryableRegistrationQuery(() =>
    prisma.tournament.findFirst({
      where: { slug, isPublished: true },
      include: {
        _count: { select: { teamRegistrations: true } },
        series: {
          select: {
            registrationOpenAt: true,
            registrationCloseAt: true,
            registrationStatusOverride: true,
          },
        },
      },
    })
  );
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const now = new Date();

  // Existing registrations have early payment-verification paths, so reject
  // disabled coach input before any of those paths can start a transaction.
  assertCoachInputAllowed({ tournament, body });

  const feeAmount = Number(tournament.registrationFeeAmount || 0);
  const paymentMethod = feeAmount > 0 ? tournament.paymentMethod || "payhere" : "free";
  // A team roster is confirmed by the people on it, and that is true whether or
  // not the event charges anything. This condition used to carry two ideas under
  // one name — "there is a roster to confirm" and "there is a fee to hold back
  // until it is" — which was harmless while every team event charged. Free team
  // events then inherited the payment half of the meaning, so their captains
  // were told an outstanding roster was waiting on nothing.
  const requiresTeamVerification = tournament.entryType === "team";
  // The payment half, kept separate. No fee is quoted, reserved or collected
  // while invitations are outstanding; with no fee there is nothing to hold.
  const holdsPaymentForRoster = requiresTeamVerification && feeAmount > 0;
  if (paymentMethod === "payhere") assertPayHereConfigured();
  if (paymentMethod === "bank_transfer") assertBankTransferConfigured(tournament);
  if (feeAmount > 0 && !["payhere", "bank_transfer"].includes(paymentMethod)) {
    throw new HttpError(503, "This paid tournament does not have a payment method configured.");
  }
  const existing = await runRetryableRegistrationQuery(() =>
    prisma.teamRegistration.findFirst({
      where: {
        tournamentId: tournament.id,
        OR: [
          { userId: user.id },
          { captainEmail: normalizeEmail(user.email) },
        ],
      },
      include: {
        members: {
          select: { role: true, inviteStatus: true },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { bankTransferProof: true },
        },
      },
    })
  );
  const hasActivePaymentReservation =
    existing?.paymentStatus === "pending" &&
    existing.reservedUntil &&
    existing.reservedUntil > now;
  if (!hasActivePaymentReservation) {
    assertRegistrationStillOpen(tournament, now, 409);
  }
  if (existing) {
    if (existing.status === "waitlisted") {
      return {
        registration: mapRegistrationResult(existing),
        paymentOrderId: null,
        checkout: null,
        bankTransfer: null,
        awaitingTeamVerification: false,
        readyForPayment: false,
        waitlisted: true,
      };
    }
    const existingMembers = existing.members || [];
    const effectiveVerificationStatus = getRosterVerificationStatus(
      existingMembers,
      existing.verificationStatus
    );
    const pendingInviteCount = existingMembers.filter(
      (member) => member.role !== "CAPTAIN" && member.inviteStatus === "pending"
    ).length;
    // A free event stores its row as paid the moment it is created, because
    // capacity counts paid rows. That made "you are already registered" the only
    // answer a free captain with outstanding invitations could ever get back —
    // no roster state, and no way to reach the resend controls from here. A
    // roster that has not finished confirming itself is not a finished
    // registration, so it falls through to the team block below instead.
    const awaitingFreeRoster =
      requiresTeamVerification &&
      feeAmount === 0 &&
      effectiveVerificationStatus !== "verified";
    if ((existing.paymentStatus === "paid" || feeAmount === 0) && !awaitingFreeRoster) {
      throw new HttpError(409, "You are already registered for this tournament.");
    }
    const latestPayment = existing.payments[0];
    if (latestPayment?.status === "expired") {
      throw new HttpError(
        409,
        "This payment window expired and the slot was released. Contact an administrator to request a new slot."
      );
    }

    if (tournament.entryType === "team") {
      await ensureTeamRegistrationSaved(existing.id);
      if (effectiveVerificationStatus !== "verified") {
        return {
          registration: {
            ...mapRegistrationResult(existing),
            verificationStatus: effectiveVerificationStatus,
          },
          paymentOrderId: null,
          checkout: null,
          bankTransfer: null,
          awaitingTeamVerification: true,
          readyForPayment: false,
          pendingInviteCount,
        };
      }
    }

    if (normalizeBoolean(body.resumePayment)) {
      const hasActivePayment =
        latestPayment &&
        ["created", "pending", "review_required"].includes(latestPayment.status) &&
        existing.paymentStatus === "pending" &&
        existing.reservedUntil &&
        existing.reservedUntil > now;
      if (hasActivePayment) {
        await validateExistingRegistrationRoleConflict({
          registrationId: existing.id,
          tournamentId: tournament.id,
        });
        return {
          registration: mapRegistrationResult(existing),
          paymentOrderId: latestPayment.providerOrderId,
          checkout: latestPayment.provider === "payhere"
            ? buildCheckout({
                payment: latestPayment,
                tournament,
                user,
                body: { phone: existing.captainPhone, country: existing.country },
              })
            : null,
          bankTransfer: latestPayment.provider === "bank_transfer"
            ? buildBankTransferInstructions({
                transaction: latestPayment,
                registration: existing,
                tournament,
              })
            : null,
          awaitingTeamVerification: false,
          readyForPayment: false,
        };
      }
      return startExistingRegistrationPayment({
        existing,
        tournament,
        paymentMethod,
        feeAmount,
        user,
      });
    }

    if (tournament.entryType === "team" && existing.paymentStatus === "unpaid") {
      return {
        registration: {
          ...mapRegistrationResult(existing),
          verificationStatus: "verified",
        },
        paymentOrderId: null,
        checkout: null,
        bankTransfer: null,
        awaitingTeamVerification: false,
        readyForPayment: true,
        pendingInviteCount: 0,
      };
    }
    if (
      paymentMethod === "bank_transfer" &&
      latestPayment?.provider === "bank_transfer" &&
      ["created", "pending", "review_required"].includes(latestPayment.status) &&
      existing.paymentStatus === "pending" &&
      existing.reservedUntil &&
      existing.reservedUntil > now
    ) {
      await validateExistingRegistrationRoleConflict({
        registrationId: existing.id,
        tournamentId: tournament.id,
      });
      return {
        registration: mapRegistrationResult(existing),
        paymentOrderId: latestPayment.providerOrderId,
        checkout: null,
        bankTransfer: buildBankTransferInstructions({
          transaction: latestPayment,
          registration: existing,
          tournament,
        }),
      };
    }
  }

  if (!hasActivePaymentReservation) {
    assertRegistrationStillOpen(tournament, now);
  }

  const submission = await attachConnectedDiscordIdentities({
    user,
    submission: normalizeRegistrationSubmission({ tournament, body, user }),
  });
  const {
    fullName,
    displayName,
    phone,
    discord,
    contactEmail,
    country,
    teamTag,
    rulebookAccepted,
    falsityWarningAccepted,
    configuredEntryData,
    primaryGameId,
    members,
    coach,
  } = submission;
  const persistedMembers = buildPersistedRegistrationMembers({ members, coach });
  // The roster's Discord requirement is not checked here any more. It used to
  // refuse the captain for a gap only the invitee could close — a captain
  // cannot connect Discord on someone else's behalf — which made the rule
  // unsatisfiable by the person it was being enforced against. It is enforced
  // where it can be acted on instead: accepting an invitation requires a
  // connected Discord account, for every roster on Quest. The captain's own
  // link is still required, by attachConnectedDiscordIdentities above.

  if (existing) {
    const providerOrderId = buildPaymentOrderId(paymentMethod);
    const reservedUntil = new Date(Date.now() + tournament.reservationMinutes * 60 * 1000);
    const persistedRetryLogo = tournament.entryType === "team"
      ? await persistTeamLogoUpload(file)
      : null;
    let retried;
    let retryInviteDispatches = [];
    try {
      retried = await runSerializable(async (tx) => {
        const currentRegistration = await tx.teamRegistration.findUnique({
          where: { id: existing.id },
        });
        if (!currentRegistration || currentRegistration.paymentStatus === "paid") {
          throw new HttpError(409, "You are already registered for this tournament.");
        }
        const retryNow = new Date();
        const hasActiveReservation =
          currentRegistration.paymentStatus === "pending" &&
          currentRegistration.reservedUntil &&
          currentRegistration.reservedUntil > retryNow;
        const currentTournament = await getCurrentTournamentForRegistration({
          tx,
          tournament,
          now: retryNow,
          allowActivePaymentReservation: Boolean(hasActiveReservation),
        });
        await assertNoCoachPlayerRoleConflict({
          tx,
          tournamentId: currentTournament.id,
          members: persistedMembers,
          excludeRegistrationId: existing.id,
        });
        const activeCount = await countTournamentCapacityUsage({
          tx,
          tournamentId: currentTournament.id,
          excludeRegistrationId: existing.id,
          now: retryNow,
        });
        const registrationState = hasActiveReservation
          ? { canRegister: hasAvailableCapacity(currentTournament, activeCount), canWaitlist: false }
          : getTournamentRegistrationState({
              tournament: currentTournament,
              capacityUsed: activeCount,
              now: retryNow,
            });
        if (!registrationState.canRegister) {
          if (!registrationState.canWaitlist) {
            throw new HttpError(409, "Registration slots are full.");
          }
          const waitlistPosition = currentRegistration.status === "waitlisted" &&
            Number.isInteger(currentRegistration.waitlistPosition) &&
            currentRegistration.waitlistPosition > 0
            ? currentRegistration.waitlistPosition
            : await getNextWaitlistPosition({ tx, tournamentId: currentTournament.id });
          const adminHold = tx.adminSlotReservation?.findUnique
            ? await tx.adminSlotReservation.findUnique({
                where: { registrationId: existing.id },
              })
            : null;
          if (adminHold) {
            await tx.adminSlotReservation.delete({ where: { id: adminHold.id } });
          }
          const waitlisted = await tx.teamRegistration.update({
            where: { id: existing.id },
            data: {
              status: "waitlisted",
              paymentStatus: "unpaid",
              reservedUntil: null,
              assignedSlotNumber: null,
              waitlistPosition,
            },
          });
          return { payment: null, registration: waitlisted, tournament: currentTournament, waitlisted: true };
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
        if (tournament.entryType === "team") {
          const duplicateTeam = await tx.teamRegistration.findFirst({
            where: {
              id: { not: existing.id },
              tournamentId: currentTournament.id,
              entryType: "team",
              teamName: displayName,
              ...buildActiveRegistrationWhere(),
            },
            select: { id: true },
          });
          if (duplicateTeam) throw new HttpError(409, "A team with this name is already registered.");
        }
        const registration = await tx.teamRegistration.update({
          where: { id: existing.id },
          data: {
            userId: user.id,
            teamName: displayName,
            country,
            teamTag,
            organizationRequested: normalizeBoolean(body.organizationRequested),
            captainName: fullName,
            captainEmail: normalizeEmail(user.email),
            captainPhone: phone,
            captainDiscord: discord,
            captainRiotId: primaryGameId,
            contactEmail,
            ...(persistedRetryLogo ? { teamLogoName: persistedRetryLogo.filename } : {}),
            status: "pending",
            paymentStatus: "pending",
            verificationStatus: "pending",
            rulebookAccepted,
            falsityWarningAccepted,
            additionalData: configuredEntryData,
            reservedUntil,
            assignedSlotNumber,
            quotedFeeAmount,
            quotedFeeCurrency,
          },
        });
        await tx.registrationMember.deleteMany({ where: { registrationId: existing.id } });
        await tx.registrationMember.createMany({
          data: persistedMembers.map((member) => ({
            id: crypto.randomUUID(),
            registrationId: existing.id,
            userId: member.role === "CAPTAIN" ? user.id : null,
            role: member.role,
            memberOrder: member.order,
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
            phone: member.phone || null,
            discord: member.discord,
            riotId: member.riotId,
            additionalData: member.additionalData || {},
            inviteStatus: member.role === "CAPTAIN" ? "accepted" : "pending",
            inviteRespondedAt: member.role === "CAPTAIN" ? new Date() : null,
          })),
        });
        if (tournament.entryType === "team") {
          retryInviteDispatches = await syncSavedTeamFromRegistration({
            tx,
            registrationId: existing.id,
            user,
            teamName: displayName,
            country,
            teamTag,
            organizationRequested: normalizeBoolean(body.organizationRequested),
            logoName: persistedRetryLogo?.filename || existing.teamLogoName || null,
            members: persistedMembers,
            tournamentTitle: currentTournament.title,
          });
        }
        await tx.paymentTransaction.updateMany({
          where: {
            registrationId: existing.id,
            status: { in: ["created", "pending", "review_required"] },
          },
          data: {
            status: "expired",
            statusMessage: "Superseded by a new payment reservation.",
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
        return { payment, registration, tournament: currentTournament };
      });
    } catch (error) {
      if (persistedRetryLogo) {
        await removeUploadsQuietly(
          [{ directory: teamLogoDirectory, filename: persistedRetryLogo.filename }],
          { operation: "retryConfiguredRegistrationRollback", registrationId: existing.id }
        );
      }
      throw error;
    }
    if (persistedRetryLogo && existing.teamLogoName && existing.teamLogoName !== persistedRetryLogo.filename) {
      await removeTeamLogoIfUnreferenced({
        prisma,
        filename: existing.teamLogoName,
        context: { operation: "retryConfiguredRegistration", registrationId: existing.id },
      });
    }
    await sendTeamInvites(retryInviteDispatches);
    await queueRegistrationReceivedEmail({
      registrationId: existing.id,
      email: user.email,
      recipientName: fullName,
      teamName: displayName,
      tournamentTitle: retried.tournament.title,
      pendingMemberCount: persistedMembers.filter((member) => member.role !== "CAPTAIN").length,
    });
    return {
      registration: mapRegistrationResult(retried.registration),
      paymentOrderId: retried.payment ? providerOrderId : null,
      checkout: retried.payment && paymentMethod === "payhere"
        ? buildCheckout({ payment: retried.payment, tournament: retried.tournament, user, body })
        : null,
      bankTransfer: retried.payment && paymentMethod === "bank_transfer"
        ? buildBankTransferInstructions({
            transaction: retried.payment,
            registration: retried.registration,
            tournament: retried.tournament,
          })
        : null,
      awaitingTeamVerification: false,
      readyForPayment: false,
      waitlisted: Boolean(retried.waitlisted),
    };
  }

  const persistedLogo = tournament.entryType === "team" ? await persistTeamLogoUpload(file) : null;
  const registrationId = crypto.randomUUID();
  const reservedUntil = feeAmount > 0 && !holdsPaymentForRoster
    ? new Date(Date.now() + tournament.reservationMinutes * 60 * 1000)
    : null;
  const providerOrderId = feeAmount > 0 && !holdsPaymentForRoster
    ? buildPaymentOrderId(paymentMethod)
    : null;
  let result;
  try {
    result = await runSerializable(async (tx) => {
      const currentTournament = await getCurrentTournamentForRegistration({
        tx,
        tournament,
        now: new Date(),
      });
      const transactionNow = new Date();
      await assertNoCoachPlayerRoleConflict({
        tx,
        tournamentId: currentTournament.id,
        members: persistedMembers,
      });
      const activeCount = await countTournamentCapacityUsage({
        tx,
        tournamentId: currentTournament.id,
        now: transactionNow,
      });
      const registrationState = getTournamentRegistrationState({
        tournament: currentTournament,
        capacityUsed: activeCount,
        now: transactionNow,
      });
      if (!registrationState.canRegister && !registrationState.canWaitlist) {
        throw new HttpError(409, "Registration slots are full.");
      }
      const isWaitlisted = registrationState.canWaitlist;
      const waitlistPosition = isWaitlisted
        ? await getNextWaitlistPosition({ tx, tournamentId: currentTournament.id })
        : null;

      const assignedSlotNumber = !isWaitlisted && paymentMethod === "bank_transfer" && !holdsPaymentForRoster
        ? await allocateLowestAvailableSlot({
            tx,
            tournamentId: currentTournament.id,
            maxTeams: currentTournament.maxTeams,
          })
        : null;
      const quotedFeeAmount = !isWaitlisted && paymentMethod === "bank_transfer" && !holdsPaymentForRoster
        ? getBankTransferAmountForSlot(currentTournament, assignedSlotNumber)
        : feeAmount;

      if (tournament.entryType === "team") {
        const duplicateTeam = await tx.teamRegistration.findFirst({
          where: {
            tournamentId: currentTournament.id,
            entryType: "team",
            teamName: displayName,
            ...buildActiveRegistrationWhere(),
          },
          select: { id: true },
        });
        if (duplicateTeam) {
          throw new HttpError(409, "A team with this name is already registered.");
        }
      }

      const registration = await tx.teamRegistration.create({
        data: {
          id: registrationId,
          tournamentId: currentTournament.id,
          userId: user.id,
          entryType: tournament.entryType,
          teamName: displayName,
          country,
          teamTag,
          organizationRequested: normalizeBoolean(body.organizationRequested),
          captainName: fullName,
          captainEmail: normalizeEmail(user.email),
          captainPhone: phone,
          captainDiscord: discord,
          captainRiotId: primaryGameId,
          contactEmail,
          teamLogoName: persistedLogo?.filename || null,
          status: isWaitlisted ? "waitlisted" : "pending",
          paymentStatus: isWaitlisted ? "unpaid" : feeAmount > 0
            ? holdsPaymentForRoster ? "unpaid" : "pending"
            : "paid",
          verificationStatus: persistedMembers.every((member) => member.role === "CAPTAIN")
            ? "verified"
            : "pending",
          rulebookAccepted,
          falsityWarningAccepted,
          additionalData: configuredEntryData,
          assignedSlotNumber,
          quotedFeeAmount: feeAmount > 0 && !holdsPaymentForRoster ? quotedFeeAmount : null,
          quotedFeeCurrency: feeAmount > 0 && !holdsPaymentForRoster
            ? currentTournament.registrationFeeCurrency
            : null,
          reservedUntil: isWaitlisted ? null : reservedUntil,
          waitlistPosition,
          publicReference: buildPublicReference(),
        },
      });
      await tx.registrationMember.createMany({
        data: persistedMembers.map((member) => ({
          id: crypto.randomUUID(),
          registrationId,
          userId: member.role === "CAPTAIN" ? user.id : null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email: member.email,
          emailNormalized: member.email,
          phone: member.phone || null,
          discord: member.discord,
          riotId: member.riotId,
          additionalData: member.additionalData || {},
          inviteStatus: member.role === "CAPTAIN" ? "accepted" : "pending",
          inviteRespondedAt: member.role === "CAPTAIN" ? new Date() : null,
        })),
      });

      // A free registration with a complete roster has nothing left to wait
      // on, so a tournament that does not review registrations approves it in
      // the same transaction that created it.
      const autoApproved = await maybeAutoApproveRegistration({
        tx,
        registrationId,
      });

      const payment = !isWaitlisted && feeAmount > 0 && !holdsPaymentForRoster
        ? await tx.paymentTransaction.create({
            data: {
              id: crypto.randomUUID(),
              purpose: "tournament_registration",
              provider: paymentMethod,
              providerOrderId,
              registrationId,
              amount: quotedFeeAmount,
              currency: currentTournament.registrationFeeCurrency,
              method: paymentMethod === "bank_transfer" ? "bank_transfer" : null,
            },
          })
        : null;
      return {
        registration: autoApproved || registration,
        payment,
        tournament: currentTournament,
        waitlisted: isWaitlisted,
      };
    });
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "createConfiguredRegistrationRollback", registrationId }
      );
    }
    throw error;
  }

  // Keep the slot-reservation transaction short. Saved-team synchronization has
  // its own retryable transaction and can be safely resumed for an existing draft.
  if (tournament.entryType === "team") {
    await ensureTeamRegistrationSaved(registrationId);
  }

  await queueRegistrationReceivedEmail({
    registrationId,
    email: user.email,
    recipientName: fullName,
    teamName: displayName,
    tournamentTitle: result.tournament.title,
    pendingMemberCount: persistedMembers.filter((member) => member.role !== "CAPTAIN").length,
  });

  return {
    registration: mapRegistrationResult(result.registration),
    paymentOrderId: providerOrderId,
    checkout: result.payment && paymentMethod === "payhere"
      ? buildCheckout({ payment: result.payment, tournament: result.tournament, user, body })
      : null,
    bankTransfer: result.payment && paymentMethod === "bank_transfer"
      ? buildBankTransferInstructions({
          transaction: result.payment,
          registration: result.registration,
          tournament: result.tournament,
        })
      : null,
    // Whether anyone still has to accept is a fact about the roster, so a free
    // event reports it too. Whether that unlocks a payment step is a separate
    // question, and a free event has no such step to unlock.
    awaitingTeamVerification: !result.waitlisted && requiresTeamVerification && persistedMembers.some(
      (member) => member.role !== "CAPTAIN"
    ),
    readyForPayment: !result.waitlisted && holdsPaymentForRoster && persistedMembers.every(
      (member) => member.role === "CAPTAIN"
    ),
    pendingInviteCount: requiresTeamVerification
      ? persistedMembers.filter(
          (member) => member.role !== "CAPTAIN"
        ).length
      : 0,
  };
};

const cancelUnpaidRegistration = async ({ slug, user }) => {
  const tournamentSlug = normalizeText(slug).toLowerCase();
  const registration = await prisma.teamRegistration.findFirst({
    where: {
      tournament: { slug: tournamentSlug },
      OR: [{ userId: user.id }, { captainEmail: normalizeEmail(user.email) }],
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
  if (!registration) throw new HttpError(404, "Tournament registration not found.");
  if (registration.payments?.[0]?.status === "expired") {
    throw new HttpError(
      409,
      "This expired registration must be reviewed by an administrator."
    );
  }
  if (registration.paymentStatus !== "unpaid") {
    throw new HttpError(
      409,
      "This registration cannot be cancelled after payment or a payment reservation has started. Contact an administrator for help."
    );
  }

  await prisma.teamRegistration.delete({ where: { id: registration.id } });
  if (registration.teamLogoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: registration.teamLogoName,
      context: { operation: "cancelUnpaidRegistration", registrationId: registration.id },
    });
  }
};

module.exports = {
  createConfiguredRegistration,
  cancelUnpaidRegistration,
  normalizeRegistrationSubmission,
  normalizeCoachSubmission,
  validateConfiguredFields,
  validateGameIdentities,
  buildPaymentOrderId,
};
