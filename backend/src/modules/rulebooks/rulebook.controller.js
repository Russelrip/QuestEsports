const { asyncHandler } = require("../../lib/async-handler");
const {
  listRulebooks,
  getPublicRulebookBySlug,
  createRulebook,
  updateRulebook,
  deleteRulebook,
} = require("./rulebook.service");

const getRulebooks = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, rulebooks: await listRulebooks() });
});
const getRulebook = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, rulebook: await getPublicRulebookBySlug(req.params.slug) });
});
const createAdminRulebook = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, message: "Rulebook created successfully.", rulebook: await createRulebook(req.body) });
});
const updateAdminRulebook = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, message: "Rulebook updated successfully.", rulebook: await updateRulebook(req.params.rulebookId, req.body) });
});
const deleteAdminRulebook = asyncHandler(async (req, res) => {
  await deleteRulebook(req.params.rulebookId);
  res.status(200).json({ success: true, message: "Rulebook deleted successfully." });
});

module.exports = { getRulebooks, getRulebook, createAdminRulebook, updateAdminRulebook, deleteAdminRulebook };
