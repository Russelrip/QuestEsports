const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeEmail,
  normalizeText,
  isValidEmail,
} = require("../../lib/validation");

const normalizeBooleanFlag = (value) => value === true || value === "true";

const requiredPlayerIndexes = [2, 3, 4, 5];

const buildRequiredPlayers = (body) =>
  requiredPlayerIndexes.map((index) => ({
    order: index - 1,
    name: normalizeText(body[`player${index}Name`]),
    discord: normalizeText(body[`player${index}Discord`]),
    riotId: normalizeText(body[`player${index}RiotId`]),
  }));

const buildOptionalMembers = (body) => {
  const substitutes = [1, 2]
    .map((index) => ({
      role: "SUBSTITUTE",
      order: index,
      name: normalizeText(body[`sub${index}Name`]),
      discord: normalizeText(body[`sub${index}Discord`]) || null,
      riotId: normalizeText(body[`sub${index}RiotId`]) || null,
    }))
    .filter((member) => member.name);

  const coachName = normalizeText(body.coachName);
  const coach = coachName
    ? [
        {
          role: "COACH",
          order: 1,
          name: coachName,
          discord: normalizeText(body.coachDiscord) || null,
          riotId: normalizeText(body.coachRiotId) || null,
        },
      ]
    : [];

  return [...substitutes, ...coach];
};

const getTournamentRegistrationStatus = async ({ slug, user }) => {
  const tournamentSlug = normalizeText(slug);

  if (!tournamentSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug: tournamentSlug },
    select: { id: true },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  if (!user?.email) {
    return { isRegistered: false };
  }

  const existingRegistration = await prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      captainEmail: normalizeEmail(user.email),
    },
    select: { id: true },
  });

  return { isRegistered: Boolean(existingRegistration) };
};

const createTournamentRegistration = async ({ body, file }) => {
  const tournamentSlug = normalizeText(body.tournament);
  const teamName = normalizeText(body.teamName);
  const captainName = normalizeText(body.captainName);
  const captainEmail = normalizeEmail(body.captainEmail);
  const captainPhone = normalizeText(body.captainPhone);
  const captainDiscord = normalizeText(body.captainDiscord);
  const captainRiotId = normalizeText(body.captainRiotId);
  const contactEmail = normalizeEmail(body.contactEmail);
  const rulebookAccepted = normalizeBooleanFlag(body.rulebook);
  const falsityWarningAccepted = normalizeBooleanFlag(body.falsityWarning);
  const requiredPlayers = buildRequiredPlayers(body);
  const optionalMembers = buildOptionalMembers(body);

  if (
    !tournamentSlug ||
    !teamName ||
    !captainName ||
    !captainPhone ||
    !captainDiscord ||
    !captainRiotId ||
    !isValidEmail(captainEmail) ||
    !isValidEmail(contactEmail) ||
    !rulebookAccepted ||
    !falsityWarningAccepted ||
    requiredPlayers.some((player) => !player.name || !player.discord || !player.riotId)
  ) {
    throw new HttpError(
      400,
      "Please fill all required fields and accept the agreements."
    );
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug: tournamentSlug },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!tournament || !tournament.isActive) {
    throw new HttpError(400, "Selected tournament is not available.");
  }

  const existingRegistration = await prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      OR: [{ teamName }, { captainEmail }],
    },
    select: { id: true },
  });

  if (existingRegistration) {
    throw new HttpError(
      400,
      "This team or captain email is already registered for the selected tournament."
    );
  }

  const members = [
    {
      role: "CAPTAIN",
      order: 1,
      name: captainName,
      discord: captainDiscord,
      riotId: captainRiotId,
    },
    ...requiredPlayers.map((player) => ({
      role: "PLAYER",
      ...player,
    })),
    ...optionalMembers,
  ];

  const registrationId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.teamRegistration.create({
      data: {
        id: registrationId,
        tournamentId: tournament.id,
        teamName,
        captainName,
        captainEmail,
        captainPhone,
        captainDiscord,
        captainRiotId,
        contactEmail,
        teamLogoName: file ? file.filename : null,
        rulebookAccepted,
        falsityWarningAccepted,
      },
    });

    await tx.registrationMember.createMany({
      data: members.map((member) => ({
        id: crypto.randomUUID(),
        registrationId,
        role: member.role,
        memberOrder: member.order,
        name: member.name,
        discord: member.discord,
        riotId: member.riotId,
      })),
    });
  });
};

module.exports = {
  getTournamentRegistrationStatus,
  createTournamentRegistration,
};
