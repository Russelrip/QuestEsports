import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRemaining, splitDuration } from "../../lib/match-time";

const publicDir = path.join(process.cwd(), "public");
const pngDimensions = (name: string) => {
  const bytes = fs.readFileSync(path.join(publicDir, name));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

describe("foundation icon assets", () => {
  it.each([
    ["favicon-16.png", 16], ["favicon-32.png", 32], ["favicon-48.png", 48],
    ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512],
  ])("provides %s at its declared square size", (name, size) => {
    expect(pngDimensions(name)).toEqual({ width: size, height: size });
  });

  it("contains 16, 32, and 48 pixel favicon variants", () => {
    const bytes = fs.readFileSync(path.join(publicDir, "favicon.ico"));
    const count = bytes.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => {
      const width = bytes[6 + index * 16];
      return width === 0 ? 256 : width;
    });
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 48]));
  });

  it("declares all exact icons in metadata and the web manifest", () => {
    const metadata = fs.readFileSync(path.join(process.cwd(), "lib/site.ts"), "utf8");
    const manifest = fs.readFileSync(path.join(process.cwd(), "app/manifest.ts"), "utf8");
    for (const asset of ["favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png", "icon-192.png"]) expect(metadata).toContain(asset);
    expect(manifest).toContain("icon-192.png");
    expect(manifest).toContain("icon-512.png");
    expect(manifest).toContain('theme_color: "#0b1020"');
  });
});

describe("match countdown timing", () => {
  it("uses the server clock offset and clamps at zero", () => {
    expect(getRemaining(130_000, 20_000, 100_000)).toBe(10_000);
    expect(getRemaining(100_000, 20_000, 100_000)).toBe(0);
    expect(splitDuration(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  });
});
