const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { sendDirectMessage, UNDELIVERABLE } = require("../../lib/discord/discord-dm");
const { invitationsPath } = require("./invite-paths");

// A Discord nudge pointing at an invitation that is already written down.
//
// This was once described as running alongside an invitation email, which was
// the guaranteed channel. There is no such email any more and no channel here
// is guaranteed: a bot can only DM someone who shares a server with it, plenty
// of people block DMs from server members, and someone who has never signed in
// to Quest has no Discord identity to find. None of that costs a roster spot,
// because the invitation is a row and `GET /api/me/invitations` will still be
// showing it when they sign in.

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

const buildInviteMessage = ({
  invitationId = null,
  recipientName,
  teamName,
  captainName,
  tournamentTitle,
}) => {
  const opening = recipientName ? `Hi ${recipientName},` : "Hi,";
  const event = tournamentTitle ? ` for **${tournamentTitle}**` : "";
  // The link goes to the invitations page rather than carrying the invite token:
  // a token in a DM is a credential sitting in a chat log, and the recipient is
  // already signed in to Quest to see it. The member reference on the end is
  // not a credential either — it only decides which invitation this account
  // already has gets scrolled to.
  const link = `${env.APP_URL || "https://questesports.lk"}${invitationsPath(invitationId)}`;
  return [
    opening,
    "",
    `**${captainName}** has invited you to join **${teamName}**${event} on Quest Esports.`,
    "",
    `Open your Quest invitations to accept: ${link}`,
  ].join("\n");
};

// Returns why it did or did not send, so callers can log an outcome rather than
// guessing. Never throws: an invitation must not fail because a DM did not.
const notifyInviteOnDiscord = async ({
  invitationId = null,
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
      content: buildInviteMessage({
        invitationId,
        recipientName,
        teamName,
        captainName,
        tournamentTitle,
      }),
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
