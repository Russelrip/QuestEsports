const { asyncHandler } = require("../../lib/async-handler");
const service = require("./series.service");

const getPublicSeries = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.listPublicSeries() });
});
const getPublicSeriesDetail = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.getPublicSeriesBySlug(req.params.slug) });
});
const getAdminSeries = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, series: await service.listAdminSeries() });
});
const createSeries = asyncHandler(async (req, res) => {
  const series = await service.saveAdminSeries({ body: req.body, file: req.file });
  res.status(201).json({ success: true, message: "Event series created.", series });
});
const updateSeries = asyncHandler(async (req, res) => {
  const series = await service.saveAdminSeries({ seriesId: req.params.seriesId, body: req.body, file: req.file });
  res.status(200).json({ success: true, message: "Event series updated.", series });
});
const deleteSeries = asyncHandler(async (req, res) => {
  await service.deleteAdminSeries(req.params.seriesId);
  res.status(200).json({ success: true, message: "Event series deleted." });
});

module.exports = { getPublicSeries, getPublicSeriesDetail, getAdminSeries, createSeries, updateSeries, deleteSeries };
