const { logger } = require("./logger");
const { removeUploadFiles } = require("../middleware/upload");

const removeUploadsQuietly = async (uploads, context = {}) => {
  try {
    await removeUploadFiles(uploads);
  } catch (error) {
    logger.warn("Failed to remove stale upload file.", {
      ...context,
      error,
    });
  }
};

module.exports = { removeUploadsQuietly };
