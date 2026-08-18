import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tournament game icon images", () => {
  it("bypasses Next image optimization for static game icons", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentsContent.tsx"),
      "utf8",
    );
    const gameIconImage = component.match(
      /<Image\s+src=\{icon\}[\s\S]*?\/>/,
    )?.[0];

    expect(gameIconImage).toMatch(/\bunoptimized(?:\s|$)/);
  });
});
