const { logger } = require("./logger");
const { env } = require("../config/env");
const { removeUploadFiles, teamLogoDirectory } = require("../middleware/upload");
const {
  FILE_CLEANUP_JOB_NAME,
  TEAM_LOGO_CLEANUP_JOB_NAME,
  serializeCleanupUploads,
} = require("./upload-cleanup-job");

const TEAM_LOGO_CLEANUP_GRACE_MS = Math.max(
  Number(env.CACHE_TTL_SECONDS || 0) * 1000,
  60 * 60 * 1000
);

const removeUploadsQuietly = async (uploads, context = {}) => {
  try {
    await removeUploadFiles(uploads);
    return true;
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
    return false;
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

const scheduleTeamLogoCleanup = async ({ filename, context = {}, tx, database }) => {
  if (!filename) return false;

  const transactionDatabase = tx || database;
  const availableAt = new Date(Date.now() + TEAM_LOGO_CLEANUP_GRACE_MS);
  try {
    const { enqueueJob } = require("./jobs");
    await enqueueJob(
      TEAM_LOGO_CLEANUP_JOB_NAME,
      { filename },
      {
        ...(transactionDatabase ? { database: transactionDatabase } : {}),
        availableAt,
      }
    );
  } catch (error) {
    logger.error("Failed to enqueue delayed team logo cleanup.", {
      ...context,
      filename,
      error,
    });
    if (transactionDatabase) throw error;
    return false;
  }

  return true;
};

module.exports = {
  TEAM_LOGO_CLEANUP_GRACE_MS,
  removeUploadsQuietly,
  removeTeamLogoIfUnreferenced,
  scheduleTeamLogoCleanup,
};
