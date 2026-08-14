const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const {
  prepareEventAlbumPhotoDownload,
  safeDownloadName,
} = require("../src/modules/media/event-album-download");

test("event album downloads transcode optimized WebP bytes into a real JPEG", async () => {
  const webp = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 80, g: 40, b: 160 },
    },
  }).webp().toBuffer();

  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/webp",
    data: webp,
    originalName: "DSC00589.jpg",
  });

  assert.equal(download.contentType, "image/jpeg");
  assert.equal(download.filename, "DSC00589.jpg");
  assert.deepEqual(download.data.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal((await sharp(download.data).metadata()).format, "jpeg");
});

test("event album downloads return an available original without re-encoding it", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const download = await prepareEventAlbumPhotoDownload({
    contentType: "image/jpeg",
    data: jpeg,
    originalName: "camera-original.jpeg",
  });

  assert.equal(download.data, jpeg);
  assert.equal(download.filename, "camera-original.jpg");
});

test("download filenames cannot inject response headers", () => {
  assert.equal(safeDownloadName('photo\r\n"bad.jpg', "image/jpeg"), "photo---bad.jpg");
});
