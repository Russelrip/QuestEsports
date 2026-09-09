const { prisma } = require("../../lib/prisma");
const { logger } = require("../../lib/logger");
const { createNotification } = require("../notifications/notification.service");
const { notifyInviteOnDiscord } = require("./invite-discord-notice");
const { INVITATIONS_PATH, buildInvitationUrl } = require("./invite-paths");

// How a roster invitation reaches the person it is for.
//
// It used to be an email carrying a token, which made the invitation only as
// durable as the delivery and put a credential in someone's inbox. The
// invitation itself is now the durable thing — a row the invitee finds by
// signing in — so what is left to do here is tell them it is waiting, over
// channels that cost nothing and can fail without consequence.
//
// Nothing here is load-bearing. Every channel is best effort, and a captain who
// can see that none of them reached someone can send the link themselves, which
// is usually the channel that actually works: they are teammates, and they were
// already talking somewhere.


// An invitation reaches a Quest account by user link, or by an address the
// account has proven it controls. An unverified address is never matched:
// signing up with someone else's address would otherwise hand over their
// invitations.
const findQuestUserForInvite = async ({ userId, emailNormalized }) => {
  if (userId) {
    const byId = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (byId) return byId.id;
  }

  if (emailNormalized) {
    const byEmail = await prisma.user.findFirst({
      where: { emailNormalized, emailVerified: true },
      select: { id: true },
    });
    if (byEmail) return byEmail.id;
  }

  return null;
};

const buildTitle = ({ teamName }) => `Invitation to join ${teamName}`;

const buildBody = ({ captainName, teamName, tournamentTitle }) => {
  const event = tournamentTitle ? ` for ${tournamentTitle}` : "";
  return `${captainName} invited you to join ${teamName}${event}. Open your invitations to accept.`;
};

// Returns what each channel actually did, so a captain is told the truth rather
// than "invitation sent" over a channel that reached nobody.
const notifyInvite = async ({
  invitationId,
  userId = null,
  emailNormalized = null,
  recipientName,
  teamName,
  captainName,
  tournamentTitle = null,
  sentAt = new Date(),
}) => {
  const questUserId = await findQuestUserForInvite({ userId, emailNormalized });

  let inApp = false;
  if (questUserId) {
    try {
      // The invitation id and the moment it was sent: a captain who nudges
      // again should produce a new notification rather than collide silently
      // with the first one.
      await createNotification({
        eventKey: `team-invite:${invitationId}:${sentAt.toISOString()}`,
        type: "team_invite",
        title: buildTitle({ teamName }),
        body: buildBody({ captainName, teamName, tournamentTitle }),
        actionUrl: INVITATIONS_PATH,
        userIds: [questUserId],
      });
      inApp = true;
    } catch (error) {
      logger.warn("In-app invite notification failed.", {
        invitationId,
        error,
      });
    }
  }

  const discordResult = await notifyInviteOnDiscord({
    userId: questUserId,
    emailNormalized,
    recipientName,
    teamName,
    captainName,
    tournamentTitle,
  });

  return {
    inApp,
    discord: Boolean(discordResult?.delivered),
    discordReason: discordResult?.reason || null,
    // Whether this person can be reached inside Quest at all. False means the
    // captain has to send them the link, and the UI has to say so.
    hasQuestAccount: Boolean(questUserId),
    invitationUrl: buildInvitationUrl(),
  };
};

const notifyInvites = async (invites = []) => {
  if (!Array.isArray(invites) || invites.length === 0) return [];

  const results = await Promise.allSettled(invites.map((invite) => notifyInvite(invite)));

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    logger.warn("Invite notice failed.", {
      invitationId: invites[index]?.invitationId || null,
      error: result.reason,
    });
    return { inApp: false, discord: false, discordReason: "FAILED", hasQuestAccount: false };
  });
};

module.exports = {
  notifyInvite,
  notifyInvites,
  findQuestUserForInvite,
  buildInvitationUrl,
  INVITATIONS_PATH,
};
