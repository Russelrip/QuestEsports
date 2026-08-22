const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { publicView, VALORANT } = require("./game-account.service");

// Which stable game identity a tournament needs. `Tournament.game` is free text
// and always has been, so it is normalized here rather than anywhere a caller
// might forget to. A title Quest has no adapter for simply imposes no game
// account requirement — it must not block registration on a check that cannot
// be performed.
const requiredGameFor = (game) => {
  const normalized = String(game || "").trim().toLowerCase();
  return normalized === VALORANT ? VALORANT : null;
};

const PASS = "PASS";
const FAIL = "FAIL";

// Roles that must field a competing account. A coach is on the roster but does
// not play, so requiring a game account from them would block real teams.
const COMPETING_ROLES = new Set(["CAPTAIN", "PLAYER", "SUBSTITUTE"]);

const memberView = (member, requiredGame) => {
  const account = member.player?.gameAccounts?.[0] ?? null;
  const competing = COMPETING_ROLES.has(member.role);
  const inviteAccepted = member.inviteStatus === "accepted";
  const needsAccount = competing && Boolean(requiredGame);

  return {
    id: member.id,
    name: member.name,
    role: member.role,
    memberOrder: member.memberOrder,
    inviteStatus: member.inviteStatus,
    hasQuestAccount: Boolean(member.userId),
    gameAccount: account ? publicView(account) : null,
    // A legacy roster row may still carry a typed Riot ID. It is shown so a
    // captain can see what the old registration used, but it never satisfies
    // the requirement: it was never checked against anything.
    legacyRiotId: member.riotId || null,
    requiresGameAccount: needsAccount,
    ready: inviteAccepted && (!needsAccount || Boolean(account)),
  };
};

// One authoritative answer about whether a team can register, computed on the
// server. The frontend renders this; it does not recompute it. Duplicating the
// rules in the client is what produced the two-sources-of-truth status bug the
// V2 plan opens with.
const getRegistrationReadiness = async ({ teamId, tournamentId, user }) => {
  const team = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      captainUserId: true,
      game: true,
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
        select: {
          id: true,
          name: true,
          role: true,
          memberOrder: true,
          userId: true,
          riotId: true,
          inviteStatus: true,
          player: {
            select: {
              gameAccounts: {
                where: { status: { in: ["active", "locked"] } },
                orderBy: { linkedAt: "desc" },
              },
            },
          },
        },
      },
    },
  });

  if (!team) {
    throw new HttpError(404, "Team not found.");
  }

  // Roster readiness exposes every member's identity state, so it is captain or
  // admin only. Checking here rather than in the route keeps the rule with the
  // data it protects.
  const isCaptain = team.captainUserId === user.id;
  if (!isCaptain && user.role !== "admin") {
    throw new HttpError(403, "Only the team captain can view roster readiness.");
  }

  let tournament = null;
  if (tournamentId) {
    tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, game: true, minRosterSize: true, maxRosterSize: true },
    });
    if (!tournament) {
      throw new HttpError(404, "Tournament not found.");
    }
  }

  const requiredGame = requiredGameFor(tournament?.game ?? team.game);
  const members = team.members.map((member) => memberView(member, requiredGame));
  const competing = members.filter((member) => COMPETING_ROLES.has(member.role));

  const requirements = [];

  if (tournament) {
    // Count only accepted competing members: a pending invite is not a player,
    // and a coach does not fill a roster slot.
    const accepted = competing.filter((member) => member.inviteStatus === "accepted").length;
    const withinMaximum = !tournament.maxRosterSize || accepted <= tournament.maxRosterSize;
    requirements.push({
      type: "ROSTER_SIZE",
      status: accepted >= tournament.minRosterSize && withinMaximum ? PASS : FAIL,
      minimum: tournament.minRosterSize,
      maximum: tournament.maxRosterSize,
      actual: accepted,
    });
  }

  const pendingInvites = members.filter((member) => member.inviteStatus !== "accepted");
  requirements.push({
    type: "INVITES_ACCEPTED",
    status: pendingInvites.length === 0 ? PASS : FAIL,
    members: pendingInvites.map((member) => member.id),
  });

  if (requiredGame) {
    const missing = competing.filter((member) => member.requiresGameAccount && !member.gameAccount);
    requirements.push({
      type: "PLAYER_GAME_ACCOUNTS",
      status: missing.length === 0 ? PASS : FAIL,
      game: requiredGame,
      members: missing.map((member) => member.id),
    });
  }

  return {
    teamId: team.id,
    teamName: team.name,
    tournamentId: tournament?.id ?? null,
    requiredGame,
    ready: requirements.every((requirement) => requirement.status === PASS),
    requirements,
    members,
  };
};

module.exports = {
  getRegistrationReadiness,
  requiredGameFor,
  COMPETING_ROLES,
};
