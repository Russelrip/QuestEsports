const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");
const { requireLinkedDiscord } = require("../auth/discord-link.service");
const {
  refreshRegistrationVerificationStatus,
} = require("./registration-verification");

// Invitations addressed to the signed-in user, answered inside Quest.
//
// An invitation used to be answerable only by presenting the token it was
// emailed with, which made the invitation exactly as durable as the delivery:
// an email that never arrived was a roster spot nobody could take, and the
// captain's only recourse was to send it again and hope. It also left a
// credential sitting in an inbox, and in whatever chat the link got forwarded
// to.
//
// What answers an invitation now is the invitee's identity. That is strictly
// narrower than a token — a token is bearer authority, an identity is not — and
// it is what lets the invitation live on a page instead of in a message.
//
// `savedTeamMember` is the surface. Every roster invitation has one: a
// standalone team creates them directly, and a tournament roster gets them
// through `syncSavedTeamFromRegistration`, which every team registration runs.
// Answering one propagates to the registration rows it stands for.

const RESPONDABLE_STATUSES = ["pending"];

const DISCORD_REQUIRED_MESSAGE =
  "Connect your Discord account before joining a team. Quest uses Discord to reach players during an event.";

// A registration is still listening to its roster until it has been decided.
// An approved registration has had its roster snapshotted and locked, and a
// rejected or cancelled one is not waiting on anybody.
const OPEN_REGISTRATION_STATUSES = ["pending", "waitlisted"];

// An invitation belongs to whoever it was addressed to: the account it is
// linked to, or an address that account has proven it controls. An unverified
// address is never matched, or signing up with someone else's address would
// hand over their invitations.
const buildIdentityFilters = (user) => {
  const filters = [{ userId: user.id }];
  if (user.emailVerified && user.emailNormalized) {
    filters.push({ emailNormalized: user.emailNormalized, userId: null });
  }
  return filters;
};

const captainNameOf = (captainUser) =>
  [captainUser?.firstName, captainUser?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() || captainUser?.username || null;

const invitationSelect = {
  id: true,
  role: true,
  name: true,
  email: true,
  emailNormalized: true,
  inviteStatus: true,
  inviteSentAt: true,
  inviteExpiresAt: true,
  team: {
    select: {
      id: true,
      name: true,
      teamTag: true,
      game: true,
      captainUser: { select: { username: true, firstName: true, lastName: true } },
      registrations: {
        where: { status: { in: OPEN_REGISTRATION_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, tournament: { select: { title: true, slug: true } } },
      },
    },
  },
};

const mapInvitation = (member) => {
  const registration = member.team.registrations?.[0] || null;
  return {
    id: member.id,
    role: member.role,
    teamId: member.team.id,
    teamName: member.team.name,
    teamTag: member.team.teamTag,
    game: member.team.game,
    captain: captainNameOf(member.team.captainUser),
    // What the invitation is actually for, when it is for something. A roster
    // invitation with no open registration behind it is a standing team.
    tournamentTitle: registration?.tournament?.title || null,
    tournamentSlug: registration?.tournament?.slug || null,
    sentAt: member.inviteSentAt,
    expiresAt: member.inviteExpiresAt,
  };
};

const listInvitationsForUser = async ({ user }) => {
  const members = await prisma.savedTeamMember.findMany({
    where: {
      inviteStatus: { in: RESPONDABLE_STATUSES },
      OR: buildIdentityFilters(user),
    },
    orderBy: { inviteSentAt: "desc" },
    select: invitationSelect,
  });

  return { invitations: members.map(mapInvitation) };
};

// Whether this user can accept right now, and if not, what is in the way. The
// invitee sees it on their own invitation and the captain sees it on their
// roster, because a roster that will not confirm is otherwise a mystery to the
// only person who can do anything about it.
const getInvitationReadiness = async ({ userId }) => {
  if (!userId) return { hasQuestAccount: false, hasDiscord: false };

  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "discord" },
    select: { id: true },
  });

  return { hasQuestAccount: true, hasDiscord: Boolean(account) };
};

const loadInvitationForUser = async ({ invitationId, user }) => {
  const normalizedId = normalizeText(invitationId);
  if (!normalizedId) {
    throw new HttpError(400, "An invitation is required.");
  }

  const member = await prisma.savedTeamMember.findFirst({
    where: {
      id: normalizedId,
      OR: buildIdentityFilters(user),
    },
    select: invitationSelect,
  });

  if (!member) {
    throw new HttpError(404, "This invitation is not available to your account.");
  }

  return member;
};

const assertRespondable = (member) => {
  if (member.inviteStatus === "expired") {
    throw new HttpError(
      409,
      "This invitation expired. Ask your captain to invite you again."
    );
  }
  if (!RESPONDABLE_STATUSES.includes(member.inviteStatus)) {
    throw new HttpError(409, "This invitation has already been answered.");
  }
  if (member.inviteExpiresAt && member.inviteExpiresAt <= new Date()) {
    throw new HttpError(
      409,
      "This invitation expired. Ask your captain to invite you again."
    );
  }
};

const respondToInvitation = async ({ invitationId, decision, user }) => {
  const normalizedDecision = normalizeText(decision).toLowerCase();

  if (!["accept", "decline"].includes(normalizedDecision)) {
    throw new HttpError(400, "A valid invitation decision is required.");
  }
  if (!user) {
    throw new HttpError(401, "Sign in to respond to this invitation.");
  }
  if (!user.emailVerified) {
    throw new HttpError(403, "Verify your account email before responding to this invitation.");
  }

  const member = await loadInvitationForUser({ invitationId, user });
  assertRespondable(member);

  const accepting = normalizedDecision === "accept";

  // The Discord requirement sits here, on the person who can satisfy it.
  // Checking it when the captain submitted made it unsatisfiable by design: a
  // captain cannot connect Discord on someone else's behalf, and was refused
  // for a gap only the invitee could close. Declining stays open — someone who
  // does not want the spot should not have to connect an account to say so.
  if (accepting) {
    await requireLinkedDiscord(user.id, DISCORD_REQUIRED_MESSAGE);
  }

  const inviteStatus = accepting ? "accepted" : "declined";
  const inviteRespondedAt = new Date();
  const linkedUserId = accepting ? user.id : null;

  const updated = await prisma.$transaction(async (tx) => {
    const consumed = await tx.savedTeamMember.updateMany({
      where: {
        id: member.id,
        inviteStatus: { in: RESPONDABLE_STATUSES },
      },
      data: {
        userId: linkedUserId,
        inviteStatus,
        inviteRespondedAt,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });

    if (consumed.count === 0) {
      throw new HttpError(409, "This invitation has already been answered.");
    }

    // The registrations this roster spot stands for. Scoped by the member row's
    // own pending state and by registrations still open to their roster — never
    // by payment, which says nothing about whether a roster is settled: a free
    // registration is stored as paid the moment it is created.
    const openRegistrations = await tx.teamRegistration.findMany({
      where: {
        savedTeamId: member.team.id,
        status: { in: OPEN_REGISTRATION_STATUSES },
      },
      select: { id: true },
    });

    if (openRegistrations.length > 0) {
      await tx.registrationMember.updateMany({
        where: {
          emailNormalized: member.emailNormalized,
          inviteStatus: { in: RESPONDABLE_STATUSES },
          registrationId: { in: openRegistrations.map((registration) => registration.id) },
        },
        data: {
          userId: linkedUserId,
          inviteStatus,
          inviteRespondedAt,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });

      for (const registration of openRegistrations) {
        await refreshRegistrationVerificationStatus({
          tx,
          registrationId: registration.id,
        });
      }
    }

    return tx.savedTeamMember.findUnique({
      where: { id: member.id },
      select: invitationSelect,
    });
  });

  return {
    invitation: { ...mapInvitation(updated), inviteStatus },
    inviteStatus,
  };
};

module.exports = {
  listInvitationsForUser,
  respondToInvitation,
  getInvitationReadiness,
  DISCORD_REQUIRED_MESSAGE,
  OPEN_REGISTRATION_STATUSES,
};
