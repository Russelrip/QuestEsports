const { createOperation, idParameter } = require("./helpers");

const uploadsPaths = {
  "/api/uploads/tournament-banners/{filename}": {
    get: createOperation("Media", "Stream a tournament banner", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/poster-images/{filename}": {
    get: createOperation("Media", "Stream a poster image file", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/team-logos/{filename}": {
    get: createOperation("Media", "Stream a team logo", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/avatars/{filename}": {
    get: createOperation("Media", "Stream an avatar", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/game-assets/{filename}": {
    get: createOperation("Media", "Stream a game asset", {
      parameters: idParameter("filename"),
    }),
  },
  "/api/uploads/sponsor-logos/{filename}": {
    get: createOperation("Media", "Stream a sponsor logo", {
      parameters: idParameter("filename"),
    }),
  },
};

module.exports = { uploadsPaths };
