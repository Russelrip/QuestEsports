const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const {
  streamFileToResponse,
  isClientDisconnect,
} = require("../src/lib/stream-response");

const tempFile = (contents = "hello world") => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "quest-stream-")),
    "asset.bin",
  );
  fs.writeFileSync(file, contents);
  return file;
};

// A response that accepts everything, like a client that stayed.
const collectingResponse = (chunks) =>
  new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });

// A response that fails mid-write with the given code, like a client that left.
const disconnectingResponse = (code) =>
  new Writable({
    write(_chunk, _encoding, callback) {
      const error = new Error("client went away");
      error.code = code;
      callback(error);
    },
  });

test("a complete download resolves true and delivers the body", async () => {
  const file = tempFile("image-bytes");
  const chunks = [];
  const delivered = await streamFileToResponse(file, collectingResponse(chunks));
  assert.equal(delivered, true);
  assert.equal(Buffer.concat(chunks).toString(), "image-bytes");
});

test("a client disconnecting is not an error", async (t) => {
  // Browsers abort image requests constantly and legitimately: navigating away,
  // scrolling past a lazy-loaded image, closing the tab. Logging a stack trace
  // for each one is how a real error gets missed.
  for (const code of ["ERR_STREAM_PREMATURE_CLOSE", "EPIPE", "ECONNRESET"]) {
    await t.test(code, async () => {
      const file = tempFile();
      const delivered = await streamFileToResponse(file, disconnectingResponse(code));
      // Reported, not thrown: the caller learns the body did not land, and
      // nothing reaches the error middleware.
      assert.equal(delivered, false);
    });
  }
});

test("a genuine streaming failure still throws", async () => {
  const file = tempFile();
  const failing = new Writable({
    write(_chunk, _encoding, callback) {
      const error = new Error("disk exploded");
      error.code = "EIO";
      callback(error);
    },
  });
  await assert.rejects(
    () => streamFileToResponse(file, failing),
    (error) => error.code === "EIO",
  );
});

test("a missing file still throws rather than being swallowed", async () => {
  // ENOENT means the asset is gone from disk, which is a real server problem
  // and must not be silently reported as a client disconnect.
  await assert.rejects(
    () => streamFileToResponse(path.join(os.tmpdir(), "definitely-not-here.bin"), collectingResponse([])),
    (error) => error.code === "ENOENT",
  );
});

test("only socket-gone codes are treated as a disconnect", () => {
  for (const code of ["ERR_STREAM_PREMATURE_CLOSE", "EPIPE", "ECONNRESET"]) {
    assert.equal(isClientDisconnect({ code }), true);
  }
  // Anything that describes a server-side problem must stay loud.
  for (const code of ["ENOENT", "EACCES", "EIO", "EISDIR", undefined, null]) {
    assert.equal(isClientDisconnect({ code }), false);
  }
  assert.equal(isClientDisconnect(undefined), false);
});

test("every file-streaming route uses the helper rather than raw pipeline", () => {
  // A new route that reaches for `pipeline(createReadStream(...), res)` would
  // reintroduce the noise, so assert the boundary holds.
  const sources = [
    "../src/modules/media/media.controller.js",
    "../src/modules/media/event-album.controller.js",
    "../src/modules/uploads/upload.routes.js",
  ];
  for (const relative of sources) {
    const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
    assert.match(source, /streamFileToResponse/, `${relative} must use the helper`);
    assert.doesNotMatch(
      source,
      /pipeline\(\s*createReadStream/,
      `${relative} must not stream with a raw pipeline`,
    );
  }
});
