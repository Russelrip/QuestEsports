import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("uploaded tournament banner images", () => {
  it("bypasses Next image optimization for public upload URLs", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentBannerImage.tsx"),
      "utf8",
    );
    const bannerImage = component.match(
      /<Image\s+src=\{resolveMediaUrl\(bannerUrl\)\}[\s\S]*?\/>/,
    )?.[0];

    expect(bannerImage).toContain("unoptimized");
  });
});
