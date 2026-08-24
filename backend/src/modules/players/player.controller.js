const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const service = require("./player-profile.service");

const getPublicPlayerProfile = asyncHandler(async (req, res) => {
  const profile = await service.getPublicProfile(req.params.publicId);
  if (!profile) throw new HttpError(404, "Player not found.");
  res.status(200).json({ success: true, player: profile });
});

module.exports = { getPublicPlayerProfile };
