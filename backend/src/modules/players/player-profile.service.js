const { prisma } = require("../../lib/prisma");

// The public player profile.
//
// Everything here is a PROJECTION, never a model dump. `registration_members`
// carries the email, phone and invite tokens a captain typed in, and `players`
// joins to a `User`; none of that is competitive information and none of it
// belongs on a public page. The rule this file follows is that a field is
// included only if it is already public elsewhere — a Riot ID appears on the
// leaderboard, a team name appears on a bracket — and everything else is
// omitted by construction rather than filtered late.
//
// The repo already draws this line: the root codemap notes that captain/contact
// data and payment evidence stay private. This is the same boundary for players.

// Only these registration roles represent competing. A coach or manager is real
// and may be listed on a roster, but "tournaments played" should not count an
// event somebody coached.
const PLAYING_ROLES = new Set(["CAPTAIN", "PLAYER", "SUBSTITUTE"]);

const mapGameAccount = (account) => ({
  game: account.game,
  // Competitive identity, already public wherever brackets and leaderboards
  // are. `externalId` (the PUUID) is deliberately absent: it is a stable
  // cross-service key, and the audit policy already treats it as sensitive.
  username: account.username,
  tagline: account.tagline,
  region: account.region,
  verificationStatus: account.verificationStatus,
});

// A tournament appears only if it is published. A draft or unpublished event is
// staff-only, and leaking one through a player's history would be a disclosure
// nobody would think to look for.
const mapTournamentEntry = (member) => {
  const registration = member.registration;
  const tournament = registration?.tournament;
  if (!tournament?.isPublished) return null;
  return {
    tournamentSlug: tournament.slug,
    tournamentTitle: tournament.title,
    game: tournament.gameRef?.slug ?? tournament.game,
    startDate: tournament.startDate,
    status: tournament.status,
    teamName: registration.teamName,
    role: member.role,
    // The name as committed to THIS tournament, from the frozen snapshot, so a
    // later rename does not rewrite history. Falls back to the live account for
    // rows that predate snapshots — a NULL snapshot means "before snapshots",
    // not "no account".
    playedAs: member.usernameSnapshot
      ? { username: member.usernameSnapshot, tagline: member.tagSnapshot }
      : null,
  };
};

const getPublicProfile = async (publicId) => {
  if (!publicId || typeof publicId !== "string") return null;

  const player = await prisma.player.findUnique({
    where: { publicId: publicId.trim().toUpperCase() },
    select: {
      publicId: true,
      displayName: true,
      createdAt: true,
      gameAccounts: {
        where: { status: "active" },
        select: {
          game: true,
          username: true,
          tagline: true,
          region: true,
          verificationStatus: true,
        },
      },
      // Presence only. A Discord snowflake is directly personally identifying
      // and links a Quest player to an account outside Quest; "reachable on
      // Discord" is the useful public fact, the ID is not.
      discordIdentity: { select: { id: true } },
      savedTeamMembers: {
        select: {
          role: true,
          team: { select: { name: true, teamTag: true, game: true } },
        },
      },
      registrationMembers: {
        select: {
          role: true,
          usernameSnapshot: true,
          tagSnapshot: true,
          registration: {
            select: {
              teamName: true,
              status: true,
              tournament: {
                select: {
                  slug: true,
                  title: true,
                  game: true,
                  startDate: true,
                  status: true,
                  isPublished: true,
                  gameRef: { select: { slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!player) return null;

  // Approved entries only. A pending or rejected registration is not a fact
  // about a player's history, and a rejected one is arguably private.
  const played = player.registrationMembers
    .filter(
      (m) =>
        PLAYING_ROLES.has(m.role) && m.registration?.status === "approved",
    )
    .map(mapTournamentEntry)
    .filter(Boolean)
    .sort((a, b) => {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(b.startDate) - new Date(a.startDate);
    });

  return {
    publicId: player.publicId,
    displayName: player.displayName,
    memberSince: player.createdAt,
    discordLinked: Boolean(player.discordIdentity),
    gameAccounts: player.gameAccounts.map(mapGameAccount),
    teams: player.savedTeamMembers
      .filter((m) => m.team)
      .map((m) => ({
        name: m.team.name,
        tag: m.team.teamTag,
        game: m.team.game,
        role: m.role,
      })),
    tournaments: played,
    stats: {
      tournamentsPlayed: played.length,
      // Distinct titles this player has actually competed in — the multi-game
      // fact the whole identity model exists to support.
      gamesPlayed: new Set(played.map((t) => t.game).filter(Boolean)).size,
    },
  };
};

module.exports = {
  PLAYING_ROLES,
  getPublicProfile,
};
