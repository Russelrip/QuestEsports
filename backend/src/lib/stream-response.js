const { createReadStream } = require("fs");
const { pipeline } = require("stream/promises");

// A client that goes away mid-download is not a server fault.
//
// Browsers abort image requests constantly and legitimately: the user navigates
// away, scrolls past a lazy-loaded image, or the tab is closed. `pipeline`
// rejects when that happens, and letting it reach the error middleware logs a
// stack trace for something nobody can act on — 277 of them in one recent
// window, which is exactly how a real error gets missed.
//
// Deliberately narrow: only the codes that mean "the socket is already gone".
// A read failure such as ENOENT or EACCES is a genuine server problem and
// still propagates.
const CLIENT_DISCONNECT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "EPIPE",
  "ECONNRESET",
]);

const isClientDisconnect = (error) => CLIENT_DISCONNECT_CODES.has(error?.code);

// Streams a file to the response. Resolves `true` when the whole body was
// delivered, `false` when the client disconnected first. Any other failure
// throws, so genuine problems still reach the error handler.
const streamFileToResponse = async (path, res) => {
  try {
    await pipeline(createReadStream(path), res);
    return true;
  } catch (error) {
    if (isClientDisconnect(error)) return false;
    throw error;
  }
};

module.exports = {
  streamFileToResponse,
  isClientDisconnect,
  CLIENT_DISCONNECT_CODES,
};
