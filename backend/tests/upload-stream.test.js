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

test("listPublicUploads returns only allowlisted public image folders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quest-upload-list-"));
  const directories = Object.fromEntries(
    ["team-logos", "tournament-banners", "poster-images", "avatars", "game-assets", "sponsor-logos"].map(
      (name) => [name, path.join(root, name)]
    )
  );
  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(directories["tournament-banners"], "event-banner.webp"), Buffer.alloc(25));
  await fs.writeFile(path.join(directories["tournament-banners"], "notes.txt"), "not an image");

  const { module: uploadService, restore } = loadModuleWithMocks(servicePath, {
    [uploadModulePath]: {
      detectImageType: () => "webp",
      teamLogoDirectory: directories["team-logos"],
      tournamentBannerDirectory: directories["tournament-banners"],
      posterImageDirectory: directories["poster-images"],
      avatarDirectory: directories.avatars,
      gameAssetDirectory: directories["game-assets"],
      sponsorLogoDirectory: directories["sponsor-logos"],
    },
  });

  try {
    const result = await uploadService.listPublicUploads({ directory: "tournament-banners" });
    assert.equal(result.pagination.total, 1);
    assert.deepEqual(result.directories, [
      "team-logos",
      "tournament-banners",
      "poster-images",
      "avatars",
      "game-assets",
      "sponsor-logos",
    ]);
    assert.equal(result.items[0].directory, "tournament-banners");
    assert.equal(result.items[0].filename, "event-banner.webp");
    assert.equal(result.items[0].contentType, "image/webp");
    assert.equal(result.items[0].byteSize, 25);
    assert.equal(result.items[0].imageUrl, "/api/uploads/tournament-banners/event-banner.webp");
  } finally {
    restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("public upload pagination stats only files on the requested page", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quest-upload-page-"));
  const directory = path.join(root, "poster-images");
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      fs.writeFile(
        path.join(directory, `${String(1_800_000_000_000 - index)}-image.webp`),
        Buffer.alloc(1),
      ),
    ),
  );
  let statCalls = 0;
  const originalStat = fs.stat;
  fs.stat = async (...args) => {
    statCalls += 1;
    return originalStat(...args);
  };
  const { module: uploadService, restore } = loadModuleWithMocks(servicePath, {
    [uploadModulePath]: {
      detectImageType: () => "webp",
      teamLogoDirectory: path.join(root, "team-logos"),
      tournamentBannerDirectory: path.join(root, "tournament-banners"),
      posterImageDirectory: directory,
      avatarDirectory: path.join(root, "avatars"),
      gameAssetDirectory: path.join(root, "game-assets"),
      sponsorLogoDirectory: path.join(root, "sponsor-logos"),
    },
  });
  try {
    const result = await uploadService.listPublicUploads({
      directory: "poster-images",
      page: "3",
      pageSize: "10",
    });
    assert.equal(result.pagination.total, 100);
    assert.equal(result.items.length, 10);
    assert.equal(statCalls, 10);
  } finally {
    restore();
    fs.stat = originalStat;
    await fs.rm(root, { recursive: true, force: true });
  }
});
