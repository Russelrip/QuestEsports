import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("uploaded sponsor logos", () => {
  it("bypasses Next image optimization for public and admin sponsor images", () => {
    const publicComponent = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );
    const adminComponent = readFileSync(
      resolve(process.cwd(), "components/admin/TournamentSponsorsManager.tsx"),
      "utf8",
    );

    const publicSponsorImage = publicComponent.match(
      /<Image\s+src=\{resolveMediaUrl\(sponsor\.logoUrl\)\}[\s\S]*?\/>/,
    )?.[0];
    const adminSponsorImage = adminComponent.match(
      /<Image\s+src=\{buildApiUrl\(item\.logoUrl\)\}[\s\S]*?\/>/,
    )?.[0];

    expect(publicSponsorImage).toContain("unoptimized");
    expect(adminSponsorImage).toContain("unoptimized");
  });
});
