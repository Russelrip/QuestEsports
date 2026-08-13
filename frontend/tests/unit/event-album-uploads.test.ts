import { describe, expect, it } from "vitest";
import {
  buildEventAlbumUploadBatches,
  EVENT_ALBUM_UPLOAD_BATCH_SIZE,
} from "../../lib/event-album-upload";

describe("event album upload batching", () => {
  it("queues every selected item without imposing an overall limit", () => {
    const items = Array.from({ length: 205 }, (_, index) => index);
    const batches = buildEventAlbumUploadBatches(items);

    expect(EVENT_ALBUM_UPLOAD_BATCH_SIZE).toBe(10);
    expect(batches).toHaveLength(21);
    expect(batches.slice(0, -1).every((batch) => batch.length === 10)).toBe(true);
    expect(batches.at(-1)).toEqual([200, 201, 202, 203, 204]);
    expect(batches.flat()).toEqual(items);
  });

  it("returns no requests for an empty selection", () => {
    expect(buildEventAlbumUploadBatches([])).toEqual([]);
  });
});
