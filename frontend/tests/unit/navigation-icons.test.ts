import { describe, expect, it } from "vitest";
import { adminNavigationGroups } from "../../lib/admin";
import { navIconPaths } from "../../lib/icons";
import { primaryNavItems, secondaryNavItems, siteNavLabel } from "../../lib/site";

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

describe("navigation labels", () => {
  it("keeps every header label short enough to stay on one line", () => {
    for (const item of publicNavItems) {
      expect(item.label.length, `${item.href} label "${item.label}"`).toBeLessThanOrEqual(12);
    }
  });

  it("spells the shortened destinations out for roomier surfaces", () => {
    const leaderboard = publicNavItems.find((item) => item.href === "/valorant-leaderboard");
    const videos = publicNavItems.find((item) => item.href === "/match-videos");

    expect(leaderboard?.label).toBe("Leaderboard");
    expect(siteNavLabel(leaderboard!)).toBe("Valorant Leaderboard");
    expect(videos?.label).toBe("Videos");
    expect(siteNavLabel(videos!)).toBe("Match Videos");
  });

  it("falls back to the compact label when no descriptive one is set", () => {
    const home = publicNavItems.find((item) => item.href === "/");

    expect(home?.fullLabel).toBeUndefined();
    expect(siteNavLabel(home!)).toBe("Home");
  });
});
