const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { encryptSecret } = require("../../lib/secret-box");
const {
  isValidEmail,
  normalizeEmail,
  normalizeInteger,
  normalizeText,
} = require("../../lib/validation");

const APPLICATION_TYPES = new Set(["solo_player", "existing_team", "incomplete_team"]);
const MAX_MEMBERS = 10;

const requiredText = (value, label, maxLength = 200) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new HttpError(400, `${label} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return normalized;
};

const optionalText = (value, maxLength = 2000) => {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : null;
};

const normalizeMembers = (members, applicationType) => {
  if (applicationType === "solo_player") {
    return [];
  }

  if (!Array.isArray(members) || members.length > MAX_MEMBERS) {
    throw new HttpError(400, `Team applications can include up to ${MAX_MEMBERS} members.`);
  }

  return members.map((member, index) => {
    const email = normalizeEmail(member.email);
    if (!isValidEmail(email)) {
      throw new HttpError(400, `Team member ${index + 1} needs a valid email address.`);
    }

    return {
      name: requiredText(member.name, `Team member ${index + 1} name`),
      email,
      discord: requiredText(member.discord, `Team member ${index + 1} Discord username`),
      playerId: requiredText(member.playerId, `Team member ${index + 1} player ID`),
      idNumberCiphertext: encryptSecret(
        requiredText(member.idNumber, `Team member ${index + 1} ID number`)
      ),
    };
  });
};

const createRecruitmentApplication = async ({ body, user }) => {
  const applicationType = normalizeText(body.applicationType);

  if (!APPLICATION_TYPES.has(applicationType)) {
    throw new HttpError(400, "Select a valid recruitment type.");
  }

  const teamApplication = applicationType !== "solo_player";
  const currentRosterSize = teamApplication
    ? normalizeInteger(body.currentRosterSize)
    : null;

  if (teamApplication && (!currentRosterSize || currentRosterSize < 1 || currentRosterSize > 20)) {
    throw new HttpError(400, "Current roster size must be between 1 and 20.");
  }

  const members = normalizeMembers(body.members, applicationType);

  return prisma.recruitmentApplication.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      applicationType,
      fullName: requiredText(body.fullName, "Full name"),
      email: user.email,
      phone: requiredText(body.phone, "WhatsApp contact number"),
      discord: requiredText(body.discord, "Discord username"),
      game: requiredText(body.game, "Primary game"),
      playerId: requiredText(body.playerId, "In-game player ID"),
      applicantIdNumberCiphertext: encryptSecret(
        requiredText(body.idNumber, "ID number")
      ),
      teamName: teamApplication ? requiredText(body.teamName, "Team name") : null,
      currentRosterSize,
      members,
      notes: optionalText(body.notes),
      womensLeagueInterest: Boolean(body.womensLeagueInterest),
    },
    select: {
      id: true,
      applicationType: true,
      status: true,
      createdAt: true,
    },
  });
};

module.exports = { createRecruitmentApplication };
