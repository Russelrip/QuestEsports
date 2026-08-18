import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("admin game image previews", () => {
  it("direct-loads both resolved previews with the guarded fallback", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/admin/AdminGamesManager.tsx"),
      "utf8",
    );
    const cardImages = component.match(/const artworkUrl[\s\S]*$/)?.[0];

    expect(cardImages).toBeDefined();
    expect(cardImages).toContain("const artworkUrl = resolveImageUrl(item.artworkUrl)");
    expect(cardImages).toContain("const logoUrl = resolveImageUrl(item.logoUrl)");
    expect(cardImages).toContain("src={artworkUrl}");
    expect(cardImages).toContain("src={logoUrl}");
    expect(cardImages?.match(/unoptimized/g)).toHaveLength(2);
    expect(cardImages?.match(/onError=\{handlePreviewError\}/g)).toHaveLength(2);
    expect(component).toContain('image.src = "/images/logo.png"');
    expect(component).toContain('image.style.display = "none"');
  });
});
