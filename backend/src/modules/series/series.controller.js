const { asyncHandler } = require("../../lib/async-handler");
const { listTeamRegistrations } = require("../admin/admin.service");
const service = require("./series.service");

const getPublicSeries = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.listPublicSeries() });
});

const getPublicSeriesDetail = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.getPublicSeriesBySlug(req.params.slug) });
});

const getPublicEvents = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, events: await service.listPublicEvents() });
});

const getPublicEventDetail = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, event: await service.getPublicEventBySlug(req.params.slug) });
});

const getAdminSeries = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.listAdminSeries() });
});

const getAdminEvents = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, events: await service.listAdminEvents() });
});

const getEventRegistrations = asyncHandler(async (req, res) => {
  const result = await listTeamRegistrations({
    ...req.query,
    eventId: req.params.eventId,
  });

  res.status(200).json({
    success: true,
    registrations: result.items,
    tournaments: result.tournaments,
    pagination: result.pagination,
  });
});

const getEventFiles = (req) => ({
  ...(req.files || {}),
  ...(req.file ? { heroImage: [req.file] } : {}),
});

const createSeries = asyncHandler(async (req, res) => {
  const series = await service.saveAdminSeries({ body: req.body, file: req.file, files: req.files });
  res.status(201).json({ success: true, message: "Event series created.", series });
});

const updateSeries = asyncHandler(async (req, res) => {
  const series = await service.saveAdminSeries({
    seriesId: req.params.seriesId,
    body: req.body,
    file: req.file,
    files: req.files,
  });
  res.status(200).json({ success: true, message: "Event series updated.", series });
});

const createEvent = asyncHandler(async (req, res) => {
  const event = await service.saveAdminSeries({ body: req.body, files: getEventFiles(req) });
  res.status(201).json({ success: true, message: "Event created.", event });
});

const updateEvent = asyncHandler(async (req, res) => {
  const event = await service.saveAdminSeries({
    seriesId: req.params.eventId,
    body: req.body,
    files: getEventFiles(req),
  });
  res.status(200).json({ success: true, message: "Event updated.", event });
});

const archiveEvent = asyncHandler(async (req, res) => {
  const event = await service.archiveAdminSeries(req.params.eventId);
  res.status(200).json({ success: true, message: "Event archived.", event });
});

const createEventTournament = asyncHandler(async (req, res) => {
  const tournament = await service.saveAdminSeriesTournament({
    eventId: req.params.eventId,
    body: req.body,
    files: req.files,
  });
  res.status(201).json({ success: true, message: "Tournament added to event.", tournament });
});

const deleteSeries = asyncHandler(async (req, res) => {
  await service.deleteAdminSeries(req.params.seriesId);
  res.status(200).json({ success: true, message: "Event series deleted." });
});

module.exports = {
  getPublicSeries,
  getPublicSeriesDetail,
  getPublicEvents,
  getPublicEventDetail,
  getAdminSeries,
  getAdminEvents,
  getEventRegistrations,
  createSeries,
  updateSeries,
  createEvent,
  updateEvent,
  archiveEvent,
  createEventTournament,
  deleteSeries,
};
