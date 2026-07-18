const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
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
const { buildActiveRegistrationWhere, countTournamentCapacityUsage } = require("./registration-eligibility");
const {
  removeTeamLogoIfUnreferenced,
  removeUploadsQuietly,
} = require("../../lib/upload-cleanup");

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
  quotedFeeAmount: registration.quotedFeeAmount
    ? Number(registration.quotedFeeAmount)
    : null,
  quotedFeeCurrency: registration.quotedFeeCurrency,
  reservedUntil: registration.reservedUntil,
});

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
    // Short enough to type into a banking app, with 40 bits of randomness.
    return `QST-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  }
  return `TOUR-${crypto.randomUUID()}`;
};

const allocateLowestAvailableSlot = async ({ tx, tournamentId, maxTeams, excludeId }) => {
  const activeRegistrations = await tx.teamRegistration.findMany({
    where: {
      tournamentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      assignedSlotNumber: { not: null },
      ...buildActiveRegistrationWhere(),
    },
    select: { assignedSlotNumber: true },
  });
  const usedSlots = new Set(activeRegistrations.map((entry) => entry.assignedSlotNumber));
  for (let slotNumber = 1; slotNumber <= maxTeams; slotNumber += 1) {
    if (!usedSlots.has(slotNumber)) return slotNumber;
  }
  throw new HttpError(409, "Registration slots are full.");
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
    });
    if (!currentRegistration || currentRegistration.paymentStatus === "paid") {
      throw new HttpError(409, "This tournament registration is already paid.");
    }
    if (currentRegistration.status === "rejected") {
      throw new HttpError(409, "This tournament registration was rejected and cannot continue to payment.");
    }
    if (
      currentRegistration.entryType === "team" &&
      currentRegistration.verificationStatus !== "verified"
    ) {
      throw new HttpError(
        409,
        currentRegistration.verificationStatus === "flagged"
          ? "A roster invitation was declined. Update the team before continuing to payment."
          : "Every roster member must accept the team invitation before payment."
      );
    }

    const currentTournament = await getCurrentTournamentForRegistration({
      tx,
      tournament,
      now: new Date(),
      allowActivePaymentReservation:
        currentRegistration.paymentStatus === "unpaid" &&
        currentRegistration.verificationStatus === "verified",
    });
    const activeCount = await countTournamentCapacityUsage({ tx, tournamentId: currentTournament.id, excludeRegistrationId: existing.id });
    if (activeCount >= currentTournament.maxTeams) {
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
    const assignedSlotNumber = paymentMethod === "bank_transfer"
      ? await allocateLowestAvailableSlot({
          tx,
          tournamentId: currentTournament.id,
          maxTeams: currentTournament.maxTeams,
          excludeId: existing.id,
        })
      : null;
    const quotedFeeAmount = paymentMethod === "bank_transfer"
      ? getBankTransferAmountForSlot(currentTournament, assignedSlotNumber)
      : feeAmount;
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
        reservedUntil,
        assignedSlotNumber,
        quotedFeeAmount,
        quotedFeeCurrency: currentTournament.registrationFeeCurrency,
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
        currency: currentTournament.registrationFeeCurrency,
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
  if (
    !tournament?.isPublished ||
    tournament.status !== "registration_open" ||
    (tournament.registrationOpenAt && tournament.registrationOpenAt > now) ||
    (tournament.registrationDeadline && tournament.registrationDeadline < now)
  ) {
    throw new HttpError(statusCode, "Registration is closed for this tournament.");
  }
};

const getCurrentTournamentForRegistration = async ({
  tx,
  tournament,
  now,
  allowActivePaymentReservation = false,
}) => {
  const current = await tx.tournament.findUnique({ where: { id: tournament.id } });
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

const normalizeRegistrationSubmission = ({ tournament, body, user }) => {
  const fullName = normalizeText(body.fullName || body.captainName) ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const displayName = tournament.entryType === "solo"
    ? fullName
    : normalizeText(body.teamName);
  const phone = normalizeText(body.phone || body.captainPhone || user.phone);
  const discord = normalizeText(body.discord || body.captainDiscord || user.discordTag) || "N/A";
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
  let requestedMembers = parseJson(body.members, [], "Roster members");
  if (!Array.isArray(requestedMembers)) throw new HttpError(400, "Roster members must be a list.");

  if (!displayName || !fullName || !phone || !isValidEmail(contactEmail) || !rulebookAccepted || !falsityWarningAccepted) {
    throw new HttpError(400, "Complete the required registration details and agreements.");
  }
  if (
    displayName.length > 100 ||
    fullName.length > 100 ||
    phone.length > 50 ||
    discord.length > 100 ||
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
    discord: normalizeText(member.discord) || null,
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
    (member.discord && member.discord.length > 100) ||
    (member.riotId && member.riotId.length > 100)
  )) {
    throw new HttpError(400, "One or more roster fields exceed the allowed length.");
  }
  const playerCount = 1 + normalizedMembers.filter((member) => member.role === "PLAYER").length;
  const substituteCount = normalizedMembers.filter((member) => member.role === "SUBSTITUTE").length;
  if (playerCount < tournament.minRosterSize || playerCount > tournament.maxRosterSize || substituteCount > tournament.maxSubstitutes) {
    throw new HttpError(400, `This event requires ${tournament.minRosterSize}-${tournament.maxRosterSize} players and allows up to ${tournament.maxSubstitutes} substitutes.`);
  }
  const emails = [normalizeEmail(user.email), ...normalizedMembers.map((member) => member.email)];
  if (new Set(emails).size !== emails.length) throw new HttpError(400, "Roster emails must be unique.");

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
      },
    })
  );
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const now = new Date();

  const feeAmount = Number(tournament.registrationFeeAmount || 0);
  const paymentMethod = feeAmount > 0 ? tournament.paymentMethod || "payhere" : "free";
  const requiresTeamVerification = tournament.entryType === "team" && feeAmount > 0;
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
          select: { inviteStatus: true },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { bankTransferProof: true },
        },
      },
    })
  );
  if (existing) {
    if (existing.paymentStatus === "paid" || feeAmount === 0) {
      throw new HttpError(409, "You are already registered for this tournament.");
    }
    const latestPayment = existing.payments[0];
    const existingMembers = existing.members || [];
    const effectiveVerificationStatus = existingMembers.some(
      (member) => member.inviteStatus === "declined"
    )
      ? "flagged"
      : existingMembers.length > 0 && existingMembers.every(
          (member) => member.inviteStatus === "accepted"
        )
        ? "verified"
        : existing.verificationStatus;
    const pendingInviteCount = existingMembers.filter(
      (member) => member.inviteStatus === "pending"
    ).length;

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

  const hasActivePaymentReservation =
    existing?.paymentStatus === "pending" &&
    existing.reservedUntil &&
    existing.reservedUntil > now;
  if (!hasActivePaymentReservation) {
    assertRegistrationStillOpen(tournament, now);
  }

  const submission = normalizeRegistrationSubmission({ tournament, body, user });
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
  } = submission;

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
        const activeCount = await countTournamentCapacityUsage({ tx, tournamentId: currentTournament.id, excludeRegistrationId: existing.id });
        if (activeCount >= currentTournament.maxTeams) throw new HttpError(409, "Registration slots are full.");
        const assignedSlotNumber = paymentMethod === "bank_transfer"
          ? await allocateLowestAvailableSlot({
              tx,
              tournamentId: currentTournament.id,
              maxTeams: currentTournament.maxTeams,
              excludeId: existing.id,
            })
          : null;
        const quotedFeeAmount = paymentMethod === "bank_transfer"
          ? getBankTransferAmountForSlot(currentTournament, assignedSlotNumber)
          : feeAmount;
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
            quotedFeeCurrency: currentTournament.registrationFeeCurrency,
          },
        });
        await tx.registrationMember.deleteMany({ where: { registrationId: existing.id } });
        await tx.registrationMember.createMany({
          data: members.map((member) => ({
            id: crypto.randomUUID(),
            registrationId: existing.id,
            userId: member.role === "CAPTAIN" ? user.id : null,
            role: member.role,
            memberOrder: member.order,
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
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
            members,
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
            currency: currentTournament.registrationFeeCurrency,
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
    return {
      registration: mapRegistrationResult(retried.registration),
      paymentOrderId: providerOrderId,
      checkout: paymentMethod === "payhere"
        ? buildCheckout({ payment: retried.payment, tournament: retried.tournament, user, body })
        : null,
      bankTransfer: paymentMethod === "bank_transfer"
        ? buildBankTransferInstructions({
            transaction: retried.payment,
            registration: retried.registration,
            tournament: retried.tournament,
          })
        : null,
    };
  }

  const persistedLogo = tournament.entryType === "team" ? await persistTeamLogoUpload(file) : null;
  const registrationId = crypto.randomUUID();
  const reservedUntil = feeAmount > 0 && !requiresTeamVerification
    ? new Date(Date.now() + tournament.reservationMinutes * 60 * 1000)
    : null;
  const providerOrderId = feeAmount > 0 && !requiresTeamVerification
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
      const activeCount = await countTournamentCapacityUsage({ tx, tournamentId: currentTournament.id });
      if (activeCount >= currentTournament.maxTeams) throw new HttpError(409, "Registration slots are full.");

      const assignedSlotNumber = paymentMethod === "bank_transfer" && !requiresTeamVerification
        ? await allocateLowestAvailableSlot({
            tx,
            tournamentId: currentTournament.id,
            maxTeams: currentTournament.maxTeams,
          })
        : null;
      const quotedFeeAmount = paymentMethod === "bank_transfer" && !requiresTeamVerification
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
          paymentStatus: feeAmount > 0
            ? requiresTeamVerification ? "unpaid" : "pending"
            : "paid",
          rulebookAccepted,
          falsityWarningAccepted,
          additionalData: configuredEntryData,
          assignedSlotNumber,
          quotedFeeAmount: feeAmount > 0 && !requiresTeamVerification ? quotedFeeAmount : null,
          quotedFeeCurrency: feeAmount > 0 && !requiresTeamVerification
            ? currentTournament.registrationFeeCurrency
            : null,
          reservedUntil,
        },
      });
      await tx.registrationMember.createMany({
        data: members.map((member) => ({
          id: crypto.randomUUID(),
          registrationId,
          userId: member.role === "CAPTAIN" ? user.id : null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email: member.email,
          emailNormalized: member.email,
          discord: member.discord,
          riotId: member.riotId,
          additionalData: member.additionalData || {},
          inviteStatus: member.role === "CAPTAIN" ? "accepted" : "pending",
          inviteRespondedAt: member.role === "CAPTAIN" ? new Date() : null,
        })),
      });

      const payment = feeAmount > 0 && !requiresTeamVerification
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
      return { registration, payment, tournament: currentTournament };
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
    awaitingTeamVerification: requiresTeamVerification && members.some(
      (member) => member.role !== "CAPTAIN"
    ),
    readyForPayment: requiresTeamVerification && members.every(
      (member) => member.role === "CAPTAIN"
    ),
    pendingInviteCount: requiresTeamVerification
      ? members.filter((member) => member.role !== "CAPTAIN").length
      : 0,
  };
};

module.exports = {
  createConfiguredRegistration,
  validateConfiguredFields,
  validateGameIdentities,
  buildPaymentOrderId,
};
