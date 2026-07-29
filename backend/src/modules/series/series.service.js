const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const { normalizeInteger, normalizeSlug, normalizeText } = require("../../lib/validation");
const {
  persistTournamentBannerUpload,
  tournamentBannerDirectory,
} = require("../../middleware/upload");
const { mapTournament, buildRegistrationCountInclude } = require("../tournaments/tournament.service");

const mapSeries = (series) => ({
  id: series.id,
  slug: series.slug,
  title: series.title,
  description: series.description,
  heroUrl: series.heroImageName
    ? `/api/uploads/tournament-banners/${series.heroImageName}`
    : null,
  displayOrder: series.displayOrder,
  isPublished: series.isPublished,
  tournaments: (series.tournaments || []).map(mapTournament),
  createdAt: series.createdAt,
  updatedAt: series.updatedAt,
});

const buildSeriesTournamentInclude = () => ({
  where: { isPublished: true },
  orderBy: [
    { seriesOrder: "asc" },
    { startDate: { sort: "asc", nulls: "last" } },
  ],
  include: buildRegistrationCountInclude(),
});

const listPublicSeries = async () => {
  const series = await prisma.eventSeries.findMany({
    where: { isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: { tournaments: buildSeriesTournamentInclude() },
  });
  return series.map(mapSeries);
};

const getPublicSeriesBySlug = async (slug) => {
  const normalizedSlug = normalizeSlug(slug);
  const series = await prisma.eventSeries.findFirst({
    where: { slug: normalizedSlug, isPublished: true },
    include: { tournaments: buildSeriesTournamentInclude() },
  });
  if (!series) throw new HttpError(404, "Event series not found.");
  return mapSeries(series);
};

const listAdminSeries = async () => {
  const series = await prisma.eventSeries.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: {
      tournaments: {
        orderBy: [
          { seriesOrder: "asc" },
          { startDate: { sort: "asc", nulls: "last" } },
        ],
        include: buildRegistrationCountInclude(),
      },
    },
  });
  return series.map(mapSeries);
};

const parseSeries = (body, existing) => {
  const title = normalizeText(body.title || existing?.title);
  const slug = normalizeSlug(body.slug || title || existing?.slug);
  const description = normalizeText(body.description || existing?.description);
  const displayOrder = normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100;
  const isPublished = Object.prototype.hasOwnProperty.call(body, "isPublished")
    ? [true, "true", "1", "on"].includes(body.isPublished)
    : existing?.isPublished ?? false;
  if (!title || !slug || !description) {
    throw new HttpError(400, "Title, slug, and description are required.");
  }
  return { title, slug, description, displayOrder, isPublished };
};

const saveAdminSeries = async ({ seriesId, body, file }) => {
  const existing = seriesId
    ? await prisma.eventSeries.findUnique({ where: { id: seriesId } })
    : null;
  if (seriesId && !existing) throw new HttpError(404, "Event series not found.");

  const data = parseSeries(body, existing);
  const duplicate = await prisma.eventSeries.findFirst({
    where: { slug: data.slug, ...(seriesId ? { id: { not: seriesId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new HttpError(400, "An event series already uses this slug.");

  let uploaded = await persistTournamentBannerUpload(file);
  if (uploaded) data.heroImageName = uploaded.filename;
  if ([true, "true", "1", "on"].includes(body.removeHeroImage)) {
    data.heroImageName = null;
    if (uploaded) {
      await removeUploadsQuietly(
        [{ directory: tournamentBannerDirectory, filename: uploaded.filename }],
        { operation: "removeUnusedSeriesUpload", seriesId }
      );
      uploaded = null;
    }
  }

  let series;
  try {
    series = seriesId
      ? await prisma.eventSeries.update({ where: { id: seriesId }, data })
      : await prisma.eventSeries.create({ data: { id: crypto.randomUUID(), ...data } });
  } catch (error) {
    if (uploaded) {
      await removeUploadsQuietly(
        [{ directory: tournamentBannerDirectory, filename: uploaded.filename }],
        { operation: "rollbackAdminSeriesUpload", seriesId }
      );
    }
    throw error;
  }

  if (existing?.heroImageName && existing.heroImageName !== series.heroImageName) {
    await removeUploadsQuietly(
      [{ directory: tournamentBannerDirectory, filename: existing.heroImageName }],
      { operation: "saveAdminSeries", seriesId: series.id }
    );
  }
  return mapSeries(series);
};

const deleteAdminSeries = async (seriesId) => {
  const existing = await prisma.eventSeries.findUnique({ where: { id: seriesId } });
  if (!existing) throw new HttpError(404, "Event series not found.");
  await prisma.eventSeries.delete({ where: { id: seriesId } });
  if (existing.heroImageName) {
    await removeUploadsQuietly(
      [{ directory: tournamentBannerDirectory, filename: existing.heroImageName }],
      { operation: "deleteAdminSeries", seriesId }
    );
  }
};

module.exports = {
  listPublicSeries,
  getPublicSeriesBySlug,
  listAdminSeries,
  saveAdminSeries,
  deleteAdminSeries,
};
