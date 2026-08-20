const { HttpError } = require("../../lib/http-error");
const { normalizeEmail, normalizeText } = require("../../lib/validation");
const { buildActiveRegistrationWhere } = require("./registration-eligibility");

const COACH_PLAYER_ROLE_CONFLICT_MESSAGE =
  "This person cannot be both a coach and a player in the same tournament.";

const getRoleConflictIdentities = (members = []) => {
  const coaches = members.filter((member) => member?.role === "COACH");
  const players = members.filter((member) =>
    ["CAPTAIN", "PLAYER", "SUBSTITUTE"].includes(member?.role)
  );
  return {
    coaches: {
      emails: new Set(
        coaches
          .map((member) => normalizeEmail(member.emailNormalized || member.email))
          .filter(Boolean)
      ),
      riotIds: new Set(
        coaches
          .map((member) => normalizeText(member.riotId).toLowerCase())
          .filter(Boolean)
      ),
    },
    players: {
      emails: new Set(
        players
          .map((member) => normalizeEmail(member.emailNormalized || member.email))
          .filter(Boolean)
      ),
      riotIds: new Set(
        players
          .map((member) => normalizeText(member.riotId).toLowerCase())
          .filter(Boolean)
      ),
    },
  };
};

const hasIdentityIntersection = (left, right) => {
  for (const identity of left) {
    if (right.has(identity)) return true;
  }
  return false;
};

const assertNoLocalCoachPlayerRoleConflict = (members = []) => {
  const identities = getRoleConflictIdentities(members);
  if (
    hasIdentityIntersection(identities.coaches.emails, identities.players.emails) ||
    hasIdentityIntersection(identities.coaches.riotIds, identities.players.riotIds)
  ) {
    throw new HttpError(409, COACH_PLAYER_ROLE_CONFLICT_MESSAGE);
  }
};

const assertNoCoachPlayerRoleConflict = async ({
  tx,
  tournamentId,
  members,
  excludeRegistrationId = null,
  now = new Date(),
}) => {
  assertNoLocalCoachPlayerRoleConflict(members);

  const activeRegistrations = await tx.teamRegistration.findMany({
    where: {
      tournamentId,
      ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
      ...buildActiveRegistrationWhere({ now }),
    },
    select: {
      members: {
        select: {
          role: true,
          email: true,
          emailNormalized: true,
          riotId: true,
        },
      },
    },
  });

  const submitted = getRoleConflictIdentities(members);
  for (const registration of activeRegistrations) {
    const existing = getRoleConflictIdentities(registration.members);
    if (
      hasIdentityIntersection(submitted.coaches.emails, existing.players.emails) ||
      hasIdentityIntersection(submitted.coaches.riotIds, existing.players.riotIds) ||
      hasIdentityIntersection(submitted.players.emails, existing.coaches.emails) ||
      hasIdentityIntersection(submitted.players.riotIds, existing.coaches.riotIds)
    ) {
      throw new HttpError(409, COACH_PLAYER_ROLE_CONFLICT_MESSAGE);
    }
  }
};

module.exports = {
  COACH_PLAYER_ROLE_CONFLICT_MESSAGE,
  assertNoLocalCoachPlayerRoleConflict,
  assertNoCoachPlayerRoleConflict,
  getRoleConflictIdentities,
};
