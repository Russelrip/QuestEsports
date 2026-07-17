const { logger } = require("./logger");
const { removeUploadFiles, teamLogoDirectory } = require("../middleware/upload");
const {
  FILE_CLEANUP_JOB_NAME,
  TEAM_LOGO_CLEANUP_JOB_NAME,
  serializeCleanupUploads,
} = require("./upload-cleanup-job");

const removeUploadsQuietly = async (uploads, context = {}) => {
  try {
    await removeUploadFiles(uploads);
  } catch (error) {
    logger.warn("Failed to remove stale upload file.", {
      ...context,
      error,
    });
    const cleanupUploads = serializeCleanupUploads(uploads);
    if (cleanupUploads.length > 0) {
      try {
        const { enqueueJob } = require("./jobs");
        await enqueueJob(FILE_CLEANUP_JOB_NAME, { uploads: cleanupUploads });
      } catch (queueError) {
        logger.error("Failed to enqueue upload cleanup retry.", {
          ...context,
          error: queueError,
        });
      }
    }
  }
};

const removeTeamLogoIfUnreferenced = async ({ prisma, filename, context = {} }) => {
  if (!filename) return false;

  let registrationReferences;
  let savedTeamReferences;
  try {
    [registrationReferences, savedTeamReferences] = await Promise.all([
      prisma.teamRegistration.count({ where: { teamLogoName: filename } }),
      prisma.savedTeam.count({ where: { logoName: filename } }),
    ]);
  } catch (error) {
    logger.warn("Failed to check team logo references; cleanup will be retried.", {
      ...context,
      filename,
      error,
    });
    try {
      const { enqueueJob } = require("./jobs");
      await enqueueJob(TEAM_LOGO_CLEANUP_JOB_NAME, { filename });
    } catch (queueError) {
      logger.error("Failed to enqueue team logo cleanup retry.", {
        ...context,
        filename,
        error: queueError,
      });
    }
    return false;
  }

  if (registrationReferences > 0 || savedTeamReferences > 0) return false;

  await removeUploadsQuietly(
    [{ directory: teamLogoDirectory, filename }],
    context
  );
  return true;
};

module.exports = { removeUploadsQuietly, removeTeamLogoIfUnreferenced };
