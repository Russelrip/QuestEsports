const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/uploads/upload.service.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");

test("streamUpload validates a small header and returns a path without buffering the file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "quest-upload-stream-"));
  const filename = "valid-image.png";
  const image = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03,
  ]);
  await fs.writeFile(path.join(directory, filename), image);
  const { module: uploadService, restore } = loadModuleWithMocks(servicePath, {
    [uploadModulePath]: {
      detectImageType: (buffer) =>
        buffer[0] === 0x89 && buffer[1] === 0x50 ? "png" : null,
      teamLogoDirectory: directory,
      tournamentBannerDirectory: directory,
      posterImageDirectory: directory,
      avatarDirectory: directory,
      gameAssetDirectory: directory,
      sponsorLogoDirectory: directory,
    },
  });

  try {
    const result = await uploadService.streamUpload("team-logos", filename);
    assert.equal(result.path, path.resolve(directory, filename));
    assert.equal(result.size, image.length);
    assert.equal(result.contentType, "image/png");
    assert.equal(Object.prototype.hasOwnProperty.call(result, "data"), false);
    await assert.rejects(
      uploadService.streamUpload("team-logos", "../valid-image.png"),
      (error) => error.statusCode === 404
    );
  } finally {
    restore();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
