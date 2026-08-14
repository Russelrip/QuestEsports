import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapStaticPaths } from "../../lib/sitemap";
import { defaultPageDescriptions, primaryNavItems } from "../../lib/site";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("VALORANT player leaderboard", () => {
  it("is a public page with a nav entry, description, and sitemap path", () => {
    expect(primaryNavItems.some((item) => item.href === "/valorant-leaderboard")).toBe(true);
    expect(typeof defaultPageDescriptions.valorantLeaderboard).toBe("string");
    expect(sitemapStaticPaths).toContain("/valorant-leaderboard");
  });

  it("renders a public leaderboard without admin or upstream references", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain("Register your account");
    expect(component).toContain("Search by Discord username");
    expect(component).toContain("Top 10");
    expect(component).toContain("Leaderboard unavailable");
    expect(component).not.toMatch(/api\.henrikdev|valorant-platform-backend|X-Admin-Key|VALORANT_SERVICE_SECRET|localhost:8000/);
  });

  it("the page guards its fetches so an outage renders the unavailable state", () => {
    const page = read("app/valorant-leaderboard/page.tsx");
    expect(page).toMatch(/try\s*\{/);
    expect(page).toContain("fetchPublicValorantLeaderboard");
    expect(page).toContain("searchPublicValorantLeaderboard");
  });

  it("the page fetches the public proxy, not the admin endpoint", () => {
    const page = read("app/valorant-leaderboard/page.tsx");
    expect(page).toContain("fetchPublicValorantLeaderboard");
    expect(page).not.toContain("admin/valorant");
  });
});
