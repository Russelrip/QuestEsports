import { describe, expect, it } from "vitest";
import { getDownloadFilename } from "../../lib/download-filename";

describe("download filename", () => {
  it("uses the server filename and keeps its extension consistent with the response", () => {
    expect(getDownloadFilename({
      contentDisposition: 'attachment; filename="DSC00589.jpg"',
      contentType: "image/jpeg",
      originalName: "ignored.webp",
      fallbackName: "photo",
    })).toBe("DSC00589.jpg");
  });

  it("does not save WebP bytes with a JPEG extension", () => {
    expect(getDownloadFilename({
      contentType: "image/webp",
      originalName: "DSC00589.jpg",
      fallbackName: "photo",
    })).toBe("DSC00589.webp");
  });
});
