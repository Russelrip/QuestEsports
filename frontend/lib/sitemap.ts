import type { MetadataRoute } from "next";

export const sitemapStaticPaths = [
  "/",
  "/tournaments",
  "/valorant-leaderboard",
  "/match-videos",
  "/gallery",
  "/shop",
  "/members",
  "/join",
  "/contact",
  "/refund-policy",
  "/privacy-policy",
  "/terms-of-service",
] as const;

export const parseSitemapDate = (value?: string | Date | null) => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const deduplicateSitemapEntries = (
  entries: MetadataRoute.Sitemap,
): MetadataRoute.Sitemap =>
  Array.from(new Map(entries.map((entry) => [entry.url, entry])).values());
