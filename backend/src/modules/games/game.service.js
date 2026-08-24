const { prisma } = require("../../lib/prisma");

// Canonical titles. `GameCategory` stays the presentation layer — artwork,
// ordering, publication — while `Game` is identity, and `slug` carries the same
// values as the GameAccountGame enum so the two agree by construction.

// The single normalisation used everywhere, matching the SQL in
// 20260824210000_add_canonical_game exactly. Divergence between the two would
// silently strand rows the migration mapped, so keep them in step.
const normalizeGameKey = (value) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";

const mapGame = (game) => ({
  id: game.id,
  slug: game.slug,
  displayName: game.displayName,
  shortName: game.shortName,
  isActive: game.isActive,
});

const listGames = async ({ includeInactive = false } = {}) =>
  (
    await prisma.game.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ displayName: "asc" }],
    })
  ).map(mapGame);

const getGameBySlug = async (slug) => {
  const key = normalizeGameKey(slug);
  if (!key) return null;
  const game = await prisma.game.findUnique({ where: { slug: key } });
  return game ? mapGame(game) : null;
};

// Resolve free text to a title id: canonical slug first, then a known alias.
// Returns null rather than throwing — callers during the expand phase still
// have the legacy text column to fall back on, and a title Quest has not seen
// before is a reason to review, not to fail a request.
const resolveGameId = async (rawValue) => {
  const key = normalizeGameKey(rawValue);
  if (!key) return null;

  const game = await prisma.game.findUnique({ where: { slug: key }, select: { id: true } });
  if (game) return game.id;

  const alias = await prisma.gameAlias.findUnique({
    where: { alias: key },
    select: { gameId: true },
  });
  return alias ? alias.gameId : null;
};

module.exports = {
  normalizeGameKey,
  listGames,
  getGameBySlug,
  resolveGameId,
};
