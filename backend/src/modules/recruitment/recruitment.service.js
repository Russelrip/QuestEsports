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
const {
  getLinkedDiscordForUsers,
  requireLinkedDiscord,
} = require("../auth/discord-link.service");

const APPLICATION_TYPES = new Set(["solo_player", "existing_team", "incomplete_team"]);
const MAX_MEMBERS = 20;
const GENDERS = new Set(["male", "female", "other"]);
const MEMBER_ROLES = new Set(["player", "substitute"]);
const PRIVACY_POLICY_VERSION = "2026-07-29";

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

const requiredBoolean = (value, label) => {
  if (value !== true) {
    throw new HttpError(400, `${label} is required.`);
  }
  return true;
};

const optionalBoolean = (value, label) => {
  if (value === true || value === false) return value;
  throw new HttpError(400, `${label} must be true or false.`);
};

const isExactCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const optionalHttpUrl = (value, label) => {
  const normalized = optionalText(value, 1000);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new HttpError(400, `${label} must be a valid HTTP or HTTPS link.`);
  }
};

const normalizeMembers = (members, applicationType) => {
  if (applicationType === "solo_player") {
    return [];
  }

  if (!Array.isArray(members) || members.length > MAX_MEMBERS) {
    throw new HttpError(400, `Team applications can include up to ${MAX_MEMBERS} members.`);
  }

  if (applicationType === "existing_team" && members.length < 4) {
    throw new HttpError(400, "Complete team applications must include at least four additional players.");
  }

  if (applicationType === "incomplete_team" && (members.length < 1 || members.length > 3)) {
    throw new HttpError(400, "Incomplete team applications must include between one and three additional players.");
  }

  return members.map((member, index) => {
    const email = normalizeEmail(member.email);
    if (!isValidEmail(email)) {
      throw new HttpError(400, `Team member ${index + 1} needs a valid email address.`);
    }

    const role = normalizeText(member.role).toLowerCase();
    return {
      name: requiredText(member.name, `Team member ${index + 1} name`),
      ign: requiredText(member.ign, `Team member ${index + 1} IGN`),
      idNumberCiphertext: encryptSecret(requiredText(member.nic, `Team member ${index + 1} NIC`)),
      // Resolved from the member's connected Discord account after
      // normalization. A handle the applicant typed for somebody else proves
      // nothing about who actually holds that account.
      discord: null,
      email,
      phone: requiredText(member.phone, `Team member ${index + 1} WhatsApp number`, 50),
      role: MEMBER_ROLES.has(role) ? role : "player",
      privacyAcceptedAt: requiredBoolean(
        member.privacyAccepted,
        `Team member ${index + 1} privacy permission`
      )
        ? new Date().toISOString()
        : null,
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

  if (
    (applicationType === "existing_team" &&
      (!currentRosterSize || currentRosterSize < 5 || currentRosterSize > 20)) ||
    (applicationType === "incomplete_team" &&
      (!currentRosterSize || currentRosterSize < 2 || currentRosterSize > 4))
  ) {
    throw new HttpError(
      400,
      applicationType === "existing_team"
        ? "Complete team roster size must be between 5 and 20."
        : "Incomplete team roster size must be between 2 and 4."
    );
  }

  const members = normalizeMembers(body.members, applicationType);
  const games = Array.isArray(body.games)
    ? body.games.map((game) => normalizeText(game)).filter(Boolean).slice(0, 20)
    : [];

  if (games.length === 0) {
    throw new HttpError(400, "Select at least one game.");
  }

  const gender = normalizeText(body.gender).toLowerCase();
  if (!GENDERS.has(gender)) {
    throw new HttpError(400, "Select a valid gender.");
  }

  const birthday = requiredText(body.birthday, "Birthday", 20);
  if (!isExactCalendarDate(birthday)) {
    throw new HttpError(400, "Birthday must be a valid date.");
  }

  const details = {
    ign: requiredText(body.ign, "In-game name"),
    birthday,
    gender,
    peakAndCurrentRank: requiredText(body.peakAndCurrentRank, "Peak rank, current rank and game"),
    tournamentExperience: optionalText(body.tournamentExperience),
    previouslyInOrganization: optionalBoolean(body.previouslyInOrganization, "Previous organization selection"),
    previousOrganization: optionalText(body.previousOrganization, 300),
    canAttendLan: optionalBoolean(body.canAttendLan, "LAN availability"),
    teamLogoUrl: optionalHttpUrl(body.teamLogoUrl, "Team logo"),
    additionalMembers: optionalText(body.additionalMembers),
    declarationAccepted: requiredBoolean(body.declarationAccepted, "Rules declaration"),
  };
  requiredBoolean(body.privacyAccepted, "Privacy Policy agreement");

  if (details.previouslyInOrganization && !details.previousOrganization) {
    throw new HttpError(400, "Previous organization or clan name is required.");
  }

  const applicant = await requireLinkedDiscord(
    user.id,
    "Connect your Discord account before applying."
  );
  const applicantDiscord = applicant.discordUsername || applicant.discordId;

  const memberAccounts = members.length > 0
    ? await prisma.user.findMany({
      where: {
        emailNormalized: {
          in: [...new Set(members.map((member) => normalizeEmail(member.email)))],
        },
      },
      select: { id: true, emailNormalized: true },
    })
    : [];
  const linkedByUserId = await getLinkedDiscordForUsers(
    memberAccounts.map((account) => account.id)
  );
  const handleByEmail = new Map(
    memberAccounts
      .map((account) => {
        const identity = linkedByUserId.get(account.id);
        return [
          account.emailNormalized,
          identity ? identity.discordUsername || identity.discordId : null,
        ];
      })
      .filter(([, handle]) => Boolean(handle))
  );
  const membersWithConnectedDiscord = members.map((member) => ({
    ...member,
    discord: handleByEmail.get(normalizeEmail(member.email)) || null,
  }));

  return prisma.recruitmentApplication.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      applicationType,
      fullName: requiredText(body.fullName, "Full name"),
      email: user.email,
      phone: requiredText(body.phone, "WhatsApp contact number", 50),
      discord: applicantDiscord,
      game: games.join(", "),
      playerId: null,
      applicantIdNumberCiphertext: encryptSecret(requiredText(body.nic, "NIC")),
      teamName: teamApplication ? requiredText(body.teamName, "Team name") : null,
      currentRosterSize,
      members: membersWithConnectedDiscord,
      details,
      notes: optionalText(body.notes),
      womensLeagueInterest: false,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      privacyAcceptedAt: new Date(),
    },
    select: {
      id: true,
      applicationType: true,
      status: true,
      createdAt: true,
    },
  });
};

module.exports = { createRecruitmentApplication, PRIVACY_POLICY_VERSION };
