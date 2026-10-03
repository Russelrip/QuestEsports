import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("uploaded sponsor logos", () => {
  it("bypasses Next image optimization for public and admin sponsor images", () => {
    const publicComponent = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );
    // The admin row moved out of TournamentSponsorsManager into its own
    // component when sponsors became editable in place; the requirement did not
    // move with it, which is what this guards.
    const adminComponent = readFileSync(
      resolve(process.cwd(), "components/admin/SponsorRow.tsx"),
      "utf8",
    );

    const publicSponsorImage = publicComponent.match(
      /const logoUrl = resolveImageUrl\(sponsor\.logoUrl\);[\s\S]*?<Image[\s\S]*?\/>/,
    )?.[0];
    const adminSponsorImage = adminComponent.match(
      /resolveImageUrl\(sponsor\.logoUrl\)[\s\S]*?<Image[\s\S]*?\/>/,
    )?.[0];

    // Named rather than bare toContain, so a markup move fails as "not found"
    // instead of the assertion library's complaint about an undefined argument.
    expect(publicSponsorImage, "public sponsor <Image> not found").toBeTypeOf("string");
    expect(adminSponsorImage, "admin sponsor <Image> not found").toBeTypeOf("string");
    expect(publicSponsorImage).toContain("unoptimized");
    expect(adminSponsorImage).toContain("unoptimized");
  });
});
