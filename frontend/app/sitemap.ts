import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { fetchPublicTournaments } from "@/lib/tournaments";

const staticRoutes = [
  "",
  "/tournaments",
  "/match-videos",
  "/posters",
  "/rulebook",
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
    const tournaments = await fetchPublicTournaments();
    const tournamentEntries: MetadataRoute.Sitemap = tournaments.map((tournament) => ({
      url: absoluteUrl(`/tournaments/${tournament.slug}`),
      lastModified: tournament.updatedAt ? new Date(tournament.updatedAt) : now,
      changeFrequency:
        tournament.status === "completed" || tournament.status === "cancelled"
          ? "monthly"
          : "weekly",
      priority: tournament.isFeatured ? 0.9 : 0.7,
    }));

    return [...staticEntries, ...tournamentEntries];
  } catch {
    return staticEntries;
  }
}
