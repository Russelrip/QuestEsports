const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const {
  normalizeInteger,
  normalizeSlug,
  normalizeText,
  normalizeOptionalUrl,
} = require("../../lib/validation");
const {
  persistTournamentBannerUpload,
  tournamentBannerDirectory,
} = require("../../middleware/upload");
const {
  mapTournament,
  buildRegistrationCountInclude,
  createAdminTournament,
  attachTournamentToSeries,
} = require("../tournaments/tournament.service");
const { getPublicEventForSeries } = require("../tickets/ticket.service");
const { getEventAggregate } = require("./event-aggregation");

const normalizeBooleanFlag = (value) =>
  value === true || value === "true" || value === "on" || value === 1 || value === "1";

const normalizeOptionalDate = (value, fieldLabel) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${fieldLabel} must be a valid date.`);
  }
  return date;
};

const normalizeEventUrl = (value, fieldLabel) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const url = normalizeOptionalUrl(normalized);
  if (!url) throw new HttpError(400, `${fieldLabel} must be a valid URL.`);
  return url;
};

const getEventStatus = (series, aggregate) => {
  if (!series.isPublished) return "draft";
  if (aggregate.registrationState === "completed") return "completed";
  if (aggregate.registrationState === "open") return "open";
  if (aggregate.registrationState === "upcoming") return "upcoming";
  if (series.endDate && new Date(series.endDate) < new Date()) return "completed";
  return "closed";
};

const mapSeries = (series, { aggregate, includeDrafts = false } = {}) => {
  const eventAggregate = aggregate || {
    games: 0,
    teamsRegistered: 0,
    playersRegistered: 0,
    availableSlots: 0,
    registrationState: "closed",
  };
  const tournaments = (series.tournaments || [])
    .filter((tournament) => includeDrafts || tournament.isPublished !== false)
    .map(mapTournament);

  const registrationState = series.registrationStatusOverride || eventAggregate.registrationState;
  const mappedAggregate = { ...eventAggregate, registrationState };

  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    description: series.description,
    shortName: series.shortName || null,
    subtitle: series.subtitle || null,
    shortDescription: series.shortDescription || null,
    heroUrl: series.heroImageName
      ? `/api/uploads/tournament-banners/${series.heroImageName}`
      : null,
    bannerUrl: (series.bannerImageName || series.heroImageName)
      ? `/api/uploads/tournament-banners/${series.bannerImageName || series.heroImageName}`
      : null,
    displayOrder: series.displayOrder,
    isPublished: series.isPublished,
    featured: Boolean(series.featured),
    startDate: series.startDate || null,
    endDate: series.endDate || null,
    registrationOpenAt: series.registrationOpenAt || null,
    registrationCloseAt: series.registrationCloseAt || null,
    venue: series.venue || null,
    location: series.location || null,
    country: series.country || null,
    organizer: series.organizer || null,
    websiteUrl: series.websiteUrl || null,
    discordUrl: series.discordUrl || null,
    registrationStatusOverride: series.registrationStatusOverride || null,
    eventStatus: getEventStatus(series, mappedAggregate),
    aggregate: mappedAggregate,
    ...mappedAggregate,
    tournaments,
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
  };
};

const buildSeriesTournamentInclude = ({ includeDrafts = false } = {}) => ({
  ...(includeDrafts ? {} : { where: { isPublished: true } }),
  orderBy: [
    { seriesOrder: "asc" },
    { startDate: { sort: "asc", nulls: "last" } },
  ],
  include: buildRegistrationCountInclude(),
});

const mapSeriesWithAggregate = async (series, includeDrafts) => mapSeries(series, {
  aggregate: await getEventAggregate({ seriesId: series.id, includeDrafts }),
  includeDrafts,
});

const listSeries = async ({ includeDrafts = false } = {}) => {
  const series = await prisma.eventSeries.findMany({
    where: includeDrafts ? {} : { isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: { tournaments: buildSeriesTournamentInclude({ includeDrafts }) },
  });
  return Promise.all(series.map((item) => mapSeriesWithAggregate(item, includeDrafts)));
};

const listPublicSeries = () => listSeries();
const listPublicEvents = () => listPublicSeries();

const getSeriesBySlug = async (slug, { includeDrafts = false } = {}) => {
  const normalizedSlug = normalizeSlug(slug);
  const series = await prisma.eventSeries.findFirst({
    where: {
      slug: normalizedSlug,
      ...(includeDrafts ? {} : { isPublished: true }),
    },
    include: { tournaments: buildSeriesTournamentInclude({ includeDrafts }) },
  });
  if (!series) throw new HttpError(404, "Event series not found.");
  return mapSeriesWithAggregate(series, includeDrafts);
};

const getPublicSeriesBySlug = async (slug) => {
  const series = await getSeriesBySlug(slug);
  return {
    ...series,
    ticketEvent: await getPublicEventForSeries(series.id),
  };
};
const getPublicEventBySlug = getPublicSeriesBySlug;

const listAdminSeries = () => listSeries({ includeDrafts: true });
const listAdminEvents = listAdminSeries;

const parseSeries = (body = {}, existing) => {
  const title = normalizeText(body.title ?? existing?.title);
  const slug = normalizeSlug(body.slug ?? title ?? existing?.slug);
  const description = normalizeText(body.description ?? existing?.description);
  const displayOrder = normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100;
  const isPublished = Object.prototype.hasOwnProperty.call(body, "isPublished")
    ? normalizeBooleanFlag(body.isPublished)
    : existing?.isPublished ?? false;
  const featured = Object.prototype.hasOwnProperty.call(body, "featured")
    ? normalizeBooleanFlag(body.featured)
    : existing?.featured ?? false;

  if (!title || !slug || !description) {
    throw new HttpError(400, "Title, slug, and description are required.");
  }

  return {
    title,
    slug,
    description,
    shortName: normalizeText(body.shortName ?? existing?.shortName) || null,
    subtitle: normalizeText(body.subtitle ?? existing?.subtitle) || null,
    shortDescription: normalizeText(body.shortDescription ?? existing?.shortDescription) || null,
    startDate: normalizeOptionalDate(body.startDate ?? existing?.startDate, "Start date"),
    endDate: normalizeOptionalDate(body.endDate ?? existing?.endDate, "End date"),
    registrationOpenAt: normalizeOptionalDate(
      body.registrationOpenAt ?? existing?.registrationOpenAt,
      "Registration open date"
    ),
    registrationCloseAt: normalizeOptionalDate(
      body.registrationCloseAt ?? existing?.registrationCloseAt,
      "Registration close date"
    ),
    venue: normalizeText(body.venue ?? existing?.venue) || null,
    location: normalizeText(body.location ?? existing?.location) || null,
    country: normalizeText(body.country ?? existing?.country) || null,
    organizer: normalizeText(body.organizer ?? existing?.organizer) || null,
    websiteUrl: normalizeEventUrl(body.websiteUrl ?? existing?.websiteUrl, "Website URL"),
    discordUrl: normalizeEventUrl(body.discordUrl ?? existing?.discordUrl, "Discord URL"),
    registrationStatusOverride:
      normalizeText(body.registrationStatusOverride ?? existing?.registrationStatusOverride).toLowerCase() || null,
    displayOrder,
    isPublished,
    featured,
  };
};

const getUpload = (files, key) => Array.isArray(files?.[key]) ? files[key][0] : null;

const saveAdminSeries = async ({ seriesId, body = {}, file, files } = {}) => {
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

  const heroFile = file || getUpload(files, "heroImage");
  const bannerFile = getUpload(files, "bannerImage");
  const uploaded = [];
  try {
    const heroUpload = await persistTournamentBannerUpload(heroFile);
    const bannerUpload = await persistTournamentBannerUpload(bannerFile);
    if (heroUpload) {
      data.heroImageName = heroUpload.filename;
      uploaded.push({ directory: tournamentBannerDirectory, filename: heroUpload.filename });
    }
    if (bannerUpload) {
      data.bannerImageName = bannerUpload.filename;
      uploaded.push({ directory: tournamentBannerDirectory, filename: bannerUpload.filename });
    }
    const uploadsToDiscard = [];
    if (normalizeBooleanFlag(body.removeHeroImage)) {
      data.heroImageName = null;
      if (heroUpload) uploadsToDiscard.push({ directory: tournamentBannerDirectory, filename: heroUpload.filename });
    }
    if (normalizeBooleanFlag(body.removeBannerImage)) {
      data.bannerImageName = null;
      if (bannerUpload) uploadsToDiscard.push({ directory: tournamentBannerDirectory, filename: bannerUpload.filename });
    }
    const discardedFilenames = new Set(uploadsToDiscard.map(({ filename }) => filename));
    for (let index = uploaded.length - 1; index >= 0; index -= 1) {
      if (discardedFilenames.has(uploaded[index].filename)) uploaded.splice(index, 1);
    }
    await removeUploadsQuietly(uploadsToDiscard, {
      operation: "removeUnusedSeriesUpload",
      seriesId,
    });

    const series = seriesId
      ? await prisma.eventSeries.update({ where: { id: seriesId }, data })
      : await prisma.eventSeries.create({ data: { id: crypto.randomUUID(), ...data } });

    const replaced = [];
    for (const field of ["heroImageName", "bannerImageName"]) {
      if (existing?.[field] && existing[field] !== series[field]) {
        replaced.push({ directory: tournamentBannerDirectory, filename: existing[field] });
      }
    }
    await removeUploadsQuietly(replaced, { operation: "saveAdminSeries", seriesId: series.id });
    return mapSeriesWithAggregate(series, true);
  } catch (error) {
    await removeUploadsQuietly(uploaded, {
      operation: "rollbackAdminSeriesUpload",
      seriesId,
    });
    throw error;
  }
};

const archiveAdminSeries = async (seriesId) => {
  const existing = await prisma.eventSeries.findUnique({
    where: { id: seriesId },
    include: { tournaments: buildSeriesTournamentInclude({ includeDrafts: true }) },
  });
  if (!existing) throw new HttpError(404, "Event series not found.");
  const series = await prisma.eventSeries.update({
    where: { id: seriesId },
    data: { isPublished: false },
  });
  return mapSeriesWithAggregate({ ...series, tournaments: existing.tournaments }, true);
};

const saveAdminSeriesTournament = async ({ eventId, body = {}, files } = {}) => {
  const event = await prisma.eventSeries.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new HttpError(404, "Event series not found.");

  if (body.tournamentId) {
    return attachTournamentToSeries({
      tournamentId: body.tournamentId,
      seriesId: eventId,
      seriesOrder: body.seriesOrder,
    });
  }

  return createAdminTournament({
    body: { ...body, seriesId: eventId },
    files,
  });
};

const deleteAdminSeries = async (seriesId) => {
  const existing = await prisma.eventSeries.findUnique({
    where: { id: seriesId },
    include: { tournaments: { select: { id: true } } },
  });
  if (!existing) throw new HttpError(404, "Event series not found.");
  if (existing.tournaments?.length) {
    throw new HttpError(409, "Archive the event before removing it while child tournaments exist.");
  }
  await prisma.eventSeries.delete({ where: { id: seriesId } });
  const uploads = ["heroImageName", "bannerImageName"]
    .filter((field) => existing[field])
    .map((field) => ({ directory: tournamentBannerDirectory, filename: existing[field] }));
  await removeUploadsQuietly(uploads, { operation: "deleteAdminSeries", seriesId });
};

module.exports = {
  mapSeries,
  listPublicSeries,
  getPublicSeriesBySlug,
  listAdminSeries,
  saveAdminSeries,
  deleteAdminSeries,
  listPublicEvents,
  getPublicEventBySlug,
  listAdminEvents,
  archiveAdminSeries,
  saveAdminSeriesTournament,
};
