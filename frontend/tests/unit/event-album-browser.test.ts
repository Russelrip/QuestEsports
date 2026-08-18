import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("event album downloads", () => {
  it("resolves the image endpoint before appending the original-download query", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/gallery/EventAlbumBrowser.tsx"),
      "utf8",
    );

    expect(component).toContain(
      "const resolvedImageUrl = resolveImageUrl(selectedPhoto.imageAsset.imageUrl);",
    );
    expect(component).toContain("if (!resolvedImageUrl) throw new Error");
    expect(component).toContain("const downloadUrl = new URL(resolvedImageUrl, window.location.origin);");
    expect(component).toContain('downloadUrl.searchParams.append("download", "original");');
    expect(component).not.toContain("buildApiUrl");
  });
});
