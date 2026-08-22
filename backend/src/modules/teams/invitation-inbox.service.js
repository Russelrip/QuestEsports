const { prisma } = require("../../lib/prisma");

// Invitations addressed to the signed-in user, reachable inside Quest.
//
// Until now a pending invitation existed only at the end of an emailed token
// link: `listProfileTeams` returns teams the user captains or has already
// ACCEPTED, so an invite that never arrived was effectively lost — the player
// had no way to find it, and the captain's only recourse was to resend and hope.
//
// That fragility belongs to the delivery channel, not to the invitation. This
// makes the invitation itself durable and discoverable, which is also the
// precondition for adding any best-effort channel (a Discord DM that silently
// fails must not cost anyone their roster spot).
const listInvitationsForUser = async ({ user }) => {
  // Matching on email is how an invitation reaches someone who was invited
  // before they had an account. It is only safe once the address is verified —
  // otherwise signing up with someone else's address would hand over their
  // invitations.
  const identityFilters = [{ userId: user.id }];
  if (user.emailVerified && user.emailNormalized) {
    identityFilters.push({ emailNormalized: user.emailNormalized, userId: null });
  }

  const members = await prisma.savedTeamMember.findMany({
    where: {
      inviteStatus: "pending",
      OR: identityFilters,
    },
    orderBy: { inviteSentAt: "desc" },
    select: {
      id: true,
      role: true,
      inviteSentAt: true,
      inviteExpiresAt: true,
      team: {
        select: {
          id: true,
          name: true,
          teamTag: true,
          game: true,
          captainUser: { select: { username: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  const now = Date.now();

  return {
    invitations: members.map((member) => {
      // An expired invitation is still shown rather than hidden: "this expired,
      // ask your captain to resend" is actionable, silence is not.
      const expired = Boolean(
        member.inviteExpiresAt && new Date(member.inviteExpiresAt).getTime() < now,
      );
      return {
        id: member.id,
        role: member.role,
        teamId: member.team.id,
        teamName: member.team.name,
        teamTag: member.team.teamTag,
        game: member.team.game,
        captain: member.team.captainUser?.username
          || [member.team.captainUser?.firstName, member.team.captainUser?.lastName]
            .filter(Boolean)
            .join(" ")
          || null,
        sentAt: member.inviteSentAt,
        expiresAt: member.inviteExpiresAt,
        expired,
      };
    }),
  };
};

module.exports = { listInvitationsForUser };
