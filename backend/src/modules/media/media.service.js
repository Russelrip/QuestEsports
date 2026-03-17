const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { detectImageType } = require("../../middleware/upload");
const { normalizeText } = require("../../lib/validation");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 18;
const MAX_PAGE_SIZE = 60;
const IMAGE_CATEGORIES = new Set(["poster", "logo", "banner", "graphic"]);
const POSTER_ALIGNMENTS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const TOURNAMENT_POSTER_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  isPublished: true,
};
const POSTER_INCLUDE = {
  imageAsset: true,
  tournament: {
    select: TOURNAMENT_POSTER_SELECT,
  },
};

const normalizePageNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPagination = ({ page, pageSize }) => ({
  page: normalizePageNumber(page, DEFAULT_PAGE),
  pageSize: Math.min(
    normalizePageNumber(pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  ),
});

const mapImageAsset = (asset) => ({
  id: asset.id,
  title: asset.title,
  description: asset.description,
  category: asset.category,
  originalName: asset.originalName,
  contentType: asset.contentType,
  createdAt: asset.createdAt,
  imageUrl: `/api/images/${asset.id}/binary`,
});

const mapPoster = (poster) => ({
  id: poster.id,
  title: poster.title,
  description: poster.description,
  category: poster.category,
  headline: poster.headline,
  subheadline: poster.subheadline,
  accentColor: poster.accentColor,
  textColor: poster.textColor,
  overlayAlign: poster.overlayAlign,
  createdAt: poster.createdAt,
  updatedAt: poster.updatedAt,
  tournament: poster.tournament || null,
  imageAsset: {
    ...mapImageAsset(poster.imageAsset),
    imageUrl: `/api/posters/${poster.id}/image`,
  },
});

const buildPagedResponse = ({ items, total, page, pageSize }) => ({
  items,
  pagination: {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  },
});

const normalizeCategory = (value, fallback = "poster") => {
  const normalized = normalizeText(value).toLowerCase();
  return IMAGE_CATEGORIES.has(normalized) ? normalized : fallback;
};

const normalizeAlignment = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return POSTER_ALIGNMENTS.has(normalized) ? normalized : "bottom-left";
};

const createImageAssets = async ({ body, files }) => {
  const title = normalizeText(body.title);
  const description = normalizeText(body.description) || null;
  const category = normalizeCategory(body.category);

  if (!title) {
    throw new HttpError(400, "Title is required.");
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "Upload at least one image.");
  }

  const validatedFiles = files.map((file) => {
    const detectedType = detectImageType(file.buffer);

    if (!detectedType) {
      throw new HttpError(400, "Only JPEG, PNG, and WebP images are allowed.");
    }

    const contentType =
      detectedType === "jpeg"
        ? "image/jpeg"
        : detectedType === "png"
          ? "image/png"
          : "image/webp";

    return {
      ...file,
      contentType,
    };
  });

  const createdAssets = await prisma.$transaction(
    validatedFiles.map((file, index) =>
      prisma.imageAsset.create({
        data: {
          id: crypto.randomUUID(),
          title: validatedFiles.length === 1 ? title : `${title} ${index + 1}`,
          description,
          category,
          originalName: file.originalname || null,
          contentType: file.contentType,
          data: file.buffer,
        },
      })
    )
  );

  return createdAssets.map(mapImageAsset);
};

const listImageAssets = async (query = {}) => {
  const pagination = buildPagination(query);
  const category = normalizeText(query.category).toLowerCase();
  const search = normalizeText(query.search);
  const where = {
    ...(IMAGE_CATEGORIES.has(category) ? { category } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { originalName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, assets] = await prisma.$transaction([
    prisma.imageAsset.count({ where }),
    prisma.imageAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);

  return buildPagedResponse({
    items: assets.map(mapImageAsset),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getImageAssetById = async (imageId) => {
  const asset = await prisma.imageAsset.findUnique({
    where: { id: imageId },
  });

  if (!asset) {
    throw new HttpError(404, "Image not found.");
  }

  return asset;
};

const getImageAssetMetadata = async (imageId) => {
  const asset = await prisma.imageAsset.findUnique({
    where: { id: imageId },
  });

  if (!asset) {
    throw new HttpError(404, "Image not found.");
  }

  return mapImageAsset(asset);
};

const getPosterImageAssetByPosterId = async (posterId) => {
  const poster = await prisma.poster.findUnique({
    where: { id: posterId },
    select: {
      imageAsset: true,
    },
  });

  if (!poster?.imageAsset) {
    throw new HttpError(404, "Poster not found.");
  }

  return poster.imageAsset;
};

const createPoster = async ({ body }) => {
  const imageAssetId = normalizeText(body.imageAssetId);
  const title = normalizeText(body.title);
  const description = normalizeText(body.description) || null;
  const category = normalizeCategory(body.category);
  const headline = normalizeText(body.headline);
  const subheadline = normalizeText(body.subheadline) || null;
  const accentColor = normalizeText(body.accentColor) || "#7c3aed";
  const textColor = normalizeText(body.textColor) || "#ffffff";
  const overlayAlign = normalizeAlignment(body.overlayAlign);
  const tournamentId = normalizeText(body.tournamentId) || null;

  if (!imageAssetId) {
    throw new HttpError(400, "Choose an uploaded image for the poster.");
  }

  if (!title) {
    throw new HttpError(400, "Poster title is required.");
  }

  if (!headline) {
    throw new HttpError(400, "Poster headline is required.");
  }

  const imageAsset = await prisma.imageAsset.findUnique({
    where: { id: imageAssetId },
    select: { id: true },
  });

  if (!imageAsset) {
    throw new HttpError(404, "Selected image could not be found.");
  }

  if (tournamentId) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });

    if (!tournament) {
      throw new HttpError(404, "Selected tournament could not be found.");
    }
  }

  const poster = await prisma.poster.create({
    data: {
      id: crypto.randomUUID(),
      imageAssetId,
      tournamentId,
      title,
      description,
      category,
      headline,
      subheadline,
      accentColor,
      textColor,
      overlayAlign,
    },
    include: POSTER_INCLUDE,
  });

  return mapPoster(poster);
};

const listPosters = async (query = {}) => {
  const pagination = buildPagination(query);
  const category = normalizeText(query.category).toLowerCase();
  const search = normalizeText(query.search);
  const where = {
    ...(IMAGE_CATEGORIES.has(category) ? { category } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { headline: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, posters] = await prisma.$transaction([
    prisma.poster.count({ where }),
    prisma.poster.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: POSTER_INCLUDE,
    }),
  ]);

  return buildPagedResponse({
    items: posters.map(mapPoster),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getPosterById = async (posterId) => {
  const poster = await prisma.poster.findUnique({
    where: { id: posterId },
    include: POSTER_INCLUDE,
  });

  if (!poster) {
    throw new HttpError(404, "Poster not found.");
  }

  return mapPoster(poster);
};

const deletePosterById = async (posterId) => {
  const deleted = await prisma.poster.deleteMany({
    where: { id: posterId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Poster not found.");
  }
};

module.exports = {
  createImageAssets,
  listImageAssets,
  getImageAssetById,
  getImageAssetMetadata,
  getPosterImageAssetByPosterId,
  createPoster,
  listPosters,
  getPosterById,
  deletePosterById,
};
