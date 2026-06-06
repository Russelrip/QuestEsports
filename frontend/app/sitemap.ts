import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { fetchPublicTournaments } from "@/lib/tournaments";
import { fetchRulebooks } from "@/lib/rulebooks";

const staticRoutes = [
  "",
  "/tournaments",
  "/match-videos",
  "/gallery",
  "/shop",
  "/members",
  "/join",
  "/contact",
  "/registration",
  "/tournament-registration",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((path) => ({
    url: absoluteUrl(path || "/"),
    lastModified: now,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.8,
  }));

  try {
    const [tournaments, rulebooks] = await Promise.all([
      fetchPublicTournaments(),
      fetchRulebooks(),
    ]);
    const tournamentEntries: MetadataRoute.Sitemap = tournaments.map((tournament) => ({
      url: absoluteUrl(`/tournaments/${tournament.slug}`),
      lastModified: tournament.updatedAt ? new Date(tournament.updatedAt) : now,
      changeFrequency:
        tournament.status === "completed" || tournament.status === "cancelled"
          ? "monthly"
          : "weekly",
      priority: tournament.isFeatured ? 0.9 : 0.7,
    }));

    const rulebookEntries: MetadataRoute.Sitemap = rulebooks.map((rulebook) => ({
      url: absoluteUrl(`/rulebooks/${rulebook.slug}`),
      lastModified: new Date(rulebook.updatedAt),
      changeFrequency: "monthly",
      priority: 0.6,
    }));

    return [...staticEntries, ...tournamentEntries, ...rulebookEntries];
  } catch {
    return staticEntries;
  }
}
