const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { sendDirectMessage, UNDELIVERABLE } = require("../../lib/discord/discord-dm");

// A Discord nudge alongside the invitation email — never instead of it.
//
// Email stays the guaranteed channel because a bot can only DM someone who
// shares a server with it, and plenty of people block DMs from server members.
// Someone invited by email who has never signed in has no Discord identity at
// all. So this improves the common case and changes nothing about the
// guarantee: the email is sent regardless, and the invitation is always
// visible in Quest under `GET /api/me/invitations`.

// Discord identity comes from the OAuth link, never from `User.discordTag`,
// which is display text. A DM needs the stable account id.
const findRecipientDiscordId = async ({ userId, emailNormalized }) => {
  if (userId) {
    const account = await prisma.oAuthAccount.findFirst({
      where: { userId, provider: "discord" },
      select: { providerUserId: true },
    });
    if (account?.providerUserId) return account.providerUserId;
  }

  // An invitee who has a Quest account but was invited by email address: match
  // only on a VERIFIED address, or an unverified signup could redirect someone
  // else's invitation notice.
  if (emailNormalized) {
    const user = await prisma.user.findFirst({
      where: { emailNormalized, emailVerified: true },
      select: { oauthAccounts: { where: { provider: "discord" }, select: { providerUserId: true } } },
    });
    return user?.oauthAccounts?.[0]?.providerUserId ?? null;
  }

  return null;
};

const buildInviteMessage = ({ recipientName, teamName, captainName, tournamentTitle }) => {
  const opening = recipientName ? `Hi ${recipientName},` : "Hi,";
  const event = tournamentTitle ? ` for **${tournamentTitle}**` : "";
  // The link goes to the invitations page rather than carrying the invite token:
  // a token in a DM is a credential sitting in a chat log, and the recipient is
  // already signed in to Quest to see it.
  const link = `${env.APP_URL || "https://questesports.lk"}/profile`;
  return [
    opening,
    "",
    `**${captainName}** has invited you to join **${teamName}**${event} on Quest Esports.`,
    "",
    `Open your Quest profile to accept: ${link}`,
    "",
    "_You will also have received this by email._",
  ].join("\n");
};

// Returns why it did or did not send, so callers can log an outcome rather than
// guessing. Never throws: an invitation must not fail because a DM did not.
const notifyInviteOnDiscord = async ({
  userId = null,
  emailNormalized = null,
  recipientName,
  teamName,
  captainName,
  tournamentTitle = null,
}) => {
  try {
    const discordUserId = await findRecipientDiscordId({ userId, emailNormalized });
    if (!discordUserId) {
      return { delivered: false, reason: UNDELIVERABLE.NO_DISCORD_ACCOUNT };
    }

    return await sendDirectMessage({
      discordUserId,
      content: buildInviteMessage({ recipientName, teamName, captainName, tournamentTitle }),
    });
  } catch (error) {
    logger.info("Discord invite notice could not be attempted.", {
      name: error?.name || null,
    });
    return { delivered: false, reason: UNDELIVERABLE.FAILED };
  }
};

module.exports = {
  notifyInviteOnDiscord,
  buildInviteMessage,
  findRecipientDiscordId,
};
