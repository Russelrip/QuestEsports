const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { notifyInvite, notifyInvites } = require("./invite-notice.service");
const { refreshRegistrationVerificationStatus } = require("./registration-verification");
const {
  TEAM_INVITE_TTL_HOURS,
  NUDGEABLE_INVITE_STATUSES,
  TEAM_INVITE_RESEND_COOLDOWN_SECONDS,
  mapSavedTeamMember,
} = require("./team-shared");

// A captain nudging someone who has not answered yet.
//
// This used to mint a fresh token and send an email, which made it the only way
// to repair an invitation that had gone astray — and made every repair cost a
// delivery. There is nothing to repair now: the invitation is a row the invitee
// can already find. So this reopens the window and says so again over the free
// channels, and reports what it actually reached rather than claiming it sent
// something.
//
// A captain who cannot be reached any of those ways is told to send the link
// themselves. They are teammates; they already have a way to talk.
const INVITE_MEMBER_INCLUDE = {
  team: {
    select: {
      name: true,
      captainUser: {
        select: { firstName: true, lastName: true, username: true },
      },
    },
  },
};

const nudgeTeamInvite = async ({ teamId, memberId, user, now = new Date() }) => {
  const member = await prisma.savedTeamMember.findFirst({
    where: {
      id: memberId,
      teamId,
      team: { captainUserId: user.id },
    },
    include: INVITE_MEMBER_INCLUDE,
  });

  if (!member) {
    throw new HttpError(404, "Team member not found or you do not have permission to manage this invite.");
  }
  return reopenTeamInvite({ member, teamId, now });
};

// An admin sending an invitation again, from the team directory.
//
// The same reopening a captain gets, without the ownership check: an admin is
// who a stuck roster gets escalated to, and "ask your captain to press the
// button" is not an answer they can give. The controller records who did it.
const adminResendTeamInvite = async ({ teamId, memberId, now = new Date() }) => {
  const member = await prisma.savedTeamMember.findFirst({
    where: { id: memberId, teamId },
    include: INVITE_MEMBER_INCLUDE,
  });
  if (!member) {
    throw new HttpError(404, "Team member not found.");
  }
  return reopenTeamInvite({ member, teamId, now });
};

// An admin sending an invitation again from a registration's roster.
//
// A registration row is not what an invitee answers: they accept the saved
// team's copy, and that answer propagates to the registration by address. So
// this reopens the saved team's invitation for the same person and points the
// reopening at this registration's row specifically. A registration with no
// such copy has nothing anyone could accept, and saying so is more useful than
// reopening a row that can never be answered.
const adminResendRegistrationInvite = async ({ registrationId, memberId, now = new Date() }) => {
  const registrationMember = await prisma.registrationMember.findFirst({
    where: { id: memberId, registrationId },
    select: {
      id: true,
      role: true,
      emailNormalized: true,
      inviteStatus: true,
      registration: { select: { id: true, savedTeamId: true } },
    },
  });
  if (!registrationMember) {
    throw new HttpError(404, "Roster member not found on this registration.");
  }
  if (registrationMember.role === "CAPTAIN") {
    throw new HttpError(409, "The captain does not have an invitation to send.");
  }
  if (!NUDGEABLE_INVITE_STATUSES.includes(registrationMember.inviteStatus)) {
    throw new HttpError(409, "Only an unanswered invitation can be sent again.");
  }

  const teamId = registrationMember.registration.savedTeamId;
  const member = teamId && registrationMember.emailNormalized
    ? await prisma.savedTeamMember.findFirst({
        where: { teamId, emailNormalized: registrationMember.emailNormalized },
        include: INVITE_MEMBER_INCLUDE,
      })
    : null;
  if (!member) {
    throw new HttpError(
      409,
      "This person has no team invitation to send again. Correct the roster so their details match the team, or ask the captain to add them."
    );
  }
  return reopenTeamInvite({ member, teamId, now, registrationMemberId: registrationMember.id });
};

// Reopen one saved-team invitation and the registration row it stands for, then
// tell the invitee again. Shared by the captain and admin paths, so a resend
// means exactly the same thing whoever pressed it.
const reopenTeamInvite = async ({ member, teamId, now, registrationMemberId = null }) => {
  if (member.role === "CAPTAIN" || !NUDGEABLE_INVITE_STATUSES.includes(member.inviteStatus)) {
    throw new HttpError(409, "Only an unanswered invitation can be sent again.");
  }

  const nextAllowedAt = member.inviteSentAt
    ? new Date(member.inviteSentAt).getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    : 0;
  if (nextAllowedAt > now.getTime()) {
    const retryAfterSeconds = Math.max(Math.ceil((nextAllowedAt - now.getTime()) / 1000), 1);
    throw new HttpError(429, `Wait ${retryAfterSeconds} seconds before sending this invitation again.`, {
      retryAfterSeconds,
    });
  }

  const inviteExpiresAt = new Date(
    now.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const relatedRegistrationMember = prisma.registrationMember?.findFirst
    ? await prisma.registrationMember.findFirst({
        where: {
          ...(registrationMemberId ? { id: registrationMemberId } : {}),
          emailNormalized: member.emailNormalized,
          inviteStatus: { in: NUDGEABLE_INVITE_STATUSES },
          registration: { savedTeamId: teamId },
        },
        orderBy: { createdAt: "desc" },
        include: { registration: { include: { tournament: { select: { title: true } } } } },
      })
    : null;

  const updatedMember = await prisma.$transaction(async (tx) => {
    const updated = await tx.savedTeamMember.update({
      where: { id: member.id },
      data: {
        userId: null,
        inviteStatus: "pending",
        inviteTokenHash: null,
        inviteSentAt: now,
        inviteExpiresAt,
        inviteRespondedAt: null,
      },
    });
    if (relatedRegistrationMember) {
      await tx.registrationMember.updateMany({
        where: { id: relatedRegistrationMember.id, inviteStatus: { in: NUDGEABLE_INVITE_STATUSES } },
        data: {
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt: now,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      await refreshRegistrationVerificationStatus({
        tx,
        registrationId: relatedRegistrationMember.registration.id,
      });
    }
    return updated;
  });

  const captainName = [
    member.team.captainUser.firstName,
    member.team.captainUser.lastName,
  ].filter(Boolean).join(" ").trim() || member.team.captainUser.username;

  // Awaited, unlike the old fire-and-forget DM, because what it reached is the
  // answer the captain is waiting for. It still cannot fail the nudge: the
  // window has already been reopened and the invitation is already findable.
  const delivery = await notifyInvite({
    invitationId: member.id,
    userId: member.userId || null,
    emailNormalized: member.emailNormalized || null,
    recipientName: member.name,
    teamName: member.team.name,
    captainName,
    tournamentTitle: relatedRegistrationMember?.registration?.tournament?.title || null,
    sentAt: now,
  });

  logger.info("Team invite nudge sent.", {
    teamId,
    memberId: member.id,
    inApp: delivery.inApp,
    discord: delivery.discord,
    hasQuestAccount: delivery.hasQuestAccount,
  });

  return {
    member: mapSavedTeamMember(updatedMember),
    delivery,
    resendAvailableAt: new Date(
      now.getTime() + TEAM_INVITE_RESEND_COOLDOWN_SECONDS * 1000
    ),
  };
};

// Tell each invitee their invitation is waiting. The invitation itself is
// already written down by the time this runs, so every channel here is best
// effort and none of them is the invitation: a notice that reaches nobody costs
// a nudge, not a roster spot.
const sendTeamInvites = async (inviteDispatches) => {
  if (!Array.isArray(inviteDispatches) || inviteDispatches.length === 0) return [];

  try {
    return await notifyInvites(inviteDispatches);
  } catch (error) {
    logger.error("Failed to send team invite notices.", {
      inviteCount: inviteDispatches.length,
      error,
    });
    return [];
  }
};

module.exports = {
  nudgeTeamInvite,
  adminResendTeamInvite,
  adminResendRegistrationInvite,
  sendTeamInvites,
};
