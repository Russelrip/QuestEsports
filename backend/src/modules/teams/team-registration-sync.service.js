const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { refreshRegistrationVerificationStatus } = require("./registration-verification");
const { scheduleTeamLogoCleanup } = require("../../lib/upload-cleanup");
const { normalizeEmail, normalizeText } = require("../../lib/validation");
const {
  TEAM_INVITE_TTL_HOURS,
  runRetryableTeamSyncOperation,
  runTeamSyncTransaction,
} = require("./team-shared");
const { sendTeamInvites } = require("./team-invites.service");

// Mirrors a tournament roster into the saved team that outlives it.
//
// What crosses over is the roster itself — who is on it, in what role, and
// where their invitation stands. The game identifier does not. It was collected
// because that tournament's rules asked for it, it is already recorded on the
// registration member and in the registration's own snapshot, and copying it
// here would make it a property of the team: reused, unasked, the next time the
// same roster enters something for a different game entirely.
const syncSavedTeamFromRegistration = async ({
  tx,
  registrationId,
  user,
  teamName,
  country,
  teamTag,
  organizationRequested,
  logoName,
  members,
  tournamentTitle,
}) => {
  const normalizedTeamName = normalizeText(teamName);

  const existingTeam = await tx.savedTeam.findUnique({
    where: {
      captainUserId_name: {
        captainUserId: user.id,
        name: normalizedTeamName,
      },
    },
    include: {
      members: true,
    },
  });

  const team =
    existingTeam ||
    (await tx.savedTeam.create({
      data: {
        id: crypto.randomUUID(),
        captainUserId: user.id,
        name: normalizedTeamName,
        country: country || null,
        teamTag: teamTag || null,
        organizationRequested: Boolean(organizationRequested),
        logoName: logoName || null,
      },
      include: {
        members: true,
      },
    }));

  // A linked saved team is authoritative for its logo, but a null logo means
  // two different things. `logoClearedAt` separates them: a team that has never
  // had a logo adopts the one a registration supplies, so a captain's upload is
  // actually displayed instead of being discarded and deleted below. A removal
  // the captain or an admin actually made stays canonical, so a stale
  // registration snapshot can never resurrect it, and an existing logo is never
  // overwritten.
  const existingLogoName = existingTeam?.logoName || null;
  const hasNeverHadLogo = Boolean(existingTeam) && !existingLogoName && !existingTeam.logoClearedAt;
  const adoptedLogoName = hasNeverHadLogo ? logoName || null : null;

  if (existingTeam) {
    await tx.savedTeam.update({
      where: { id: existingTeam.id },
      data: {
        country: country || null,
        teamTag: teamTag || null,
        organizationRequested: Boolean(organizationRequested),
        ...(adoptedLogoName ? { logoName: adoptedLogoName } : {}),
      },
    });
  }

  const effectiveLogoName = existingTeam
    ? existingLogoName || adoptedLogoName
    : logoName || null;

  const existingMembersByRosterPosition = new Map(
    (existingTeam?.members || [])
      .map((member) => [
        `${member.role}:${member.memberOrder}:${member.emailNormalized}`,
        member,
      ])
  );

  await tx.savedTeamMember.deleteMany({
    where: {
      teamId: team.id,
    },
  });

  const inviteDispatches = [];
  const registrationMemberUpdates = [];
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;

  await tx.savedTeamMember.createMany({
    data: members.map((member) => {
      const email = normalizeEmail(member.email);
      const existingMember = existingMembersByRosterPosition.get(
        `${member.role}:${member.order}:${email}`
      );
      // These rows are deleted and recreated on every sync. Carrying the id
      // over keeps an outstanding invitation the same invitation, rather than
      // one that changes identity underneath the notices pointing at it.
      const memberId = existingMember?.id || crypto.randomUUID();
      const acceptedMember =
        member.inviteStatus === "accepted"
          ? member
          : member.inviteStatus === "declined"
            ? null
            : existingMember?.inviteStatus === "accepted" && existingMember.userId
              ? existingMember
              : null;
      // Still outstanding because nobody answered it and it has not run out
      // — not because a token still exists for it. Reissuing an invitation that
      // is already live would only re-notify someone already told.
      const activePendingMember =
        existingMember?.inviteStatus === "pending" &&
        existingMember.inviteExpiresAt &&
        existingMember.inviteExpiresAt > inviteSentAt
          ? existingMember
          : null;

      if (member.role === "CAPTAIN" || acceptedMember) {
        const linkedUserId = member.role === "CAPTAIN" ? user.id : acceptedMember.userId || null;
        const inviteRespondedAt = acceptedMember?.inviteRespondedAt || new Date();
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: linkedUserId,
            inviteStatus: "accepted",
            inviteTokenHash: null,
            inviteSentAt: acceptedMember?.inviteSentAt || null,
            inviteExpiresAt: null,
            inviteRespondedAt,
          },
        });

        return {
          id: memberId,
          teamId: team.id,
          userId: linkedUserId,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
          inviteStatus: "accepted",
          inviteTokenHash: null,
          inviteSentAt: acceptedMember?.inviteSentAt || null,
          inviteExpiresAt: null,
          inviteRespondedAt,
        };
      }

      if (member.inviteStatus === "declined") {
        const inviteRespondedAt = member.inviteRespondedAt || new Date();
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: null,
            inviteStatus: "declined",
            inviteTokenHash: null,
            inviteSentAt: member.inviteSentAt || null,
            inviteExpiresAt: null,
            inviteRespondedAt,
          },
        });

        return {
          id: memberId,
          teamId: team.id,
          userId: null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
          inviteStatus: "declined",
          inviteTokenHash: null,
          inviteSentAt: member.inviteSentAt || null,
          inviteExpiresAt: null,
          inviteRespondedAt,
        };
      }

      if (activePendingMember) {
        registrationMemberUpdates.push({
          role: member.role,
          memberOrder: member.order,
          data: {
            userId: null,
            inviteStatus: "pending",
            inviteTokenHash: null,
            inviteSentAt: activePendingMember.inviteSentAt,
            inviteExpiresAt: activePendingMember.inviteExpiresAt,
            inviteRespondedAt: null,
          },
        });

        return {
          id: memberId,
          teamId: team.id,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email,
          emailNormalized: email,
          // Carried, not re-collected. These rows are deleted and recreated on
          // every sync, so dropping the columns here erases whatever an older
          // team already holds. The value carried is the saved team's own, never
          // the registration's — a tournament's game identifier stays with the
          // tournament that asked for it.
          phone: existingMember?.phone ?? null,
          discord: existingMember?.discord ?? null,
          riotId: existingMember?.riotId ?? null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt: activePendingMember.inviteSentAt,
          inviteExpiresAt: activePendingMember.inviteExpiresAt,
        };
      }

      registrationMemberUpdates.push({
        role: member.role,
        memberOrder: member.order,
        data: {
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      inviteDispatches.push({
        invitationId: memberId,
        emailNormalized: email,
        recipientName: member.name,
        teamName: normalizedTeamName,
        captainName,
        tournamentTitle,
        sentAt: inviteSentAt,
      });

      return {
        id: memberId,
        teamId: team.id,
        role: member.role,
        memberOrder: member.order,
        name: member.name,
        email,
        emailNormalized: email,
        // Carried, not re-collected. These rows are deleted and recreated on
        // every sync, so dropping the columns here erases whatever an older
        // team already holds. The value carried is the saved team's own, never
        // the registration's — a tournament's game identifier stays with the
        // tournament that asked for it.
        phone: existingMember?.phone ?? null,
        discord: existingMember?.discord ?? null,
        riotId: existingMember?.riotId ?? null,
        inviteStatus: "pending",
        inviteTokenHash: null,
        inviteSentAt,
        inviteExpiresAt,
      };
    }),
  });

  if (existingTeam && logoName && logoName !== effectiveLogoName) {
    await scheduleTeamLogoCleanup({
      filename: logoName,
      tx,
      context: {
        operation: "syncSavedTeamFromRegistration",
        registrationId,
        teamId: team.id,
      },
    });
  }

  await tx.teamRegistration.update({
    where: { id: registrationId },
    data: { savedTeamId: team.id, teamLogoName: effectiveLogoName },
  });

  for (const member of registrationMemberUpdates) {
    await tx.registrationMember.update({
      where: {
        registrationId_role_memberOrder: {
          registrationId,
          role: member.role,
          memberOrder: member.memberOrder,
        },
      },
      data: member.data,
    });
  }

  await refreshRegistrationVerificationStatus({ tx, registrationId });

  return inviteDispatches;
};

const syncTeamRegistrationToProfile = async ({ registrationId, requirePaid }) => {
  const registration = await runRetryableTeamSyncOperation(() =>
    prisma.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        user: true,
        tournament: { select: { title: true } },
        members: { orderBy: { memberOrder: "asc" } },
      },
    })
  );
  if (
    !registration ||
    registration.entryType !== "team" ||
    (requirePaid && registration.paymentStatus !== "paid") ||
    registration.savedTeamId ||
    !registration.user
  ) {
    return;
  }

  const members = registration.members.map((member) => ({
    role: member.role,
    order: member.memberOrder,
    name: member.name,
    email: member.email,
    userId: member.userId,
    inviteStatus: member.inviteStatus,
    inviteSentAt: member.inviteSentAt,
    inviteExpiresAt: member.inviteExpiresAt,
    inviteRespondedAt: member.inviteRespondedAt,
  }));
  const inviteDispatches = await runTeamSyncTransaction(async (tx) => {
    const current = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      select: { savedTeamId: true, paymentStatus: true, members: true },
    });
    if (
      !current ||
      current.savedTeamId ||
      (requirePaid && current.paymentStatus !== "paid")
    ) return [];
    return syncSavedTeamFromRegistration({
      tx,
      registrationId,
      user: registration.user,
      teamName: registration.teamName,
      country: registration.country,
      teamTag: registration.teamTag,
      organizationRequested: registration.organizationRequested,
      logoName: registration.teamLogoName,
      members: Array.isArray(current.members)
        ? current.members.map((member) => ({
            role: member.role,
            order: member.memberOrder,
            name: member.name,
            email: member.email,
            userId: member.userId,
            inviteStatus: member.inviteStatus,
            inviteSentAt: member.inviteSentAt,
            inviteExpiresAt: member.inviteExpiresAt,
            inviteRespondedAt: member.inviteRespondedAt,
          }))
        : members,
      tournamentTitle: registration.tournament.title,
    });
  });
  await sendTeamInvites(inviteDispatches);
};

const ensureTeamRegistrationSaved = async (registrationId) =>
  syncTeamRegistrationToProfile({ registrationId, requirePaid: false });

const activatePaidTeamRegistration = async (registrationId) =>
  syncTeamRegistrationToProfile({ registrationId, requirePaid: true });

module.exports = {
  syncSavedTeamFromRegistration,
  ensureTeamRegistrationSaved,
  activatePaidTeamRegistration,
};
