import { describe, expect, it } from "vitest";
import {
  deduplicateSitemapEntries,
  parseSitemapDate,
  sitemapStaticPaths,
} from "../../lib/sitemap";

describe("sitemap helpers", () => {
  it("includes canonical public pages and excludes account-only routes", () => {
    expect(sitemapStaticPaths).toContain("/privacy-policy");
    expect(sitemapStaticPaths).toContain("/terms-of-service");
    expect(sitemapStaticPaths).not.toContain("/tickets");
    expect(sitemapStaticPaths).not.toContain("/registration");
    expect(sitemapStaticPaths).not.toContain("/login");
  });

  it("only emits valid last-modified dates", () => {
    expect(parseSitemapDate("2026-07-23T12:00:00.000Z")?.toISOString()).toBe(
      "2026-07-23T12:00:00.000Z",
    );
    expect(parseSitemapDate("not-a-date")).toBeUndefined();
    expect(parseSitemapDate()).toBeUndefined();
  });

  it("deduplicates canonical URLs", () => {
    expect(
      deduplicateSitemapEntries([
        { url: "https://questesports.lk/" },
        { url: "https://questesports.lk/" },
        { url: "https://questesports.lk/tournaments" },
      ]),
    ).toEqual([
      { url: "https://questesports.lk/" },
      { url: "https://questesports.lk/tournaments" },
    ]);
  });
});
