const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  detectImageType,
  persistPosterImageUpload,
  posterImageDirectory,
} = require("../../middleware/upload");
const { normalizeText } = require("../../lib/validation");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 18;
const MAX_PAGE_SIZE = 60;
const IMAGE_CATEGORIES = new Set(["poster", "logo", "banner", "graphic"]);
const POSTER_ALIGNMENTS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const CONTENT_TYPE_BY_IMAGE_TYPE = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const EXTENSION_BY_CONTENT_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
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

const buildImageUrl = (asset) => {
  if (asset.storedFilename) {
    return `/api/uploads/poster-images/${asset.storedFilename}`;
  }

  return `/api/images/${asset.id}/binary`;
};

const mapImageAsset = (asset) => ({
  id: asset.id,
  title: asset.title,
  description: asset.description,
  category: asset.category,
  originalName: asset.originalName,
  contentType: asset.contentType,
  createdAt: asset.createdAt,
  imageUrl: buildImageUrl(asset),
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

const buildStoredFilenameFromContentType = (contentType) =>
  `${Date.now()}-${crypto.randomUUID()}${
    EXTENSION_BY_CONTENT_TYPE[contentType] || ".jpg"
  }`;

const isPathInsideDirectory = (directory, targetPath) => {
  const relativePath = path.relative(path.resolve(directory), path.resolve(targetPath));
  return (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const readStoredImageAsset = async (asset) => {
  if (!asset.storedFilename) {
    return null;
  }

  const filePath = path.join(posterImageDirectory, asset.storedFilename);

  if (!isPathInsideDirectory(posterImageDirectory, filePath)) {
    throw new HttpError(404, "Image not found.");
  }

  try {
    const data = await fs.readFile(path.resolve(filePath));
    const detectedType = detectImageType(data);

    if (!detectedType) {
      throw new HttpError(404, "Image not found.");
    }

    return {
      contentType: CONTENT_TYPE_BY_IMAGE_TYPE[detectedType] || asset.contentType,
      data,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

const getBinaryImageAsset = async (asset) => {
  const storedImage = await readStoredImageAsset(asset);

  if (storedImage) {
    return storedImage;
  }

  if (asset.data) {
    return {
      contentType: asset.contentType,
      data: asset.data,
    };
  }

  throw new HttpError(404, "Image not found.");
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

  const persistedFiles = await Promise.all(
    files.map(async (file, index) => {
      const persistedImage = await persistPosterImageUpload(file);

      if (!persistedImage) {
        throw new HttpError(400, "Upload at least one image.");
      }

      return {
        file,
        persistedImage,
        title: files.length === 1 ? title : `${title} ${index + 1}`,
      };
    })
  );

  const createdAssets = await prisma.$transaction(
    persistedFiles.map(({ file, persistedImage, title: assetTitle }) =>
      prisma.imageAsset.create({
        data: {
          id: crypto.randomUUID(),
          title: assetTitle,
          description,
          category,
          originalName: file.originalname || null,
          storedFilename: persistedImage.filename,
          contentType: persistedImage.contentType,
          byteSize: file.buffer.length,
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

const getImageAssetRecordById = async (imageId) => {
  const asset = await prisma.imageAsset.findUnique({
    where: { id: imageId },
  });

  if (!asset) {
    throw new HttpError(404, "Image not found.");
  }

  return asset;
};

const getImageAssetById = async (imageId) => {
  const asset = await getImageAssetRecordById(imageId);
  return getBinaryImageAsset(asset);
};

const getImageAssetMetadata = async (imageId) => {
  const asset = await getImageAssetRecordById(imageId);
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

  return getBinaryImageAsset(poster.imageAsset);
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

const migrateImageAssetsToFilesystem = async () => {
  await fs.mkdir(posterImageDirectory, { recursive: true });

  const assets = await prisma.imageAsset.findMany({
    where: {
      OR: [
        { storedFilename: null },
        { data: { not: null } },
      ],
    },
  });

  let migratedCount = 0;
  let skippedCount = 0;

  for (const asset of assets) {
    if (!asset.data && asset.storedFilename) {
      skippedCount += 1;
      continue;
    }

    if (!asset.data) {
      skippedCount += 1;
      continue;
    }

    const storedFilename =
      asset.storedFilename || buildStoredFilenameFromContentType(asset.contentType);
    const filePath = path.join(posterImageDirectory, storedFilename);

    await fs.writeFile(filePath, asset.data);

    await prisma.imageAsset.update({
      where: { id: asset.id },
      data: {
        storedFilename,
        byteSize: asset.data.length,
        data: null,
      },
    });

    migratedCount += 1;
  }

  const remainingDbImages = await prisma.imageAsset.count({
    where: {
      data: { not: null },
    },
  });

  return {
    migratedCount,
    skippedCount,
    remainingDbImages,
  };
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
  migrateImageAssetsToFilesystem,
};
