const { asyncHandler } = require("../../lib/async-handler");
const service = require("./game.service");

const getPublicGames = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, games: await service.listGames() });
});

const getAdminGames = asyncHandler(async (req, res) => {
  res
    .status(200)
    .json({ success: true, games: await service.listGames({ includeInactive: true }) });
});

module.exports = { getPublicGames, getAdminGames };
