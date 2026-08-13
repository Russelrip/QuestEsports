const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const { normalizeSlug, normalizeText } = require("../../lib/validation");
const {
  createImageAssets,
  deleteUnusedImageAsset,
  getImageAssetById,
} = require("./media.service");

const IMAGE_ASSET_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  originalName: true,
  storedFilename: true,
  contentType: true,
  byteSize: true,
  createdAt: true,
};

const TOURNAMENT_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  isPublished: true,
};

const PHOTO_INCLUDE = {
  imageAsset: { select: IMAGE_ASSET_SELECT },
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
};

const parseOptionalDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "Event date is invalid.");
  return parsed;
};

const buildAlbumPhotoImageUrl = (albumSlug, photoId) =>
  `/api/event-albums/${encodeURIComponent(albumSlug)}/photos/${photoId}/image`;

const buildAdminAlbumPhotoImageUrl = (albumId, photoId) =>
  `/api/admin/event-albums/${albumId}/photos/${photoId}/image`;

const mapPhoto = (photo, album, admin = false) => ({
  id: photo.id,
  caption: photo.caption,
  position: photo.position,
  createdAt: photo.createdAt,
  imageAsset: {
    id: photo.imageAsset.id,
    title: photo.imageAsset.title,
    description: photo.imageAsset.description,
    category: photo.imageAsset.category,
    originalName: photo.imageAsset.originalName,
    contentType: photo.imageAsset.contentType,
    byteSize: photo.imageAsset.byteSize,
    createdAt: photo.imageAsset.createdAt,
    imageUrl: admin
      ? buildAdminAlbumPhotoImageUrl(album.id, photo.id)
      : buildAlbumPhotoImageUrl(album.slug, photo.id),
  },
});

const mapAlbum = (album, { admin = false } = {}) => ({
  id: album.id,
  slug: album.slug,
  title: album.title,
  description: album.description,
  location: album.location,
  eventDate: album.eventDate,
  isPublished: album.isPublished,
  allowDownloads: album.allowDownloads,
  createdAt: album.createdAt,
  updatedAt: album.updatedAt,
  tournament: album.tournament || null,
  photoCount: album._count?.photos ?? album.photos?.length ?? 0,
  photos: (album.photos || []).map((photo) => mapPhoto(photo, album, admin)),
});

const albumListInclude = {
  tournament: { select: TOURNAMENT_SELECT },
  _count: { select: { photos: true } },
  photos: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    take: 5,
    include: PHOTO_INCLUDE,
  },
};

const albumDetailInclude = {
  tournament: { select: TOURNAMENT_SELECT },
  _count: { select: { photos: true } },
  photos: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: PHOTO_INCLUDE,
  },
};

const listPublicEventAlbums = async (query = {}) => {
  const pagination = buildPagination({ page: query.page, pageSize: query.pageSize || 12 });
  const where = { isPublished: true };
  const [total, totalPhotos, albums] = await prisma.$transaction([
    prisma.eventAlbum.count({ where }),
    prisma.albumPhoto.count({ where: { album: { isPublished: true } } }),
    prisma.eventAlbum.findMany({
      where,
      orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: albumListInclude,
    }),
  ]);
  return {
    ...buildPagedResponse({
    items: albums.map(mapAlbum),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    }),
    totalPhotos,
  };
};

const listAdminEventAlbums = async (query = {}) => {
  const pagination = buildPagination({ page: query.page, pageSize: query.pageSize || 24 });
  const search = normalizeText(query.search);
  const where = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};
  const [total, albums] = await prisma.$transaction([
    prisma.eventAlbum.count({ where }),
    prisma.eventAlbum.findMany({
      where,
      orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: albumListInclude,
    }),
  ]);
  return buildPagedResponse({
    items: albums.map((album) => mapAlbum(album, { admin: true })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getPublicEventAlbumBySlug = async (slug) => {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) throw new HttpError(400, "Album slug is required.");
  const album = await prisma.eventAlbum.findFirst({
    where: { slug: normalizedSlug, isPublished: true },
    include: albumDetailInclude,
  });
  if (!album) throw new HttpError(404, "Event album not found.");
  return mapAlbum(album);
};

const getAdminEventAlbumById = async (albumId) => {
  const album = await prisma.eventAlbum.findUnique({
    where: { id: albumId },
    include: albumDetailInclude,
  });
  if (!album) throw new HttpError(404, "Event album not found.");
  return mapAlbum(album, { admin: true });
};

const validateTournament = async (tournamentId) => {
  if (!tournamentId) return;
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true },
  });
  if (!tournament) throw new HttpError(404, "Selected tournament could not be found.");
};

const buildAlbumData = (body, existing = null) => {
  const title = normalizeText(body.title);
  const slug = normalizeSlug(body.slug || title);
  if (!title) throw new HttpError(400, "Album title is required.");
  if (!slug) throw new HttpError(400, "Album slug is required.");
  return {
    title,
    slug,
    description: normalizeText(body.description) || null,
    location: normalizeText(body.location) || null,
    eventDate: parseOptionalDate(body.eventDate),
    tournamentId: normalizeText(body.tournamentId) || null,
    isPublished: normalizeBoolean(body.isPublished, existing?.isPublished || false),
    allowDownloads: normalizeBoolean(body.allowDownloads, existing?.allowDownloads ?? true),
  };
};

const ensureUniqueSlug = async (slug, excludeId = null) => {
  const existing = await prisma.eventAlbum.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, "An event album already uses this slug.");
};

const createEventAlbum = async (body) => {
  const data = buildAlbumData(body);
  await Promise.all([validateTournament(data.tournamentId), ensureUniqueSlug(data.slug)]);
  const album = await prisma.eventAlbum.create({
    data: { id: crypto.randomUUID(), ...data },
    include: albumDetailInclude,
  });
  return mapAlbum(album, { admin: true });
};

const updateEventAlbum = async (albumId, body) => {
  const existing = await prisma.eventAlbum.findUnique({ where: { id: albumId } });
  if (!existing) throw new HttpError(404, "Event album not found.");
  const data = buildAlbumData({ ...existing, ...body }, existing);
  await Promise.all([validateTournament(data.tournamentId), ensureUniqueSlug(data.slug, albumId)]);
  const album = await prisma.eventAlbum.update({
    where: { id: albumId },
    data,
    include: albumDetailInclude,
  });
  return mapAlbum(album, { admin: true });
};

const cleanupAssets = async (assetIds) => {
  await Promise.all(
    assetIds.map((assetId) =>
      deleteUnusedImageAsset(assetId).catch((error) => {
        if (error?.statusCode !== 404 && error?.statusCode !== 409) throw error;
      })
    )
  );
};

const deleteEventAlbum = async (albumId) => {
  const album = await prisma.eventAlbum.findUnique({
    where: { id: albumId },
    select: { photos: { select: { imageAssetId: true } } },
  });
  if (!album) throw new HttpError(404, "Event album not found.");
  await prisma.eventAlbum.delete({ where: { id: albumId } });
  await cleanupAssets(album.photos.map((photo) => photo.imageAssetId));
};

const uploadEventAlbumPhotos = async ({ albumId, body, files }) => {
  const album = await prisma.eventAlbum.findUnique({ where: { id: albumId }, select: { id: true } });
  if (!album) throw new HttpError(404, "Event album not found.");
  const assets = await createImageAssets({
    body: {
      title: normalizeText(body.title) || "Event photo",
      description: normalizeText(body.description),
      category: "photo",
    },
    files,
  });
  try {
    const aggregate = await prisma.albumPhoto.aggregate({
      where: { albumId },
      _max: { position: true },
    });
    const startPosition = (aggregate._max.position ?? -1) + 1;
    await prisma.$transaction(
      assets.map((asset, index) =>
        prisma.albumPhoto.create({
          data: {
            id: crypto.randomUUID(),
            albumId,
            imageAssetId: asset.id,
            position: startPosition + index,
          },
        })
      )
    );
  } catch (error) {
    await cleanupAssets(assets.map((asset) => asset.id));
    throw error;
  }
  return getAdminEventAlbumById(albumId);
};

const reorderEventAlbumPhotos = async (albumId, photoIds) => {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new HttpError(400, "Provide the complete photo order.");
  }
  const existing = await prisma.albumPhoto.findMany({
    where: { albumId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((photo) => photo.id));
  if (
    existingIds.size !== photoIds.length ||
    new Set(photoIds).size !== photoIds.length ||
    photoIds.some((photoId) => !existingIds.has(photoId))
  ) {
    throw new HttpError(400, "Photo order must include every album photo exactly once.");
  }
  await prisma.$transaction(
    photoIds.map((photoId, position) =>
      prisma.albumPhoto.update({ where: { id: photoId }, data: { position } })
    )
  );
  return getAdminEventAlbumById(albumId);
};

const deleteEventAlbumPhoto = async (albumId, photoId) => {
  const photo = await prisma.albumPhoto.findFirst({
    where: { id: photoId, albumId },
    select: { id: true, imageAssetId: true },
  });
  if (!photo) throw new HttpError(404, "Album photo not found.");
  await prisma.albumPhoto.delete({ where: { id: photo.id } });
  await cleanupAssets([photo.imageAssetId]);
};

const getPublicEventAlbumPhoto = async ({ slug, photoId }) => {
  const normalizedSlug = normalizeSlug(slug);
  const photo = await prisma.albumPhoto.findFirst({
    where: {
      id: photoId,
      album: { slug: normalizedSlug, isPublished: true },
    },
    select: {
      imageAssetId: true,
      imageAsset: { select: { originalName: true } },
      album: { select: { allowDownloads: true } },
    },
  });
  if (!photo) throw new HttpError(404, "Album photo not found.");
  return {
    ...(await getImageAssetById(photo.imageAssetId)),
    originalName: photo.imageAsset.originalName,
    allowDownloads: photo.album.allowDownloads,
  };
};

const getAdminEventAlbumPhoto = async ({ albumId, photoId }) => {
  const photo = await prisma.albumPhoto.findFirst({
    where: { id: photoId, albumId },
    select: {
      imageAssetId: true,
      imageAsset: { select: { originalName: true } },
    },
  });
  if (!photo) throw new HttpError(404, "Album photo not found.");
  return {
    ...(await getImageAssetById(photo.imageAssetId)),
    originalName: photo.imageAsset.originalName,
  };
};

module.exports = {
  mapAlbum,
  listPublicEventAlbums,
  listAdminEventAlbums,
  getPublicEventAlbumBySlug,
  getAdminEventAlbumById,
  createEventAlbum,
  updateEventAlbum,
  deleteEventAlbum,
  uploadEventAlbumPhotos,
  reorderEventAlbumPhotos,
  deleteEventAlbumPhoto,
  getPublicEventAlbumPhoto,
  getAdminEventAlbumPhoto,
};
