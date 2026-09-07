const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");

// Discord is the operational channel for match communication, so a handle is
// only worth anything if it proves the person controls the account. That proof
// is `OAuthAccount`, never `User.discordTag` — the tag is display text a
// profile edit can set, and as the profile-update comment already puts it, an
// identity field anyone can retype is not an identity.
//
// This module is the single place that answers "what is this user's Discord?".
// Before it existed the answer was spelled three different ways across
// registration, recruitment and the leaderboard, and only one of them checked
// the OAuth record.
const DISCORD_LINK_REQUIRED = "DISCORD_LINK_REQUIRED";

const DEFAULT_LINK_REQUIRED_MESSAGE =
  "Connect your Discord account before continuing.";

const createDiscordLinkRequiredError = (
  message = DEFAULT_LINK_REQUIRED_MESSAGE
) => {
  const error = new HttpError(403, message);
  error.code = DISCORD_LINK_REQUIRED;
  return error;
};

const normalizeUserId = (userId) => String(userId || "").trim();

// The username is a cached display snapshot in exactly the sense
// `DiscordIdentity` documents: the snowflake is the identity, the name is what
// a human reads on it. Callers that persist a roster row want both.
const toIdentity = (account) => ({
  discordId: account.providerUserId,
  discordUsername: account.user?.discordTag || "",
});

const getLinkedDiscord = async (userId) => {
  const normalizedUserId = normalizeUserId(userId);

  if (!normalizedUserId) {
    return null;
  }

  const account = await prisma.oAuthAccount.findFirst({
    where: { userId: normalizedUserId, provider: "discord" },
    select: {
      providerUserId: true,
      user: { select: { discordTag: true } },
    },
  });

  return account ? toIdentity(account) : null;
};

const requireLinkedDiscord = async (userId, message) => {
  const identity = await getLinkedDiscord(userId);

  if (!identity) {
    throw createDiscordLinkRequiredError(message);
  }

  return identity;
};

// Roster resolution reads one row per member. Doing that member by member
// turned a ten-person roster into ten round trips, so callers hand over every
// user id at once and get a Map back. Ids with no link are simply absent —
// a roster member without a Quest account is a normal case, not an error, and
// only `discordRequired` decides whether it blocks registration.
const getLinkedDiscordForUsers = async (userIds) => {
  const normalizedUserIds = [
    ...new Set((userIds || []).map(normalizeUserId).filter(Boolean)),
  ];

  if (normalizedUserIds.length === 0) {
    return new Map();
  }

  const accounts = await prisma.oAuthAccount.findMany({
    where: { userId: { in: normalizedUserIds }, provider: "discord" },
    select: {
      userId: true,
      providerUserId: true,
      user: { select: { discordTag: true } },
    },
  });

  return new Map(
    accounts.map((account) => [account.userId, toIdentity(account)])
  );
};

module.exports = {
  DISCORD_LINK_REQUIRED,
  createDiscordLinkRequiredError,
  getLinkedDiscord,
  requireLinkedDiscord,
  getLinkedDiscordForUsers,
};
