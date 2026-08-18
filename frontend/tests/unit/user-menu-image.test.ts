import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop user-menu avatar", () => {
  it("anchors the absolute profile image to its avatar wrapper", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/UserMenu.tsx"),
      "utf8",
    );

    const avatarWrapper = component.match(
      /<span className="account-menu-avatar([^"]*)">[\s\S]*?<Image[\s\S]*?\/>/,
    )?.[0];

    expect(avatarWrapper).toBeDefined();
    expect(avatarWrapper).toContain("relative");
    expect(avatarWrapper).toContain("className=\"absolute h-full w-full object-cover\"");
  });
});
