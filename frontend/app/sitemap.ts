import type { MetadataRoute } from "next";
import { fetchRulebooks } from "@/lib/rulebooks";
import { absoluteUrl } from "@/lib/site";
import {
  deduplicateSitemapEntries,
  parseSitemapDate,
  sitemapStaticPaths,
} from "@/lib/sitemap";
import { fetchProducts } from "@/lib/shop";
import { fetchTicketedEvents } from "@/lib/tickets";
import { fetchPublicEventAlbums } from "@/lib/event-albums";
import {
  fetchPublicEvents,
  fetchPublicEventSeries,
  fetchPublicTournaments,
} from "@/lib/tournaments";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = sitemapStaticPaths.map(
    (path) => ({
      url: absoluteUrl(path),
    }),
  );

  // Keep each content source independent so one unavailable API endpoint does not
  // remove every other dynamic URL from the generated sitemap.
  const [
    tournaments,
    series,
    events,
    rulebooks,
    products,
    ticketedEvents,
    eventAlbums,
  ] = await Promise.all([
    fetchPublicTournaments().catch(() => []),
    fetchPublicEventSeries().catch(() => []),
    fetchPublicEvents().catch(() => []),
    fetchRulebooks().catch(() => []),
    fetchProducts().catch(() => []),
    fetchTicketedEvents().catch(() => []),
    fetchPublicEventAlbums(new URLSearchParams({ page: "1", pageSize: "50" }))
      .then((result) => result.albums)
      .catch(() => []),
  ]);

  const tournamentEntries: MetadataRoute.Sitemap = tournaments.map(
    (tournament) => ({
      url: absoluteUrl(`/tournaments/${tournament.slug}`),
      lastModified: parseSitemapDate(tournament.updatedAt),
    }),
  );

  const seriesEntries: MetadataRoute.Sitemap = series
    .filter((eventSeries) => eventSeries.isPublished)
    .map((eventSeries) => ({
      url: absoluteUrl(`/tournaments/series/${eventSeries.slug}`),
    }));

  const eventEntries: MetadataRoute.Sitemap = events
    .filter((event) => event.isPublished)
    .map((event) => ({
      url: absoluteUrl(`/tournaments/events/${event.slug}`),
    }));

  const rulebookEntries: MetadataRoute.Sitemap = rulebooks.map((rulebook) => ({
    url: absoluteUrl(`/rulebooks/${rulebook.slug}`),
    lastModified: parseSitemapDate(rulebook.updatedAt),
  }));

  const productEntries: MetadataRoute.Sitemap = products
    .filter((product) => product.status === "active")
    .map((product) => ({
      url: absoluteUrl(`/shop/${product.slug}`),
    }));

  const ticketEntries: MetadataRoute.Sitemap = ticketedEvents.map((event) => ({
    url: absoluteUrl(`/tickets/${event.slug}`),
  }));

  const albumEntries: MetadataRoute.Sitemap = eventAlbums.map((album) => ({
    url: absoluteUrl(`/gallery/${album.slug}`),
    lastModified: parseSitemapDate(album.updatedAt),
  }));

  return deduplicateSitemapEntries([
    ...staticEntries,
    ...tournamentEntries,
    ...seriesEntries,
    ...eventEntries,
    ...rulebookEntries,
    ...productEntries,
    ...ticketEntries,
    ...albumEntries,
  ]);
}
