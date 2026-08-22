import { describe, expect, it } from "vitest";
import { adminNavigationGroups } from "../../lib/admin";
import { navIconPaths } from "../../lib/icons";
import { primaryNavItems, secondaryNavItems } from "../../lib/site";

const publicNavItems = [...primaryNavItems, ...secondaryNavItems];
const adminNavLinks = adminNavigationGroups.flatMap((group) => group.links);

describe("navigation icons", () => {
  it("gives every public navigation item a drawable icon", () => {
    expect(publicNavItems.length).toBeGreaterThan(0);

    for (const item of publicNavItems) {
      expect(navIconPaths[item.icon], `${item.href} icon "${item.icon}"`).toBeTruthy();
    }
  });

  it("gives every admin navigation link a drawable icon", () => {
    for (const link of adminNavLinks) {
      expect(navIconPaths[link.icon], `${link.href} icon "${link.icon}"`).toBeTruthy();
    }
  });

  it("shares one icon set between the public and admin shells", () => {
    const publicKeys = new Set(publicNavItems.map((item) => item.icon));
    const adminKeys = new Set(adminNavLinks.map((link) => link.icon));

    expect([...publicKeys].filter((key) => adminKeys.has(key)).length).toBeGreaterThan(0);
  });

  it("keeps every icon path non-empty so no navigation row renders a blank glyph", () => {
    for (const [key, path] of Object.entries(navIconPaths)) {
      expect(path.trim(), `icon "${key}"`).not.toBe("");
    }
  });
});
