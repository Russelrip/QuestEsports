const { prisma } = require("../../lib/prisma");

// A player's Discord account as competitive infrastructure.
//
// The snowflake is the identity. `username` and `globalName` are a cached
// display snapshot and must never be used to look anybody up — Discord names
// change, and this repo has already shipped two fixes about storing the wrong
// one.

const SNOWFLAKE = /^[0-9]{5,32}$/;

const isSnowflake = (value) => SNOWFLAKE.test(String(value ?? "").trim());

const mapIdentity = (identity) =>
  identity && {
    discordUserId: identity.discordUserId,
    username: identity.username,
    globalName: identity.globalName,
    source: identity.source,
    linkedAt: identity.linkedAt,
    lastSeenAt: identity.lastSeenAt,
  };

// Read-through for the expand phase. `discord_identities` is backfilled from
// completed OAuth flows, but a link created after this deploy and before the
// linking path is cut over would exist only on `OAuthAccount` — so a miss falls
// back there rather than reporting the player as unreachable.
const getForPlayer = async (playerId) => {
  if (!playerId) return null;

  const identity = await prisma.discordIdentity.findUnique({ where: { playerId } });
  if (identity) return mapIdentity(identity);

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { userId: true },
  });
  if (!player?.userId) return null;

  const oauth = await prisma.oAuthAccount.findFirst({
    where: { userId: player.userId, provider: "discord" },
    select: { providerUserId: true, createdAt: true },
  });
  if (!oauth || !isSnowflake(oauth.providerUserId)) return null;

  return {
    discordUserId: oauth.providerUserId,
    username: null,
    globalName: null,
    source: "oauth",
    linkedAt: oauth.createdAt,
    lastSeenAt: null,
    // Flags a row the backfill did not cover, so a caller can tell a
    // fallback read from a real one.
    viaOAuthFallback: true,
  };
};

// The reverse direction, which is what a bot needs: given a snowflake, which
// player is this? Returns null rather than throwing — an unknown Discord user
// is an ordinary case, not an error.
const findPlayerByDiscordUserId = async (discordUserId) => {
  if (!isSnowflake(discordUserId)) return null;
  const identity = await prisma.discordIdentity.findUnique({
    where: { discordUserId: String(discordUserId).trim() },
    select: { playerId: true },
  });
  return identity ? identity.playerId : null;
};

// Idempotent. Re-linking the same account refreshes the cached display name
// and touches lastSeenAt; it never creates a second row.
//
// Deliberately refuses to move a snowflake between players. One Discord account
// belongs to one player, and silently reassigning it would hand a tournament
// role to the wrong person. The caller gets an explicit conflict to resolve.
const linkDiscordIdentity = async ({
  playerId,
  discordUserId,
  username = null,
  globalName = null,
  source = "oauth",
}) => {
  if (!playerId) throw new Error("playerId is required");
  if (!isSnowflake(discordUserId)) {
    throw new Error("discordUserId must be a Discord snowflake, not a username");
  }

  const snowflake = String(discordUserId).trim();
  const existing = await prisma.discordIdentity.findUnique({
    where: { discordUserId: snowflake },
    select: { playerId: true },
  });
  if (existing && existing.playerId !== playerId) {
    const error = new Error("This Discord account is already linked to another player.");
    error.code = "DISCORD_IDENTITY_CONFLICT";
    throw error;
  }

  return prisma.discordIdentity.upsert({
    where: { playerId },
    create: { playerId, discordUserId: snowflake, username, globalName, source },
    update: { discordUserId: snowflake, username, globalName, lastSeenAt: new Date() },
  });
};

module.exports = {
  isSnowflake,
  getForPlayer,
  findPlayerByDiscordUserId,
  linkDiscordIdentity,
};
