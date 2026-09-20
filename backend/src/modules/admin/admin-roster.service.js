const crypto = require("crypto");
const { HttpError } = require("../../lib/http-error");
const { normalizeEmail, normalizeText, isValidEmail } = require("../../lib/validation");
const { recordAuditInTransaction } = require("../../lib/audit");
const { normalizeCoachSubmission } = require("../tournaments/coach.validation");
const { maybeAutoApproveRegistration } = require("../tournaments/auto-approval.service");
const {
  runAdminSerializable,
  assertAdminRoleConflict,
  syncGameIdentityData,
} = require("./admin-shared");
const { getAdminTeamRegistrationById } = require("./admin-registrations.service");

const ADMIN_ROSTER_ROLES = new Set(["CAPTAIN", "PLAYER", "SUBSTITUTE"]);

const hasOwnProperty = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const mapCoachDraft = (member) => member
  ? {
      name: member.name,
      email: member.email,
      phone: member.phone,
      discord: member.discord,
      riotId: member.riotId,
    }
  : null;

const normalizeAdminCoach = ({ body, tournament, currentCoach }) => {
  if (!hasOwnProperty(body, "coach")) {
    if (tournament.coachRequired && !currentCoach) {
      throw new HttpError(400, "A complete coach is required for this tournament.");
    }
    return mapCoachDraft(currentCoach);
  }

  if (body.coach === null) {
    return normalizeCoachSubmission({ tournament, body, coachInput: null });
  }

  return normalizeCoachSubmission({ tournament, body, coachInput: body.coach });
};

const normalizeAdminRosterMembers = (body = {}) => {
  const requestedMembers = Array.isArray(body.members) ? body.members : [];
  if (requestedMembers.length < 1 || requestedMembers.length > 20) {
    throw new HttpError(400, "A registration must include a captain and can include up to 20 roster members.");
  }

  const roleCounts = { CAPTAIN: 0, PLAYER: 0, SUBSTITUTE: 0 };
  const members = requestedMembers.map((member) => {
    const role = normalizeText(member?.role).toUpperCase();
    if (!ADMIN_ROSTER_ROLES.has(role)) {
      throw new HttpError(400, "Roster corrections may only include a captain, players, and substitutes.");
    }
    roleCounts[role] += 1;
    return {
      id: normalizeText(member?.id) || null,
      role,
      memberOrder: role === "CAPTAIN" ? 0 : roleCounts[role],
      name: normalizeText(member?.name),
      email: normalizeEmail(member?.email),
      discord: normalizeText(member?.discord),
      riotId: normalizeText(member?.gameId || member?.riotId),
    };
  });

  if (members.some((member) =>
    !member.name ||
    !isValidEmail(member.email) ||
    !member.discord ||
    !member.riotId ||
    member.name.length > 100 ||
    member.email.length > 254 ||
    member.discord.length > 100 ||
    member.riotId.length > 100
  )) {
    throw new HttpError(400, "Every roster member needs a valid name, email, Discord username, and Game ID.");
  }

  if (new Set(members.map((member) => member.email)).size !== members.length) {
    throw new HttpError(400, "Roster member emails must be unique.");
  }
  if (roleCounts.CAPTAIN !== 1) {
    throw new HttpError(400, "The corrected roster must include exactly one captain.");
  }

  return members;
};

const correctTeamRegistrationRoster = async (registrationId, body = {}, auditContext = {}) => {
  const requestedMembers = normalizeAdminRosterMembers(body);
  const syncSavedTeam = body.syncSavedTeam === true;
  const respondedAt = new Date();

  const correction = await runAdminSerializable(async (tx) => {
    const registration = await tx.teamRegistration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            game: true,
            registrationFields: true,
            minRosterSize: true,
            maxRosterSize: true,
            maxSubstitutes: true,
            allowCoach: true,
            coachRequired: true,
          },
        },
        members: { orderBy: [{ role: "asc" }, { memberOrder: "asc" }] },
        savedTeam: {
          include: {
            members: true,
            registrations: { select: { id: true } },
          },
        },
      },
    });
    if (!registration) throw new HttpError(404, "Team registration not found.");
    if (registration.entryType === "solo") {
      throw new HttpError(409, "Solo registrations do not have a team roster to correct.");
    }
    if (syncSavedTeam && !registration.savedTeam) {
      throw new HttpError(409, "This registration is not linked to a saved team.");
    }

    const currentCaptain = registration.members.find((member) => member.role === "CAPTAIN");
    if (!currentCaptain) throw new HttpError(409, "This registration does not have a valid captain roster record.");
    const currentCoach = registration.members.find((member) => member.role === "COACH");
    const requestedCoach = normalizeAdminCoach({
      body,
      tournament: registration.tournament,
      currentCoach,
    });
    const requestedCaptain = requestedMembers.find((member) => member.role === "CAPTAIN");
    const currentCaptainEmail = normalizeEmail(registration.captainEmail || currentCaptain.email);
    const captainChanged = requestedCaptain.email !== currentCaptainEmail;
    if (captainChanged && registration.savedTeam && !syncSavedTeam) {
      throw new HttpError(409, "Changing the captain of a linked registration also requires saved-team synchronization.");
    }
    if (
      captainChanged &&
      syncSavedTeam &&
      registration.savedTeam.registrations.some((linkedRegistration) => linkedRegistration.id !== registrationId)
    ) {
      throw new HttpError(
        409,
        "This saved team is linked to other registrations. Use the full team captain-transfer action before correcting this tournament roster."
      );
    }

    const playerCount = requestedMembers.filter((member) => member.role === "CAPTAIN" || member.role === "PLAYER").length;
    const substituteCount = requestedMembers.filter((member) => member.role === "SUBSTITUTE").length;
    if (
      playerCount < registration.tournament.minRosterSize ||
      playerCount > registration.tournament.maxRosterSize ||
      substituteCount > registration.tournament.maxSubstitutes
    ) {
      const requiredPlayers = registration.tournament.minRosterSize === registration.tournament.maxRosterSize
        ? `exactly ${registration.tournament.minRosterSize}`
        : `${registration.tournament.minRosterSize}-${registration.tournament.maxRosterSize}`;
      throw new HttpError(
        400,
        `This event requires ${requiredPlayers} active players, including the captain, and allows up to ${registration.tournament.maxSubstitutes} substitutes. The corrected roster has ${playerCount} active players and ${substituteCount} substitutes.`
      );
    }

    const requestedEmails = requestedMembers.map((member) => member.email);
    const users = requestedEmails.length > 0
      ? await tx.user.findMany({
          where: { emailNormalized: { in: requestedEmails } },
          select: {
            id: true,
            email: true,
            emailNormalized: true,
            emailVerified: true,
            phone: true,
          },
        })
      : [];
    const usersByEmail = new Map(users.map((user) => [user.emailNormalized, user]));
    const missingAccounts = requestedEmails.filter((email) => !usersByEmail.get(email)?.emailVerified);
    if (missingAccounts.length > 0) {
      throw new HttpError(
        409,
        `Every corrected roster member must have a verified Quest account. Missing or unverified: ${missingAccounts.join(", ")}.`
      );
    }
    const captainAccount = usersByEmail.get(requestedCaptain.email);
    if (captainChanged && !normalizeText(captainAccount.phone)) {
      throw new HttpError(409, "The new captain must add a phone number to their Quest profile first.");
    }

    const tournamentConflicts = requestedEmails.length > 0
      ? await tx.registrationMember.findMany({
          where: {
            registrationId: { not: registrationId },
            role: { not: "COACH" },
            emailNormalized: { in: requestedEmails },
            registration: {
              tournamentId: registration.tournamentId,
              status: { notIn: ["rejected", "waitlisted"] },
            },
          },
          select: { emailNormalized: true, registration: { select: { teamName: true } } },
        })
      : [];
    if (tournamentConflicts.length > 0) {
      const conflict = tournamentConflicts[0];
      throw new HttpError(
        409,
        `${conflict.emailNormalized} is already registered for this tournament with ${conflict.registration.teamName}.`
      );
    }

    const existingById = new Map(registration.members.map((member) => [member.id, member]));
    const getInviteState = (existingMember) => ({
      inviteStatus: existingMember?.inviteStatus || "accepted",
      inviteTokenHash: existingMember?.inviteTokenHash ?? null,
      inviteSentAt: existingMember?.inviteSentAt ?? null,
      inviteExpiresAt: existingMember?.inviteExpiresAt ?? null,
      inviteRespondedAt: existingMember ? existingMember.inviteRespondedAt ?? null : respondedAt,
    });
    const registrationFields = Array.isArray(registration.tournament.registrationFields)
      ? registration.tournament.registrationFields
      : [];
    const nextMembers = requestedMembers.map((member) => {
      const account = usersByEmail.get(member.email);
      const existingMember = member.id ? existingById.get(member.id) : null;
      const memberData = syncGameIdentityData({
        additionalData: existingMember?.additionalData,
        registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId: member.riotId,
      });
      return {
        id: crypto.randomUUID(),
        registrationId,
        userId: account.id,
        role: member.role,
        memberOrder: member.memberOrder,
        name: member.name,
        email: account.email,
        emailNormalized: account.emailNormalized,
        discord: member.discord,
        riotId: member.riotId,
        additionalData: memberData.data,
        ...getInviteState(existingMember),
      };
    });
    if (requestedCoach) {
      const coachData = syncGameIdentityData({
        additionalData: currentCoach?.additionalData,
        registrationFields,
        scope: "member",
        game: registration.tournament.game,
        gameId: requestedCoach.riotId,
      });
      nextMembers.push({
        id: crypto.randomUUID(),
        registrationId,
        userId: null,
        role: "COACH",
        memberOrder: 1,
        name: requestedCoach.name,
        email: requestedCoach.email,
        emailNormalized: requestedCoach.email,
        phone: requestedCoach.phone,
        discord: requestedCoach.discord,
        riotId: requestedCoach.riotId,
        additionalData: coachData.data,
        ...getInviteState(currentCoach),
      });
    }

    await assertAdminRoleConflict({
      tx,
      tournamentId: registration.tournament.id,
      members: nextMembers,
      excludeRegistrationId: registrationId,
    });

    const before = registration.members.map((member) => ({
      id: member.id,
      role: member.role,
      name: member.name,
      email: member.email,
      riotId: member.riotId,
    }));

    const nextCaptain = nextMembers.find((member) => member.role === "CAPTAIN");
    const entryData = syncGameIdentityData({
      additionalData: registration.additionalData,
      registrationFields,
      scope: "entry",
      game: registration.tournament.game,
      gameId: nextCaptain.riotId,
    });
    const rosterMembers = nextMembers.filter((member) => member.role !== "CAPTAIN");
    const verificationStatus = rosterMembers.some((member) => member.inviteStatus === "declined")
      ? "flagged"
      : nextMembers.length > 0 && rosterMembers.every((member) => member.inviteStatus === "accepted")
        ? "verified"
        : "pending";

    await tx.registrationMember.deleteMany({ where: { registrationId } });
    await tx.registrationMember.createMany({ data: nextMembers });
    await tx.teamRegistration.update({
      where: { id: registrationId },
      data: {
        userId: nextCaptain.userId,
        captainName: nextCaptain.name,
        captainEmail: nextCaptain.emailNormalized,
        captainPhone: captainChanged ? normalizeText(captainAccount.phone) : registration.captainPhone,
        captainDiscord: nextCaptain.discord,
        captainRiotId: nextCaptain.riotId,
        contactEmail: captainChanged ? nextCaptain.emailNormalized : registration.contactEmail,
        verificationStatus,
        ...(entryData.changed ? { additionalData: entryData.data } : {}),
      },
    });

    if (syncSavedTeam) {
      const savedCaptain = registration.savedTeam.members.find((member) => member.role === "CAPTAIN");
      if (!savedCaptain || savedCaptain.emailNormalized !== currentCaptainEmail) {
        throw new HttpError(409, "The linked saved team and registration do not have the same captain.");
      }
      if (captainChanged) {
        const ownedTeamConflict = await tx.savedTeam.findFirst({
          where: {
            id: { not: registration.savedTeam.id },
            captainUserId: nextCaptain.userId,
            name: registration.savedTeam.name,
          },
          select: { id: true },
        });
        if (ownedTeamConflict) {
          throw new HttpError(409, "The new captain already owns another saved team with this name.");
        }
      }
      const savedByEmail = new Map(
        registration.savedTeam.members.map((member) => [member.emailNormalized, member])
      );
      await tx.savedTeamMember.deleteMany({ where: { teamId: registration.savedTeam.id } });
      await tx.savedTeamMember.createMany({
        data: nextMembers.map((member) => {
          const existingMember = savedByEmail.get(member.emailNormalized);
          const inviteState = getInviteState(existingMember || member);
          return {
            id: crypto.randomUUID(),
            teamId: registration.savedTeam.id,
            userId: member.userId,
            role: member.role,
            memberOrder: member.memberOrder,
            name: member.name,
            email: member.email,
            emailNormalized: member.emailNormalized,
            phone: member.phone ?? existingMember?.phone ?? null,
            discord: member.discord,
            riotId: member.riotId,
            ...inviteState,
          };
        }),
      });
      if (captainChanged) {
        await tx.savedTeam.update({
          where: { id: registration.savedTeam.id },
          data: { captainUserId: nextCaptain.userId },
        });
      }
    }

    const audit = {
      actorUserId: auditContext.actorUserId || null,
      action: "team_registration.roster_corrected",
      targetType: "TeamRegistration",
      targetId: registrationId,
      beforeData: { members: before },
      afterData: {
        members: nextMembers.map((member) => ({
          id: member.id,
          role: member.role,
          name: member.name,
          email: member.email,
          riotId: member.riotId,
        })),
        savedTeamId: syncSavedTeam ? registration.savedTeam.id : null,
        captainChanged,
      },
      requestId: auditContext.requestId || null,
      ipAddress: auditContext.ipAddress || null,
    };
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, audit);
    }

    // A correction that leaves every invitation accepted, such as dropping an
    // expired member, is the same settling moment as an accepted invitation.
    if (verificationStatus === "verified") {
      await maybeAutoApproveRegistration({
        tx,
        registrationId,
        requestId: auditContext.requestId || null,
        ipAddress: auditContext.ipAddress || null,
      });
    }

    return {
      before,
      after: nextMembers.map((member) => ({
          id: member.id,
          role: member.role,
          name: member.name,
          email: member.email,
          riotId: member.riotId,
        })),
      savedTeamId: syncSavedTeam ? registration.savedTeam.id : null,
      captainChanged,
    };
  });

  return {
    registration: await getAdminTeamRegistrationById(registrationId),
    correction,
  };
};

module.exports = {
  correctTeamRegistrationRoster,
};
