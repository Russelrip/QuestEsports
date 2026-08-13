import { describe, expect, it } from "vitest";
import {
  buildEventAlbumUploadBatches,
  EVENT_ALBUM_UPLOAD_BATCH_SIZE,
  excludeAlreadyUploadedFiles,
} from "../../lib/event-album-upload";

describe("event album upload batching", () => {
  it("queues every selected item without imposing an overall limit", () => {
    const items = Array.from({ length: 205 }, (_, index) => ({ index, size: 0 }));
    const batches = buildEventAlbumUploadBatches(items);

    expect(EVENT_ALBUM_UPLOAD_BATCH_SIZE).toBe(1);
    expect(batches).toHaveLength(205);
    expect(batches.every((batch) => batch.length === 1)).toBe(true);
    expect(batches.flat()).toEqual(items);
  });

  it("isolates every photo in its own request", () => {
    const items = [{ name: "one.jpg" }, { name: "two.jpg" }, { name: "three.jpg" }];
    expect(buildEventAlbumUploadBatches(items)).toEqual([
      [items[0]],
      [items[1]],
      [items[2]],
    ]);
  });

  it("returns no requests for an empty selection", () => {
    expect(buildEventAlbumUploadBatches([])).toEqual([]);
  });

  it("skips filenames already present in the album when resuming a selection", () => {
    const files = [
      { name: "Quest 1.JPG", size: 100 },
      { name: "Quest 2.jpg", size: 100 },
      { name: "Quest 3.jpg", size: 100 },
    ];

    const result = excludeAlreadyUploadedFiles(files, ["quest 1.jpg", null, "QUEST 2.JPG"]);

    expect(result.pending).toEqual([files[2]]);
    expect(result.skipped).toEqual([files[0], files[1]]);
  });
});
