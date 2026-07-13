const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { isValidEmail, normalizeEmail, normalizeText } = require("../../lib/validation");
const { persistTeamLogoUpload, removeUploadFile, teamLogoDirectory } = require("../../middleware/upload");
const { syncSavedTeamFromRegistration, sendTeamInvites } = require("../teams/team.service");
const { assertPayHereConfigured, createPayHereCheckout } = require("../payments/payment.service");
const { buildActiveRegistrationWhere } = require("./registration-eligibility");

const normalizeBoolean = (value) => [true, "true", "1", "on"].includes(value);
const runSerializable = async (work) => {
  let attempt = 0;
  while (attempt < 3) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      attempt += 1;
      if (error?.code !== "P2034" || attempt >= 3) throw error;
    }
  }
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

const mapRegistrationResult = (registration) => ({
  id: registration.id,
  entryType: registration.entryType,
  displayName:
    registration.entryType === "solo"
      ? registration.captainName || registration.teamName
      : registration.teamName,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
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

const createConfiguredRegistration = async ({ slug, body, file, user }) => {
  const submittedSlug = normalizeText(body.tournamentSlug || body.tournament);
  if (submittedSlug && submittedSlug !== slug) {
    throw new HttpError(400, "Tournament registration route and payload do not match.");
  }
  const tournament = await prisma.tournament.findFirst({
    where: { slug, isPublished: true },
    include: {
      _count: { select: { teamRegistrations: true } },
    },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const now = new Date();
  if (
    tournament.status !== "registration_open" ||
    (tournament.registrationOpenAt && tournament.registrationOpenAt > now) ||
    (tournament.registrationDeadline && tournament.registrationDeadline < now)
  ) {
    throw new HttpError(400, "Registration is closed for this tournament.");
  }

  const feeAmount = Number(tournament.registrationFeeAmount || 0);
  if (feeAmount > 0) assertPayHereConfigured();

  const existing = await prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      OR: [
        { userId: user.id },
        { captainEmail: normalizeEmail(user.email) },
      ],
    },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existing) {
    if (existing.paymentStatus === "paid" || feeAmount === 0) {
      throw new HttpError(409, "You are already registered for this tournament.");
    }
    const providerOrderId = `TOUR-${crypto.randomUUID()}`;
    const reservedUntil = new Date(Date.now() + tournament.reservationMinutes * 60 * 1000);
    const payment = await runSerializable(async (tx) => {
      const activeCount = await tx.teamRegistration.count({
        where: {
          id: { not: existing.id },
          tournamentId: tournament.id,
          ...buildActiveRegistrationWhere(),
        },
      });
      if (activeCount >= tournament.maxTeams) throw new HttpError(409, "Registration slots are full.");
      await tx.teamRegistration.update({
        where: { id: existing.id },
        data: { userId: user.id, paymentStatus: "pending", reservedUntil },
      });
      await tx.paymentTransaction.updateMany({
        where: {
          registrationId: existing.id,
          status: { in: ["created", "pending"] },
        },
        data: { status: "expired" },
      });
      return tx.paymentTransaction.create({
        data: {
          id: crypto.randomUUID(),
          purpose: "tournament_registration",
          providerOrderId,
          registrationId: existing.id,
          amount: tournament.registrationFeeAmount,
          currency: tournament.registrationFeeCurrency,
        },
      });
    });
    return {
      registration: mapRegistrationResult({ ...existing, paymentStatus: "pending", reservedUntil }),
      paymentOrderId: providerOrderId,
      checkout: buildCheckout({ payment, tournament, user, body }),
    };
  }

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

  if (tournament.entryType === "solo") requestedMembers = [];
  const normalizedMembers = requestedMembers.map((member, index) => ({
    role: normalizeText(member.role).toUpperCase() === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER",
    order: index + 1,
    name: normalizeText(member.name),
    email: normalizeEmail(member.email),
    discord: normalizeText(member.discord) || null,
    riotId: normalizeText(member.gameId || member.riotId) || null,
    additionalData: member.additionalData || {},
  }));
  if (normalizedMembers.some((member) => !member.name || !isValidEmail(member.email))) {
    throw new HttpError(400, "Every roster member needs a name and valid email.");
  }
  const playerCount = 1 + normalizedMembers.filter((member) => member.role === "PLAYER").length;
  const substituteCount = normalizedMembers.filter((member) => member.role === "SUBSTITUTE").length;
  if (playerCount < tournament.minRosterSize || playerCount > tournament.maxRosterSize || substituteCount > tournament.maxSubstitutes) {
    throw new HttpError(400, `This event requires ${tournament.minRosterSize}-${tournament.maxRosterSize} players and allows up to ${tournament.maxSubstitutes} substitutes.`);
  }
  const emails = [normalizeEmail(user.email), ...normalizedMembers.map((member) => member.email)];
  if (new Set(emails).size !== emails.length) throw new HttpError(400, "Roster emails must be unique.");

  const configured = validateConfiguredFields({
    definitions: Array.isArray(tournament.registrationFields) ? tournament.registrationFields : [],
    entryData: additionalData,
    members: [
      {
        role: "CAPTAIN",
        order: 0,
        name: fullName,
        email: normalizeEmail(user.email),
        discord,
        riotId: normalizeText(body.gameId || body.captainRiotId) || null,
        additionalData: captainAdditionalData,
      },
      ...normalizedMembers,
    ],
  });
  const [configuredCaptain, ...configuredRosterMembers] = configured.members;
  const primaryGameId = normalizeText(body.gameId || body.captainRiotId) ||
    Object.values(configured.entryData).find(Boolean) || "N/A";
  const members = [
    {
      ...configuredCaptain,
      riotId: primaryGameId,
    },
    ...configuredRosterMembers,
  ];
  const persistedLogo = tournament.entryType === "team" ? await persistTeamLogoUpload(file) : null;
  const registrationId = crypto.randomUUID();
  const reservedUntil = feeAmount > 0
    ? new Date(Date.now() + tournament.reservationMinutes * 60 * 1000)
    : null;
  const providerOrderId = feeAmount > 0 ? `TOUR-${crypto.randomUUID()}` : null;
  let inviteDispatches = [];

  try {
    const result = await runSerializable(async (tx) => {
      const activeCount = await tx.teamRegistration.count({
        where: {
          tournamentId: tournament.id,
          ...buildActiveRegistrationWhere(),
        },
      });
      if (activeCount >= tournament.maxTeams) throw new HttpError(409, "Registration slots are full.");

      if (tournament.entryType === "team") {
        const duplicateTeam = await tx.teamRegistration.findFirst({
          where: {
            tournamentId: tournament.id,
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
          tournamentId: tournament.id,
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
          paymentStatus: feeAmount > 0 ? "pending" : "paid",
          rulebookAccepted,
          falsityWarningAccepted,
          additionalData: configured.entryData,
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

      if (tournament.entryType === "team" && feeAmount === 0) {
        inviteDispatches = await syncSavedTeamFromRegistration({
          tx,
          registrationId,
          user,
          teamName: displayName,
          country,
          teamTag,
          organizationRequested: normalizeBoolean(body.organizationRequested),
          logoName: persistedLogo?.filename || null,
          members,
          tournamentTitle: tournament.title,
        });
      }

      const payment = feeAmount > 0
        ? await tx.paymentTransaction.create({
            data: {
              id: crypto.randomUUID(),
              purpose: "tournament_registration",
              providerOrderId,
              registrationId,
              amount: tournament.registrationFeeAmount,
              currency: tournament.registrationFeeCurrency,
            },
          })
        : null;
      return { registration, payment };
    });

    await sendTeamInvites(inviteDispatches);
    return {
      registration: mapRegistrationResult(result.registration),
      paymentOrderId: providerOrderId,
      checkout: result.payment ? buildCheckout({ payment: result.payment, tournament, user, body }) : null,
    };
  } catch (error) {
    if (persistedLogo) {
      await removeUploadFile({ directory: teamLogoDirectory, filename: persistedLogo.filename }).catch(() => undefined);
    }
    throw error;
  }
};

module.exports = { createConfiguredRegistration, validateConfiguredFields };
