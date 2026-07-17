const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeInteger, normalizeSlug, normalizeText } = require("../../lib/validation");
const {
  gameAssetDirectory,
  persistGameAssetUpload,
  removeUploadFile,
} = require("../../middleware/upload");

const asBoolean = (value, fallback = false) =>
  value === undefined ? fallback : [true, "true", "1", "on"].includes(value);

const mapGameCategory = (category) => ({
  id: category.id,
  slug: category.slug,
  displayName: category.displayName,
  artworkUrl: category.artworkName
    ? `/api/uploads/game-assets/${category.artworkName}`
    : null,
  logoUrl: category.logoName ? `/api/uploads/game-assets/${category.logoName}` : null,
  displayOrder: category.displayOrder,
  isPublished: category.isPublished,
  tournamentCount: category._count?.tournaments,
});

const listPublicGameCategories = async () =>
  (await prisma.gameCategory.findMany({
    where: { isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }],
  })).map(mapGameCategory);

const listAdminGameCategories = async () =>
  (await prisma.gameCategory.findMany({
    orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }],
    include: { _count: { select: { tournaments: true } } },
  })).map(mapGameCategory);

const saveAdminGameCategory = async ({ categoryId, body, files = {} }) => {
  const existing = categoryId
    ? await prisma.gameCategory.findUnique({ where: { id: categoryId } })
    : null;
  if (categoryId && !existing) throw new HttpError(404, "Game category not found.");

  const displayName = normalizeText(body.displayName || existing?.displayName);
  const slug = normalizeSlug(body.slug || displayName || existing?.slug);
  if (!displayName || !slug) throw new HttpError(400, "Display name and slug are required.");

  const duplicate = await prisma.gameCategory.findFirst({
    where: { slug, ...(categoryId ? { id: { not: categoryId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new HttpError(400, "A game category already uses this slug.");

  let artwork;
  let logo;

  try {
    artwork = await persistGameAssetUpload(files.artwork?.[0]);
    logo = await persistGameAssetUpload(files.logo?.[0]);
    const removeArtwork = asBoolean(body.removeArtwork);
    const removeLogo = asBoolean(body.removeLogo);
    const data = {
      displayName,
      slug,
      displayOrder: normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100,
      isPublished: asBoolean(body.isPublished, existing?.isPublished ?? false),
      ...(artwork ? { artworkName: artwork.filename } : removeArtwork ? { artworkName: null } : {}),
      ...(logo ? { logoName: logo.filename } : removeLogo ? { logoName: null } : {}),
    };
    const saved = categoryId
      ? await prisma.gameCategory.update({ where: { id: categoryId }, data })
      : await prisma.gameCategory.create({ data: { id: crypto.randomUUID(), ...data } });
    for (const [oldName, newName] of [
      [existing?.artworkName, saved.artworkName],
      [existing?.logoName, saved.logoName],
    ]) {
      if (oldName && oldName !== newName) {
        await removeUploadFile({ directory: gameAssetDirectory, filename: oldName }).catch(() => undefined);
      }
    }
    return mapGameCategory(saved);
  } catch (error) {
    for (const upload of [artwork, logo]) {
      if (upload) await removeUploadFile({ directory: gameAssetDirectory, filename: upload.filename }).catch(() => undefined);
    }
    throw error;
  }
};

const deleteAdminGameCategory = async (categoryId) => {
  const existing = await prisma.gameCategory.findUnique({ where: { id: categoryId } });
  if (!existing) throw new HttpError(404, "Game category not found.");
  await prisma.gameCategory.delete({ where: { id: categoryId } });
  for (const filename of [existing.artworkName, existing.logoName]) {
    if (filename) await removeUploadFile({ directory: gameAssetDirectory, filename }).catch(() => undefined);
  }
};

module.exports = {
  mapGameCategory,
  listPublicGameCategories,
  listAdminGameCategories,
  saveAdminGameCategory,
  deleteAdminGameCategory,
};
