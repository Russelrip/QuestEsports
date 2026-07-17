const path = require("path");
const {
  removeUploadFiles,
  avatarDirectory,
  bankTransferProofDirectory,
  gameAssetDirectory,
  posterImageDirectory,
  sponsorLogoDirectory,
  teamLogoDirectory,
  tournamentBannerDirectory,
  tournamentScheduleDirectory,
} = require("../middleware/upload");

const FILE_CLEANUP_JOB_NAME = "file_cleanup";
const TEAM_LOGO_CLEANUP_JOB_NAME = "team_logo_cleanup";
const cleanupDirectories = {
  avatars: avatarDirectory,
  bank_transfer_proofs: bankTransferProofDirectory,
  game_assets: gameAssetDirectory,
  poster_images: posterImageDirectory,
  sponsor_logos: sponsorLogoDirectory,
  team_logos: teamLogoDirectory,
  tournament_banners: tournamentBannerDirectory,
  tournament_schedules: tournamentScheduleDirectory,
};

const getDirectoryKey = (directory) =>
  Object.entries(cleanupDirectories).find(
    ([, configuredDirectory]) =>
      configuredDirectory &&
      directory &&
      path.resolve(configuredDirectory) === path.resolve(directory)
  )?.[0] || null;

const serializeCleanupUploads = (uploads) =>
  uploads.map(({ directory, filename }) => ({
    directoryKey: getDirectoryKey(directory),
    filename,
  })).filter(({ directoryKey, filename }) => directoryKey && filename);

const processFileCleanupJob = async (payload) => {
  const requestedUploads = Array.isArray(payload?.uploads) ? payload.uploads : [];
  const uploads = requestedUploads.map(({ directoryKey, filename }) => {
    const directory = cleanupDirectories[directoryKey];
    if (!directory || !filename) throw new Error("File cleanup job contains an invalid upload target.");
    return { directory, filename };
  });
  await removeUploadFiles(uploads);
};

const processTeamLogoCleanupJob = async (payload, prisma) => {
  const filename = String(payload?.filename || "").trim();
  if (!filename) throw new Error("Team logo cleanup job requires a filename.");
  const [registrationReferences, savedTeamReferences] = await Promise.all([
    prisma.teamRegistration.count({ where: { teamLogoName: filename } }),
    prisma.savedTeam.count({ where: { logoName: filename } }),
  ]);
  if (registrationReferences > 0 || savedTeamReferences > 0) return;
  await removeUploadFiles([{ directory: teamLogoDirectory, filename }]);
};

module.exports = {
  FILE_CLEANUP_JOB_NAME,
  TEAM_LOGO_CLEANUP_JOB_NAME,
  processFileCleanupJob,
  processTeamLogoCleanupJob,
  serializeCleanupUploads,
};
