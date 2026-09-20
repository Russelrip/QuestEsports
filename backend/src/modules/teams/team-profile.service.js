const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { refreshRegistrationVerificationStatus } = require("./registration-verification");
const { assertNoCoachPlayerRoleConflict } = require("../tournaments/role-conflict.service");
const {
  removeUploadsQuietly,
  removeTeamLogoIfUnreferenced,
  scheduleTeamLogoCleanup,
} = require("../../lib/upload-cleanup");
const { persistTeamLogoUpload, teamLogoDirectory } = require("../../middleware/upload");
const { isValidEmail, normalizeEmail, normalizeText } = require("../../lib/validation");
const {
  TEAM_INVITE_TTL_HOURS,
  runRetryableTeamSyncOperation,
  runTeamSyncTransaction,
  mapSavedTeam,
  MANAGEABLE_TEAM_MEMBER_ROLES,
  OPEN_REGISTRATION_STATUSES,
} = require("./team-shared");
const { sendTeamInvites } = require("./team-invites.service");

// Why a roster is not confirming yet, resolved for every member at once.
//
// A captain whose registration will not go through can otherwise only see that
// somebody has not accepted — not that the person has no Quest account, or has
// one but has never connected Discord and so cannot accept even if they wanted
// to. Those are different problems with different fixes, and only the captain
// is in a position to go and chase either of them.
//
// Resolved by the account the row is linked to, or by a verified address — the
// same two identities the invitation itself is answered by. An unverified
// address proves nothing about who controls it, and the link is checked first
// because someone who accepted and later changed their account email is still
// the person on this roster.
//
// It is also where the roster's Discord handle comes from. A captain used to
// type it, which meant it could say anything at all; the accepting user's own
// connected account is the only version of it that is true by construction, so
// it replaces whatever an older team stored.
const attachRosterReadiness = async (teams) => {
  const allMembers = teams.flatMap((team) => team.members || []);
  const emails = [
    ...new Set(allMembers.map((member) => normalizeEmail(member.email)).filter(Boolean)),
  ];
  const linkedUserIds = [...new Set(allMembers.map((member) => member.userId).filter(Boolean))];

  // Narrow client projections cannot read accounts back. Readiness is an
  // addition to the roster, never a precondition for returning it, so a scope
  // that cannot look one up reports nothing rather than failing the caller —
  // the same pattern the registration-member lookups here already use.
  if (
    (emails.length === 0 && linkedUserIds.length === 0) ||
    typeof prisma.user?.findMany !== "function"
  ) return teams;

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { emailNormalized: { in: emails }, emailVerified: true },
        { id: { in: linkedUserIds } },
      ],
    },
    select: { id: true, emailNormalized: true, emailVerified: true, discordTag: true },
  });
  const discordLinked = users.length > 0 && typeof prisma.oAuthAccount?.findMany === "function"
    ? await prisma.oAuthAccount.findMany({
      where: { userId: { in: users.map((account) => account.id) }, provider: "discord" },
      select: { userId: true },
    })
    : [];
  const discordUserIds = new Set(discordLinked.map((account) => account.userId));
  // A handle only replaces the stored one when there is a handle to replace it
  // with. An account that has never connected Discord would otherwise blank out
  // whatever an older team was carrying, which loses data to say nothing.
  const presentAccount = (account) => ({
    hasQuestAccount: true,
    hasDiscord: discordUserIds.has(account.id),
    ...(account.discordTag ? { discord: account.discordTag } : {}),
  });
  const accountsById = new Map(users.map((account) => [account.id, account]));
  const verifiedAccountsByEmail = new Map(
    users
      .filter((account) => account.emailVerified && account.emailNormalized)
      .map((account) => [account.emailNormalized, account])
  );

  return teams.map((team) => ({
    ...team,
    members: (team.members || []).map((member) => {
      const account =
        (member.userId ? accountsById.get(member.userId) : null) ||
        verifiedAccountsByEmail.get(normalizeEmail(member.email)) ||
        null;
      // The join key, not something the roster needs to publish: a captain is
      // told whether a teammate has an account, not what its id is.
      const presented = { ...member };
      delete presented.userId;

      return {
        ...presented,
        ...(account
          ? presentAccount(account)
          : { hasQuestAccount: false, hasDiscord: false }),
      };
    }),
  }));
};

const listProfileTeams = async ({ user }) => {
  const teams = await prisma.savedTeam.findMany({
    where: {
      OR: [
        { captainUserId: user.id },
        {
          members: {
            some: {
              userId: user.id,
              inviteStatus: "accepted",
            },
          },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      captainUser: {
        select: {
          firstName: true,
          lastName: true,
          username: true,
        },
      },
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
      },
      _count: {
        select: { registrations: true },
      },
    },
  });

  return attachRosterReadiness(teams.map((team) => mapSavedTeam(team, user.id)));
};

const parseStandaloneMembers = (value) => {
  let members;

  try {
    members = JSON.parse(String(value || "[]"));
  } catch {
    throw new HttpError(400, "Team members must be valid JSON.");
  }

  if (!Array.isArray(members) || members.length > 20) {
    throw new HttpError(400, "A team can include up to 20 invited members.");
  }

  const normalizedMembers = members.map((member) => {
    const role = normalizeText(member?.role).toUpperCase() || "PLAYER";
    if (!MANAGEABLE_TEAM_MEMBER_ROLES.has(role)) {
      throw new HttpError(400, "Team members must be players, substitutes, or coaches.");
    }

    // Role, name and email, and nothing else. Anything a captain typed about
    // somebody's Discord or game identity is that captain's guess about another
    // person's account; the accepting user's own linked account is the only
    // honest source for it. See parseManagedMembers for what happens to values
    // an older team already carries.
    return {
      role,
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
    };
  });

  if (normalizedMembers.filter((member) => member.role === "COACH").length > 1) {
    throw new HttpError(400, "A saved team can include at most one coach.");
  }

  if (
    normalizedMembers.some(
      (member) => !member.name || !isValidEmail(member.email)
        || member.name.length > 100
        || member.email.length > 254
    )
  ) {
    throw new HttpError(400, "Each team member needs valid roster details.");
  }

  const uniqueEmails = new Set(normalizedMembers.map((member) => member.email));
  if (uniqueEmails.size !== normalizedMembers.length) {
    throw new HttpError(400, "Each team member must use a unique email address.");
  }

  return normalizedMembers;
};

const createSavedTeam = async ({ user, body, file }) => {
  const name = normalizeText(body.name);
  const country = normalizeText(body.country);
  const teamTag = normalizeText(body.teamTag);
  const organizationRequested = ["true", "1", "on"].includes(
    normalizeText(body.organizationRequested).toLowerCase()
  );
  const members = parseStandaloneMembers(body.members);
  const captainEmail = normalizeEmail(user.email);

  if (!name || !country || !teamTag || teamTag.length > 12) {
    throw new HttpError(400, "Team name, country, and a tag of up to 12 characters are required.");
  }

  if (members.some((member) => member.email === captainEmail)) {
    throw new HttpError(400, "The captain is already included in the member list.");
  }

  // Every team Quest holds should be able to appear on a bracket, an overlay or
  // a match card, and that needs a logo. Requiring it at creation is the only
  // point where no captain is stranded: there is nothing saved yet to lose.
  // Teams created before this rule keep working, and are caught at the door by
  // `assertTeamLogoAvailable` when they register for a tournament.
  if (!file) {
    throw new HttpError(400, "A team logo is required. Upload a square image, ideally 300x300.");
  }

  const persistedLogo = await persistTeamLogoUpload(file);
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username;
  const inviteDispatches = [];

  try {
    const team = await prisma.$transaction(async (tx) => {
      const createdTeam = await tx.savedTeam.create({
        data: {
          id: crypto.randomUUID(),
          captainUserId: user.id,
          name,
          country,
          teamTag,
          organizationRequested,
          logoName: persistedLogo?.filename || null,
        },
      });

      const memberOrders = { PLAYER: 0, SUBSTITUTE: 0, COACH: 0 };
      const memberRecords = [
        {
          id: crypto.randomUUID(),
          teamId: createdTeam.id,
          userId: user.id,
          role: "CAPTAIN",
          memberOrder: 0,
          name: captainName,
          email: captainEmail,
          emailNormalized: captainEmail,
          inviteStatus: "accepted",
          inviteRespondedAt: inviteSentAt,
        },
        ...members.map((member) => {
          memberOrders[member.role] += 1;
          // The row id is the invitation. Generated here rather than by the
          // database so the notice can name the thing it is pointing at.
          const memberId = crypto.randomUUID();
          inviteDispatches.push({
            invitationId: memberId,
            emailNormalized: member.email,
            recipientName: member.name,
            teamName: name,
            captainName,
            tournamentTitle: null,
            sentAt: inviteSentAt,
          });

          return {
            id: memberId,
            teamId: createdTeam.id,
            role: member.role,
            memberOrder: memberOrders[member.role],
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
            inviteStatus: "pending",
            inviteTokenHash: null,
            inviteSentAt,
            inviteExpiresAt,
          };
        }),
      ];

      await tx.savedTeamMember.createMany({ data: memberRecords });

      return tx.savedTeam.findUnique({
        where: { id: createdTeam.id },
        include: {
          captainUser: {
            select: { firstName: true, lastName: true, username: true },
          },
          members: true,
          _count: {
            select: { registrations: true },
          },
        },
      });
    });

    await sendTeamInvites(inviteDispatches);
    const [readyTeam] = await attachRosterReadiness([mapSavedTeam(team, user.id)]);
    return readyTeam;
  } catch (error) {
    await removeUploadsQuietly(
      persistedLogo
        ? [{ directory: teamLogoDirectory, filename: persistedLogo.filename }]
        : [],
      { operation: "createSavedTeam", userId: user.id }
    );

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(400, "You already have a saved team with this name.");
    }

    throw error;
  }
};

const parseManagedMembers = (value) => {
  let members;

  try {
    members = JSON.parse(String(value || "[]"));
  } catch {
    throw new HttpError(400, "Team members must be valid JSON.");
  }

  if (!Array.isArray(members) || members.length > 20) {
    throw new HttpError(400, "A team can include up to 20 invited members.");
  }

  const roleCounts = { PLAYER: 0, SUBSTITUTE: 0, COACH: 0 };
  const normalizedMembers = members.map((member) => {
    const role = normalizeText(member?.role).toUpperCase() || "PLAYER";
    if (!MANAGEABLE_TEAM_MEMBER_ROLES.has(role)) {
      throw new HttpError(400, "Team members must be players, substitutes, or coaches.");
    }

    roleCounts[role] += 1;
    return {
      role,
      memberOrder: roleCounts[role],
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
      // The roster spot this entry was loaded from, when it was. Emails are
      // how members are matched, so without it an edited address is
      // indistinguishable from a different person.
      previousId: normalizeText(member?.id) || null,
    };
  });

  if (roleCounts.COACH > 1) {
    throw new HttpError(400, "A saved team can include at most one coach.");
  }

  if (
    normalizedMembers.some(
      (member) =>
        !member.name ||
        !isValidEmail(member.email) ||
        member.name.length > 100 ||
        member.email.length > 254
    )
  ) {
    throw new HttpError(400, "Each team member needs valid roster details.");
  }

  const uniqueEmails = new Set(normalizedMembers.map((member) => member.email));
  if (uniqueEmails.size !== normalizedMembers.length) {
    throw new HttpError(400, "Each team member must use a unique email address.");
  }

  return normalizedMembers;
};

// A captain correcting an invitee's address on the saved team.
//
// Answering an invitation reaches a registration by matching the address, so a
// registration still holding the old one never heard the answer: the invitee
// accepted at the new address and the registration's copy of the spot sat
// unanswered until it expired (QES-90RK61XD's coach). The open registrations
// take the new address and a fresh invitation window here, in the same
// transaction as the saved team, so the two copies cannot disagree.
//
// A spot that already accepted is left alone. That person is confirmed for the
// tournament, and swapping them out is a roster correction, not an edit to an
// address.
const carryEmailChangesIntoOpenRegistrations = async ({
  tx,
  teamId,
  emailChanges,
  inviteSentAt,
  inviteExpiresAt,
}) => {
  if (emailChanges.length === 0) return;

  const registrations = await tx.teamRegistration.findMany({
    where: { savedTeamId: teamId, status: { in: OPEN_REGISTRATION_STATUSES } },
    select: { id: true, tournamentId: true },
  });

  for (const registration of registrations) {
    let changed = false;
    for (const change of emailChanges) {
      const { count } = await tx.registrationMember.updateMany({
        where: {
          registrationId: registration.id,
          emailNormalized: change.fromEmail,
          role: { not: "CAPTAIN" },
          inviteStatus: { not: "accepted" },
        },
        data: {
          name: change.name,
          email: change.toEmail,
          emailNormalized: change.toEmail,
          userId: null,
          inviteStatus: "pending",
          inviteTokenHash: null,
          inviteSentAt,
          inviteExpiresAt,
          inviteRespondedAt: null,
        },
      });
      if (count > 0) changed = true;
    }
    if (!changed) continue;

    // The new address can belong to someone already coaching or playing
    // elsewhere in the same tournament, which submission would have refused.
    const members = await tx.registrationMember.findMany({
      where: { registrationId: registration.id },
      select: { role: true, email: true, emailNormalized: true, riotId: true },
    });
    await assertNoCoachPlayerRoleConflict({
      tx,
      tournamentId: registration.tournamentId,
      members,
      excludeRegistrationId: registration.id,
    });
    await refreshRegistrationVerificationStatus({ tx, registrationId: registration.id });
  }
};

const updateSavedTeam = async ({ teamId, user, body, file }) => {
  const name = normalizeText(body.name);
  const country = normalizeText(body.country);
  const teamTag = normalizeText(body.teamTag);
  const organizationRequested = ["true", "1", "on"].includes(
    normalizeText(body.organizationRequested).toLowerCase()
  );
  const removeLogo = ["true", "1", "on"].includes(
    normalizeText(body.removeLogo).toLowerCase()
  );
  const members = parseManagedMembers(body.members);
  const captainEmail = normalizeEmail(user.email);

  if (!name || !country || !teamTag || teamTag.length > 12) {
    throw new HttpError(400, "Team name, country, and a tag of up to 12 characters are required.");
  }
  if (members.some((member) => member.email === captainEmail)) {
    throw new HttpError(400, "The captain is already included in the member list.");
  }

  const existingTeam = await runRetryableTeamSyncOperation(() =>
    prisma.savedTeam.findFirst({
      where: { id: teamId, captainUserId: user.id },
      include: {
        members: true,
      },
    })
  );
  if (!existingTeam) {
    throw new HttpError(404, "Team not found or you do not have permission to manage it.");
  }

  // A logo can be swapped, but not dropped: clearing it would walk a team back
  // out of the rule creation enforces. Replacing counts as keeping one, so a
  // removal paired with an upload is still fine.
  if (removeLogo && !file) {
    throw new HttpError(400, "A team logo is required. Upload a replacement instead of removing it.");
  }

  const persistedLogo = file ? await persistTeamLogoUpload(file) : null;
  const logoMutationRequested = Boolean(file) || removeLogo;
  const nextLogoName = file
    ? persistedLogo.filename
    : removeLogo
      ? null
      : existingTeam.logoName;
  const savedTeamData = { name, country, teamTag, organizationRequested };
  if (logoMutationRequested) savedTeamData.logoName = nextLogoName;
  // Record an explicit removal so the null logo reads as deliberate and a later
  // registration upload cannot resurrect it.
  if (logoMutationRequested && nextLogoName === null) savedTeamData.logoClearedAt = new Date();
  const existingMembersByEmail = new Map(
    existingTeam.members.map((member) => [member.emailNormalized, member])
  );
  const captainName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username;
  const inviteSentAt = new Date();
  const inviteExpiresAt = new Date(
    inviteSentAt.getTime() + TEAM_INVITE_TTL_HOURS * 60 * 60 * 1000
  );
  const inviteDispatches = [];

  const existingMembersById = new Map(
    existingTeam.members.map((member) => [member.id, member])
  );
  const emailChanges = members.flatMap((member) => {
    const previous = member.previousId ? existingMembersById.get(member.previousId) : null;
    if (!previous || previous.role === "CAPTAIN") return [];
    if (previous.emailNormalized === member.email) return [];
    // Either address still being on the roster means people were rearranged,
    // not an address corrected, and the email match already follows them.
    if (
      existingMembersByEmail.has(member.email) ||
      members.some((other) => other.email === previous.emailNormalized)
    ) {
      return [];
    }
    return [{ fromEmail: previous.emailNormalized, toEmail: member.email, name: member.name }];
  });

  const memberRecords = members.map(({ previousId: _previousId, ...member }) => {
    const existingMember = existingMembersByEmail.get(member.email);
    if (existingMember) {
      return {
        id: existingMember.id,
        teamId,
        userId: existingMember.userId,
        ...member,
        // Carried, not re-collected. These rows are deleted and recreated on
        // every save, so dropping the columns here would erase what an older
        // team already holds — but nothing new is ever written into them, and
        // the form no longer offers them.
        phone: existingMember.phone,
        discord: existingMember.discord,
        riotId: existingMember.riotId,
        emailNormalized: member.email,
        inviteStatus: existingMember.inviteStatus,
        // Dropped rather than carried over. Any hash still on an old row
        // authorizes nothing now, and a secret that has stopped meaning
        // anything is not worth keeping a copy of.
        inviteTokenHash: null,
        inviteSentAt: existingMember.inviteSentAt,
        inviteExpiresAt: existingMember.inviteExpiresAt,
        inviteRespondedAt: existingMember.inviteRespondedAt,
      };
    }

    const memberId = crypto.randomUUID();
    inviteDispatches.push({
      invitationId: memberId,
      emailNormalized: member.email,
      recipientName: member.name,
      teamName: name,
      captainName,
      tournamentTitle: null,
      sentAt: inviteSentAt,
    });
    return {
      id: memberId,
      teamId,
      ...member,
      emailNormalized: member.email,
      inviteStatus: "pending",
      inviteTokenHash: null,
      inviteSentAt,
      inviteExpiresAt,
    };
  });

  try {
    const transactionResult = await runTeamSyncTransaction(async (tx) => {
      const currentTeam = logoMutationRequested
        ? await tx.savedTeam.findUnique({
            where: { id: teamId },
            select: { logoName: true },
          })
        : null;
      const previousLogoName = currentTeam?.logoName ?? null;

      await tx.savedTeam.update({
        where: { id: teamId },
        data: savedTeamData,
      });
      if (logoMutationRequested) {
        await tx.teamRegistration.updateMany({
          where: { savedTeamId: teamId },
          data: { teamLogoName: nextLogoName },
        });
      }
      await tx.savedTeamMember.deleteMany({
        where: { teamId, role: { not: "CAPTAIN" } },
      });
      if (memberRecords.length > 0) {
        await tx.savedTeamMember.createMany({ data: memberRecords });
      }
      await carryEmailChangesIntoOpenRegistrations({
        tx,
        teamId,
        emailChanges,
        inviteSentAt,
        inviteExpiresAt,
      });

      if (previousLogoName && previousLogoName !== nextLogoName) {
        await scheduleTeamLogoCleanup({
          filename: previousLogoName,
          tx,
          context: { operation: "updateSavedTeam", teamId, userId: user.id },
        });
      }

      const team = await tx.savedTeam.findUnique({
        where: { id: teamId },
        include: {
          captainUser: {
            select: { firstName: true, lastName: true, username: true },
          },
          members: true,
          _count: {
            select: { registrations: true },
          },
        },
      });

      return { team, previousLogoName };
    });

    const { team } = transactionResult;
    await sendTeamInvites(inviteDispatches);
    const [readyTeam] = await attachRosterReadiness([mapSavedTeam(team, user.id)]);
    return readyTeam;
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "updateSavedTeamRollback", teamId, userId: user.id }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "A team or member already uses these details.");
    }
    throw error;
  }
};

const deleteSavedTeam = async ({ teamId, user }) => {
  const team = await prisma.savedTeam.findFirst({
    where: { id: teamId, captainUserId: user.id },
    select: {
      id: true,
      logoName: true,
      _count: { select: { registrations: true } },
    },
  });
  if (!team) {
    throw new HttpError(404, "Team not found or you do not have permission to delete it.");
  }
  if (team._count.registrations > 0) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has a tournament registration."
    );
  }

  const activeBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId: team.id, status: "active" },
    select: { id: true },
  });
  if (activeBinding) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first."
    );
  }

  await prisma.savedTeam.delete({ where: { id: team.id } });
  if (team.logoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: team.logoName,
      context: { operation: "deleteSavedTeam", teamId, userId: user.id },
    });
  }
};

module.exports = {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
};
