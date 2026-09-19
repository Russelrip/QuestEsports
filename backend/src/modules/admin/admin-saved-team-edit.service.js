const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly, scheduleTeamLogoCleanup } = require("../../lib/upload-cleanup");
const { persistTeamLogoUpload, teamLogoDirectory } = require("../../middleware/upload");
const { normalizeEmail, normalizeText, isValidEmail } = require("../../lib/validation");
const { isRegistrationActive } = require("../tournaments/registration-eligibility");
const { buildShortCode } = require("../tournaments/bracket.service");
const {
  runAdminSerializable,
  assertAdminRoleConflict,
  syncGameIdentityData,
} = require("./admin-shared");
const { getAdminSavedTeamById } = require("./admin-saved-teams.service");

const parseAdminTeamMembers = (value) => {
  const validateMembers = (parsed) => {
    const coachCount = parsed.filter(
      (member) => normalizeText(member?.role).toUpperCase() === "COACH"
    ).length;
    if (coachCount > 1) {
      throw new HttpError(400, "A saved team can include at most one coach.");
    }
    return parsed;
  };
  if (Array.isArray(value)) return validateMembers(value);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return validateMembers(parsed);
    }
  } catch {
    // Use the same client-safe validation error for malformed multipart JSON.
  }
  throw new HttpError(400, "Team members must be a valid array.");
};

const syncBracketTeamName = (bracket, registrationIds, name) => {
  let changed = false;
  const shortCode = buildShortCode(name);
  const updateEntry = (entry, registrationId) => {
    if (!entry || !registrationIds.has(registrationId)) return entry;
    if (entry.name === name && entry.shortCode === shortCode) return entry;
    changed = true;
    return { ...entry, name, shortCode };
  };
  const seedData = Array.isArray(bracket.seedData)
    ? bracket.seedData.map((seed) => updateEntry(seed, seed?.id))
    : bracket.seedData;
  const bracketData = Array.isArray(bracket.bracketData?.participant)
    ? {
        ...bracket.bracketData,
        participant: bracket.bracketData.participant.map((participant) =>
          updateEntry(participant, participant?.registrationId)
        ),
      }
    : bracket.bracketData;

  return { changed, seedData, bracketData };
};

const syncScheduleTeamName = (scheduleData, previousNames, name) => {
  if (!Array.isArray(scheduleData?.rows) || previousNames.size === 0) {
    return { changed: false, scheduleData };
  }

  let changed = false;
  const rows = scheduleData.rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (typeof value === "string" && previousNames.has(value) && value !== name) {
        changed = true;
        return [key, name];
      }
      return [key, value];
    }));
  });

  return {
    changed,
    scheduleData: changed ? { ...scheduleData, rows } : scheduleData,
  };
};

const updateAdminSavedTeam = async (teamId, body, file) => {
  const name = normalizeText(body.name);
  const teamTag = normalizeText(body.teamTag) || null;
  const country = normalizeText(body.country) || null;
  const organization = normalizeText(body.organizationName);
  const organizationName = organization && organization.toLowerCase() !== "independent" ? organization : null;
  const members = parseAdminTeamMembers(body.members);
  const removeLogo = ["true", "1", "on"].includes(normalizeText(body.removeLogo).toLowerCase());

  if (!name || name.length > 120) throw new HttpError(400, "Team name is required and must be 120 characters or fewer.");
  if (teamTag && teamTag.length > 20) throw new HttpError(400, "Team tag must be 20 characters or fewer.");
  if (country && country.length > 100) throw new HttpError(400, "Country must be 100 characters or fewer.");
  if (organization.length > 120) throw new HttpError(400, "Organization name is too long.");
  if (members.length > 20) throw new HttpError(400, "A team can include up to 20 members.");

  const existing = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, logoName: true, members: { select: { id: true, role: true } } },
  });
  if (!existing) throw new HttpError(404, "Team not found.");
  const memberIds = new Set(existing.members.map((member) => member.id));
  const existingRolesById = new Map(existing.members.map((member) => [member.id, member.role]));
  const normalizedMembers = members.map((member) => ({
    id: normalizeText(member.id),
    role: normalizeText(member.role).toUpperCase() || null,
    name: normalizeText(member.name),
    email: normalizeEmail(member.email),
    phone: normalizeText(member.phone) || null,
    discord: normalizeText(member.discord) || null,
    riotId: normalizeText(member.riotId || member.gameId) || null,
  }));
  const coachCount = normalizedMembers.filter(
    (member) => (member.role || existingRolesById.get(member.id)) === "COACH"
  ).length;
  if (coachCount > 1) throw new HttpError(400, "A saved team can include at most one coach.");
  if (normalizedMembers.some((member) => !memberIds.has(member.id))) throw new HttpError(400, "One or more roster members do not belong to this team.");
  if (normalizedMembers.some((member) => !member.name || member.name.length > 120)) throw new HttpError(400, "Each roster member needs a name of 120 characters or fewer.");
  if (normalizedMembers.some((member) => !isValidEmail(member.email) || member.email.length > 254)) throw new HttpError(400, "Each roster member needs a valid email address.");
  if (normalizedMembers.some((member) => member.phone && member.phone.length > 50)) throw new HttpError(400, "Roster member phone must be 50 characters or fewer.");
  if (normalizedMembers.some((member) => member.discord && member.discord.length > 100)) throw new HttpError(400, "Roster member Discord must be 100 characters or fewer.");
  if (normalizedMembers.some((member) => member.riotId && member.riotId.length > 100)) throw new HttpError(400, "Roster member Riot ID must be 100 characters or fewer.");
  if (new Set(normalizedMembers.map((member) => member.email)).size !== normalizedMembers.length) throw new HttpError(400, "Roster member emails must be unique.");

  const persistedLogo = file ? await persistTeamLogoUpload(file) : null;
  const logoMutationRequested = Boolean(file) || removeLogo;
  const nextLogoName = file
    ? persistedLogo.filename
    : removeLogo
      ? null
      : existing.logoName;
  const savedTeamData = { name, teamTag, country, organizationName };
  if (logoMutationRequested) savedTeamData.logoName = nextLogoName;
  // Record an explicit removal so the null logo reads as deliberate and a later
  // registration upload cannot resurrect it.
  if (logoMutationRequested && nextLogoName === null) savedTeamData.logoClearedAt = new Date();
  const registrationData = { teamName: name };
  if (logoMutationRequested) registrationData.teamLogoName = nextLogoName;

  try {
    await runAdminSerializable(async (tx) => {
      const currentTeam = logoMutationRequested
        ? await tx.savedTeam.findUnique({
            where: { id: teamId },
            select: { logoName: true },
          })
        : null;
      const previousLogoName = currentTeam?.logoName ?? null;
      const linkedRegistrations = await tx.teamRegistration.findMany({
        where: { savedTeamId: teamId },
        select: { id: true, tournamentId: true, teamName: true },
      });
      await tx.savedTeam.update({
        where: { id: teamId },
        data: savedTeamData,
      });
      for (const member of normalizedMembers) {
        await tx.savedTeamMember.update({
          where: { id: member.id },
          data: { name: member.name, email: member.email, emailNormalized: member.email, phone: member.phone, discord: member.discord, riotId: member.riotId },
        });
      }

      if (linkedRegistrations.length > 0) {
        await tx.teamRegistration.updateMany({
          where: { savedTeamId: teamId },
          data: registrationData,
        });

        if (existing.name !== name) {
          const registrationIds = new Set(linkedRegistrations.map((registration) => registration.id));
          const tournamentIds = [...new Set(linkedRegistrations.map((registration) => registration.tournamentId))];
          const previousNames = new Set([
            existing.name,
            ...linkedRegistrations.map((registration) => registration.teamName),
          ].filter((previousName) => previousName && previousName !== name));
          const brackets = await tx.tournamentBracket.findMany({
            where: { tournamentId: { in: tournamentIds } },
            select: { id: true, seedData: true, bracketData: true },
          });
          for (const bracket of brackets) {
            const synced = syncBracketTeamName(bracket, registrationIds, name);
            if (synced.changed) {
              await tx.tournamentBracket.update({
                where: { id: bracket.id },
                data: { seedData: synced.seedData, bracketData: synced.bracketData },
              });
            }
          }

          const tournaments = await tx.tournament.findMany({
            where: { id: { in: tournamentIds }, scheduleData: { not: Prisma.JsonNull } },
            select: { id: true, scheduleData: true },
          });
          for (const tournament of tournaments) {
            const synced = syncScheduleTeamName(tournament.scheduleData, previousNames, name);
            if (synced.changed) {
              await tx.tournament.update({
                where: { id: tournament.id },
                data: { scheduleData: synced.scheduleData },
              });
            }
          }
        }
      }
      if (previousLogoName && previousLogoName !== nextLogoName) {
        await scheduleTeamLogoCleanup({
          filename: previousLogoName,
          tx,
          context: { operation: "updateAdminSavedTeam", teamId },
        });
      }
      return { previousLogoName };
    });
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "updateAdminSavedTeamRollback", teamId }
      );
    }
    if (error?.code === "P2002") throw new HttpError(409, "That team name, roster email, or role position is already in use.");
    throw error;
  }
  return getAdminSavedTeamById(teamId);
};

const transferAdminSavedTeamCaptain = async ({ teamId, memberId }) => {
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId) throw new HttpError(400, "Choose a roster member to become captain.");

  try {
    const transfer = await prisma.$transaction(async (tx) => {
      const team = await tx.savedTeam.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          name: true,
          captainUserId: true,
          captainUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              email: true,
              emailNormalized: true,
            },
          },
          members: {
            select: {
              id: true,
              userId: true,
              role: true,
              memberOrder: true,
              name: true,
              email: true,
              emailNormalized: true,
              discord: true,
              riotId: true,
              inviteStatus: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  emailNormalized: true,
                  emailVerified: true,
                  phone: true,
                  discordTag: true,
                },
              },
            },
          },
          registrations: {
            select: {
              id: true,
              tournamentId: true,
              status: true,
              paymentStatus: true,
              reservedUntil: true,
              captainEmail: true,
              additionalData: true,
              tournament: {
                select: {
                  title: true,
                  game: true,
                  registrationFields: true,
                },
              },
              members: {
                select: {
                  id: true,
                  userId: true,
                  role: true,
                  name: true,
                  email: true,
                  emailNormalized: true,
                  discord: true,
                  riotId: true,
                  additionalData: true,
                  inviteStatus: true,
                },
              },
            },
          },
        },
      });
      if (!team) throw new HttpError(404, "Team not found.");

      const formerCaptain = team.members.find((member) => member.role === "CAPTAIN");
      const candidate = team.members.find((member) => member.id === normalizedMemberId);
      if (!formerCaptain) throw new HttpError(409, "This team does not have a valid captain roster record.");
      if (!candidate) throw new HttpError(404, "The selected roster member was not found on this team.");
      if (candidate.role === "CAPTAIN" || candidate.id === formerCaptain.id) {
        throw new HttpError(409, "That roster member is already the team captain.");
      }
      if (candidate.inviteStatus !== "accepted" || !candidate.userId || !candidate.user) {
        throw new HttpError(409, "The new captain must accept their team invitation with a linked Quest account first.");
      }
      if (!candidate.user.emailVerified) {
        throw new HttpError(409, "The new captain must verify their Quest account email first.");
      }
      if (candidate.user.id !== candidate.userId || candidate.user.emailNormalized !== candidate.emailNormalized) {
        throw new HttpError(409, "The selected roster member is not linked to the matching Quest account.");
      }

      const newCaptainEmail = candidate.user.emailNormalized;
      const newCaptainPhone = normalizeText(candidate.user.phone);
      if (team.registrations.length > 0 && !newCaptainPhone) {
        throw new HttpError(409, "The new captain must add a phone number to their Quest profile before registered teams can be transferred.");
      }

      const ownedTeamConflict = await tx.savedTeam.findFirst({
        where: {
          id: { not: team.id },
          captainUserId: candidate.user.id,
          name: team.name,
        },
        select: { id: true },
      });
      if (ownedTeamConflict) {
        throw new HttpError(409, "The new captain already owns another saved team with this name.");
      }

      if (team.registrations.length > 0) {
        const registrationConflict = await tx.teamRegistration.findFirst({
          where: {
            id: { notIn: team.registrations.map((registration) => registration.id) },
            tournamentId: { in: team.registrations.map((registration) => registration.tournamentId) },
            captainEmail: newCaptainEmail,
          },
          select: { tournament: { select: { title: true } } },
        });
        if (registrationConflict) {
          throw new HttpError(409, `The new captain already has a registration in ${registrationConflict.tournament.title}.`);
        }
      }

      const registrationTransfers = team.registrations.map((registration) => {
        const currentCaptain = registration.members.find((member) => member.role === "CAPTAIN");
        const nextCaptain = registration.members.find((member) =>
          member.id !== currentCaptain?.id &&
          (member.userId === candidate.user.id || member.emailNormalized === newCaptainEmail)
        );
        if (!currentCaptain) {
          throw new HttpError(409, `${registration.tournament.title} does not have a valid captain roster record.`);
        }
        if (!nextCaptain) {
          throw new HttpError(409, `${candidate.name} is not on the saved roster for ${registration.tournament.title}.`);
        }
        if (nextCaptain.inviteStatus !== "accepted") {
          throw new HttpError(409, `${candidate.name} must have an accepted roster place in ${registration.tournament.title}.`);
        }
        const discord = normalizeText(nextCaptain.discord || candidate.discord || candidate.user.discordTag);
        const riotId = normalizeText(nextCaptain.riotId || candidate.riotId);
        if (!discord || !riotId) {
          throw new HttpError(409, `${candidate.name} needs a Discord handle and Game ID for ${registration.tournament.title}.`);
        }
        return { registration, currentCaptain, nextCaptain, discord, riotId };
      });

      for (const item of registrationTransfers) {
        if (!isRegistrationActive(item.registration)) continue;
        const { registration, currentCaptain, nextCaptain, discord, riotId } = item;
        const proposedMembers = registration.members
          .filter((member) => member.id !== currentCaptain.id)
          .map((member) => member.id === nextCaptain.id
            ? {
                ...member,
                userId: candidate.user.id,
                role: "CAPTAIN",
                memberOrder: 0,
                name: nextCaptain.name || candidate.name,
                email: candidate.user.email,
                emailNormalized: newCaptainEmail,
                discord,
                riotId,
              }
            : member);
        await assertAdminRoleConflict({
          tx,
          tournamentId: registration.tournamentId,
          members: proposedMembers,
          excludeRegistrationId: registration.id,
        });
      }

      await tx.savedTeamMember.delete({ where: { id: formerCaptain.id } });
      await tx.savedTeamMember.update({
        where: { id: candidate.id },
        data: {
          userId: candidate.user.id,
          role: "CAPTAIN",
          memberOrder: 0,
          email: candidate.user.email,
          emailNormalized: newCaptainEmail,
          inviteStatus: "accepted",
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
      await tx.savedTeam.update({
        where: { id: team.id },
        data: { captainUserId: candidate.user.id },
      });

      for (const item of registrationTransfers) {
        const { registration, currentCaptain, nextCaptain, discord, riotId } = item;
        const entryData = syncGameIdentityData({
          additionalData: registration.additionalData,
          registrationFields: registration.tournament.registrationFields,
          scope: "entry",
          game: registration.tournament.game,
          gameId: riotId,
        });
        const memberData = syncGameIdentityData({
          additionalData: nextCaptain.additionalData,
          registrationFields: registration.tournament.registrationFields,
          scope: "member",
          game: registration.tournament.game,
          gameId: riotId,
        });

        await tx.registrationMember.delete({ where: { id: currentCaptain.id } });
        await tx.registrationMember.update({
          where: { id: nextCaptain.id },
          data: {
            userId: candidate.user.id,
            role: "CAPTAIN",
            memberOrder: 0,
            name: nextCaptain.name || candidate.name,
            email: candidate.user.email,
            emailNormalized: newCaptainEmail,
            discord,
            riotId,
            inviteStatus: "accepted",
            inviteTokenHash: null,
            inviteExpiresAt: null,
            ...(memberData.changed ? { additionalData: memberData.data } : {}),
          },
        });
        await tx.teamRegistration.update({
          where: { id: registration.id },
          data: {
            userId: candidate.user.id,
            captainName: nextCaptain.name || candidate.name,
            captainEmail: newCaptainEmail,
            captainPhone: newCaptainPhone,
            captainDiscord: discord,
            captainRiotId: riotId,
            contactEmail: newCaptainEmail,
            ...(entryData.changed ? { additionalData: entryData.data } : {}),
          },
        });
      }

      const formerCaptainName = [
        team.captainUser.firstName,
        team.captainUser.lastName,
      ].filter(Boolean).join(" ").trim() || team.captainUser.username;
      return {
        before: {
          captainUserId: team.captainUserId,
          captainName: formerCaptainName,
          captainEmail: team.captainUser.emailNormalized,
        },
        after: {
          captainUserId: candidate.user.id,
          captainName: candidate.name,
          captainEmail: newCaptainEmail,
        },
        removedMemberId: formerCaptain.id,
        registrationIds: team.registrations.map((registration) => registration.id),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      team: await getAdminSavedTeamById(teamId),
      transfer,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      throw new HttpError(409, "The captain transfer conflicts with an existing team or tournament registration.");
    }
    if (error?.code === "P2034") {
      throw new HttpError(409, "The team changed while the captain was being transferred. Reload the team and try again.");
    }
    throw error;
  }
};

module.exports = {
  updateAdminSavedTeam,
  transferAdminSavedTeamCaptain,
};
