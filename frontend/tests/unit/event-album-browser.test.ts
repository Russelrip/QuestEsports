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

describe("event album pagination contract", () => {
  it("keeps the first photo page opt-in and bounded while preserving no-query support", () => {
    const client = readFileSync(resolve(process.cwd(), "lib/event-albums.ts"), "utf8");
    expect(client).toContain("photoOptions: { page?: number; pageSize?: number } = { page: 1, pageSize: 30 }");
    expect(client).toContain('searchParams.set("photoPage", String(photoOptions.page));');
    expect(client).toContain('searchParams.set("photoPageSize", String(photoOptions.pageSize));');
  });
});

describe("event album lightbox navigation", () => {
  it("uses direction-aware 400ms entry animations with a reduced-motion fallback", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/gallery/EventAlbumBrowser.tsx"),
      "utf8",
    );
    const stylesheet = readFileSync(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    );

    expect(component).toContain('type PhotoDirection = "next" | "previous";');
    expect(component).toContain('const [photoDirection, setPhotoDirection] = useState<PhotoDirection | null>(null);');
    expect(component).toContain('selectPhoto(selectedIndex - 1, "previous")');
    expect(component).toContain('selectPhoto(selectedIndex + 1, "next")');
    expect(component).toContain("gallery-photo-enter--${photoDirection}");
    expect(stylesheet).toContain("@keyframes gallery-photo-enter-next");
    expect(stylesheet).toContain("@keyframes gallery-photo-enter-previous");
    expect(stylesheet).toContain("animation: gallery-photo-enter-next 400ms");
    expect(stylesheet).toContain("animation: gallery-photo-enter-previous 400ms");
    expect(stylesheet).toContain(".gallery-photo-enter--next, .gallery-photo-enter--previous");
  });
});
