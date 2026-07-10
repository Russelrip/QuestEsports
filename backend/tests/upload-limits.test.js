const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ADMIN_UPLOAD_MAX_FILE_SIZE,
  TEAM_LOGO_MAX_FILE_SIZE,
  adminTournamentAssetsUpload,
  dbImageUpload,
  imageUpload,
  tournamentBannerUpload,
} = require("../src/middleware/upload");

test("upload middleware keeps team logos at 5 MB and admin assets at 10 MB", () => {
  assert.equal(TEAM_LOGO_MAX_FILE_SIZE, 5 * 1024 * 1024);
  assert.equal(ADMIN_UPLOAD_MAX_FILE_SIZE, 10 * 1024 * 1024);
  assert.equal(imageUpload.limits.fileSize, TEAM_LOGO_MAX_FILE_SIZE);
  assert.equal(tournamentBannerUpload.limits.fileSize, ADMIN_UPLOAD_MAX_FILE_SIZE);
  assert.equal(dbImageUpload.limits.fileSize, ADMIN_UPLOAD_MAX_FILE_SIZE);
  assert.equal(
    adminTournamentAssetsUpload.limits.fileSize,
    ADMIN_UPLOAD_MAX_FILE_SIZE
  );
});
