import { describe, expect, it } from "vitest";
import {
  buildEventAlbumUploadBatches,
  EVENT_ALBUM_UPLOAD_BATCH_MAX_BYTES,
  EVENT_ALBUM_UPLOAD_BATCH_SIZE,
} from "../../lib/event-album-upload";

describe("event album upload batching", () => {
  it("queues every selected item without imposing an overall limit", () => {
    const items = Array.from({ length: 205 }, (_, index) => ({ index, size: 0 }));
    const batches = buildEventAlbumUploadBatches(items);

    expect(EVENT_ALBUM_UPLOAD_BATCH_SIZE).toBe(10);
    expect(batches).toHaveLength(21);
    expect(batches.slice(0, -1).every((batch) => batch.length === 10)).toBe(true);
    expect(batches.at(-1)).toEqual(items.slice(200));
    expect(batches.flat()).toEqual(items);
  });

  it("keeps each request below the safe combined byte target", () => {
    const mib = 1024 * 1024;
    const items = [
      { name: "one.jpg", size: 9 * mib },
      { name: "two.jpg", size: 9 * mib },
      { name: "three.jpg", size: 9 * mib },
      { name: "four.jpg", size: 2 * mib },
    ];

    const batches = buildEventAlbumUploadBatches(items);

    expect(EVENT_ALBUM_UPLOAD_BATCH_MAX_BYTES).toBe(18 * mib);
    expect(batches.map((batch) => batch.map((item) => item.name))).toEqual([
      ["one.jpg", "two.jpg"],
      ["three.jpg", "four.jpg"],
    ]);
    expect(batches.flat()).toEqual(items);
  });

  it("returns no requests for an empty selection", () => {
    expect(buildEventAlbumUploadBatches([])).toEqual([]);
  });
});
