import { describe, expect, it } from "vitest";
import { vetoMapArtwork } from "@/lib/veto-map-artwork";

describe("veto map artwork", () => {
  it("prefers uploaded artwork", () => {
    expect(vetoMapArtwork({ slug: "ascent", artworkUrl: "/api/uploads/veto/ascent.png" })).toBe("/api/uploads/veto/ascent.png");
  });

  it("falls back to the bundled splash for catalog maps", () => {
    expect(vetoMapArtwork({ slug: "corrode", artworkUrl: null })).toBe("/images/maps/corrode.webp");
  });

  it("leaves unknown maps without artwork", () => {
    expect(vetoMapArtwork({ slug: "custom-map", artworkUrl: null })).toBeNull();
  });
});
