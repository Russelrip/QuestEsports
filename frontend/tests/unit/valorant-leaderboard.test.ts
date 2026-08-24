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
    expect(component).toContain("isTopTen");
    expect(component).toContain("Leaderboard unavailable");
    expect(component).toContain("buildValorantTrackerProfileUrl");
    expect(component).toContain('target="_blank"');
    expect(component).toContain('rel="noopener noreferrer"');
    expect(component).toContain("View");
    expect(component).toContain("Tracker");
    expect(component).not.toMatch(/api\.henrikdev|valorant-platform-backend|X-Admin-Key|VALORANT_SERVICE_SECRET|localhost:8000/);
  });

  it("searches as you type against a debounced, shareable ?q= URL", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain("SEARCH_DEBOUNCE_MS");
    expect(component).toContain("useTransition");
    // Typing must not stack a history entry per keystroke.
    expect(component).toContain("router.replace");
    expect(component).toContain("MIN_QUERY_LENGTH");
  });

  it("renders every ranked match, not just one exact hit", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain("searchResults");
    expect(component).toContain("searchResults.map");
    expect(component).toContain("rank={entry.rank}");
    expect(component).toContain("Back to leaderboard");
  });

  it("offers a clear control and highlights the matched text", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain('aria-label="Clear search"');
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain("<mark");
  });

  it("keeps the register CTA reachable from the search results", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain("RegisterCta");
    expect(component.match(/<RegisterCta \/>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a query that matches nobody as a no-result, not an outage", () => {
    const page = read("app/valorant-leaderboard/page.tsx");
    // The search helper returns [] for no match and only throws when upstream
    // is down, so the empty list must NOT route to renderUnavailable().
    expect(page).toContain("searchResults={results}");
    expect(page).toContain("if (failed) return renderUnavailable();");
    expect(page).not.toContain("results.length === 0) return renderUnavailable");
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
