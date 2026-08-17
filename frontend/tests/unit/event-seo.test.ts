import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchPublicEvents,
  fetchPublicEventSeries,
  fetchPublicEventSeriesBySlug,
} = vi.hoisted(() => ({
  fetchPublicEvents: vi.fn(),
  fetchPublicEventSeries: vi.fn(),
  fetchPublicEventSeriesBySlug: vi.fn(),
}));

vi.mock("@/lib/tournaments", () => ({
  fetchPublicEvents,
  fetchPublicEventSeries,
  fetchPublicEventSeriesBySlug,
  fetchPublicTournaments: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/rulebooks", () => ({
  fetchRulebooks: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/shop", () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/tickets", () => ({
  fetchTicketedEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/event-albums", () => ({
  fetchPublicEventAlbums: vi.fn().mockResolvedValue({ albums: [] }),
}));

import sitemap from "@/app/sitemap";
import { generateMetadata } from "@/app/tournaments/series/[slug]/page";
import { absoluteUrl } from "@/lib/site";

const publishedEvent = {
  slug: "quest-ascension",
  title: "Quest Ascension",
  description: "The next Quest E-sports event.",
  heroUrl: null,
  isPublished: true,
};

describe("event sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPublicEvents.mockResolvedValue([
      publishedEvent,
      { ...publishedEvent, slug: "draft-event", isPublished: false },
    ]);
    fetchPublicEventSeries.mockResolvedValue([]);
  });

  it("emits canonical URLs for published events only", async () => {
    const entries = await sitemap();

    expect(entries).toContainEqual({
      url: absoluteUrl("/events/quest-ascension"),
    });
    expect(entries).not.toContainEqual({
      url: absoluteUrl("/events/draft-event"),
    });
  });
});

describe("event metadata", () => {
  it("points the legacy series route at the canonical event URL", async () => {
    fetchPublicEventSeriesBySlug.mockResolvedValue(publishedEvent);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: publishedEvent.slug }),
    });

    expect(metadata.alternates?.canonical).toBe("/events/quest-ascension");
    expect(metadata.openGraph?.url).toBe("/events/quest-ascension");
  });
});
