const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/lib/upload-cleanup-job.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");

test("file cleanup jobs serialize only configured directories and process them", async () => {
  const removed = [];
  const { module: cleanupJob, restore } = loadModuleWithMocks(servicePath, {
    [uploadModulePath]: {
      removeUploadFiles: async (uploads) => removed.push(...uploads),
      avatarDirectory: "C:/uploads/avatars",
      bankTransferProofDirectory: "C:/private/proofs",
      gameAssetDirectory: "C:/uploads/games",
      posterImageDirectory: "C:/uploads/posters",
      sponsorLogoDirectory: "C:/uploads/sponsors",
      supportScreenshotDirectory: "C:/private/support-screenshots",
      teamLogoDirectory: "C:/uploads/teams",
      tournamentBannerDirectory: "C:/uploads/tournaments",
      tournamentScheduleDirectory: "C:/uploads/schedules",
    },
  });

  try {
    const uploads = cleanupJob.serializeCleanupUploads([
      { directory: "C:/private/proofs", filename: "proof.webp" },
      { directory: "C:/private/support-screenshots", filename: "support-shot.webp" },
      { directory: "C:/untrusted", filename: "secret.txt" },
    ]);
    assert.deepEqual(uploads, [
      { directoryKey: "bank_transfer_proofs", filename: "proof.webp" },
      { directoryKey: "support_screenshots", filename: "support-shot.webp" },
    ]);
    await cleanupJob.processFileCleanupJob({ uploads });
    assert.deepEqual(removed, [
      { directory: "C:/private/proofs", filename: "proof.webp" },
      { directory: "C:/private/support-screenshots", filename: "support-shot.webp" },
    ]);
  } finally {
    restore();
  }
});

test("team logo cleanup jobs preserve referenced files and delete unreferenced files", async () => {
  const removed = [];
  const registrationQueries = [];
  const registrations = [
    {
      id: "historical-registration",
      savedTeamId: "different-team",
      teamLogoName: "historical-snapshot.webp",
    },
  ];
  const { module: cleanupJob, restore } = loadModuleWithMocks(servicePath, {
    [uploadModulePath]: {
      removeUploadFiles: async (uploads) => removed.push(...uploads),
      teamLogoDirectory: "C:/uploads/teams",
    },
  });

  try {
    await cleanupJob.processTeamLogoCleanupJob(
      { filename: "shared.webp" },
      {
        teamRegistration: {
          count: async (query) => {
            registrationQueries.push(query);
            return 1;
          },
        },
        savedTeam: { count: async () => 0 },
      }
    );
    assert.deepEqual(removed, []);

    await cleanupJob.processTeamLogoCleanupJob(
      { filename: "saved-team-logo.webp" },
      {
        teamRegistration: {
          count: async (query) => {
            registrationQueries.push(query);
            return 0;
          },
        },
        savedTeam: { count: async () => 1 },
      }
    );
    assert.deepEqual(removed, []);

    await cleanupJob.processTeamLogoCleanupJob(
      { filename: "historical-snapshot.webp" },
      {
        teamRegistration: {
          count: async (query) => {
            registrationQueries.push(query);
            return registrations.filter(
              (registration) => registration.teamLogoName === query.where.teamLogoName
            ).length;
          },
        },
        savedTeam: { count: async () => 0 },
      }
    );
    assert.deepEqual(removed, []);
    assert.deepEqual(registrationQueries[2], {
      where: { teamLogoName: "historical-snapshot.webp" },
    });

    await cleanupJob.processTeamLogoCleanupJob(
      { filename: "unused.webp" },
      {
        teamRegistration: { count: async () => 0 },
        savedTeam: { count: async () => 0 },
      }
    );
    assert.deepEqual(removed, [
      { directory: "C:/uploads/teams", filename: "unused.webp" },
    ]);
  } finally {
    restore();
  }
});
