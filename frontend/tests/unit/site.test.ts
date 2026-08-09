import { describe, expect, it } from "vitest";
import type { Product } from "../../lib/shop";
import type { TicketedEvent } from "../../lib/tickets";
import {
  absoluteUrl,
  buildBreadcrumbStructuredData,
  buildPageMetadata,
  buildProductStructuredData,
  buildTicketEventStructuredData,
} from "../../lib/site";

const ticketEvent: TicketedEvent = {
  id: "event-1",
  slug: "quest-community-night",
  title: "Quest Community Night",
  description: "An in-person community event.",
  venue: "Colombo",
  startsAt: "2026-09-01T13:30:00.000Z",
  salesStartAt: "2026-08-01T00:00:00.000Z",
  salesEndAt: "2026-08-31T23:59:59.000Z",
  status: "on_sale",
  capacity: 100,
  availableTickets: 40,
  maxTicketsPerOrder: 4,
  currency: "LKR",
  singlePrice: 1500,
  pairPrice: 2500,
  salesActive: true,
};

const product: Product = {
  id: "product-1",
  slug: "quest-jersey",
  name: "Quest Jersey",
  description: "Official Quest E-sports jersey.",
  currency: "LKR",
  status: "active",
  madeToOrder: false,
  displayOrder: 1,
  variants: [
    {
      id: "variant-1",
      sku: "QUEST-JERSEY-M",
      name: "Medium",
      size: "M",
      color: "Black",
      price: 4500,
      stock: 5,
      isActive: true,
    },
  ],
  images: [
    {
      id: "image-1",
      altText: "Quest jersey",
      displayOrder: 1,
      imageUrl: "https://cdn.example.com/quest-jersey.webp",
    },
  ],
};

describe("site metadata helpers", () => {
  it("builds a route-specific canonical and social URL", () => {
    const metadata = buildPageMetadata({
      title: ticketEvent.title,
      description: ticketEvent.description,
      path: `/tickets/${ticketEvent.slug}`,
    });

    expect(metadata.alternates?.canonical).toBe(
      `/tickets/${ticketEvent.slug}`,
    );
    expect(metadata.openGraph?.url).toBe(`/tickets/${ticketEvent.slug}`);
  });

  it("preserves valid absolute asset URLs", () => {
    expect(absoluteUrl("https://cdn.example.com/image.webp")).toBe(
      "https://cdn.example.com/image.webp",
    );
  });
});

describe("site structured data helpers", () => {
  it("builds event offers and the canonical event URL", () => {
    const data = buildTicketEventStructuredData(ticketEvent);

    expect(data["@type"]).toBe("Event");
    expect(data.url).toMatch(/\/tickets\/quest-community-night$/);
    expect(data.offers).toHaveLength(2);
    expect(data.offers[0].availability).toBe(
      "https://schema.org/InStock",
    );
  });

  it("builds product offers without rewriting absolute image URLs", () => {
    const data = buildProductStructuredData(product);

    expect(data.image).toEqual(["https://cdn.example.com/quest-jersey.webp"]);
    expect(data.offers[0]).toMatchObject({
      sku: "QUEST-JERSEY-M",
      price: 4500,
      availability: "https://schema.org/InStock",
    });
  });

  it("numbers breadcrumb entries in order", () => {
    const data = buildBreadcrumbStructuredData([
      { name: "Home", path: "/" },
      { name: "Tickets", path: "/tickets" },
    ]);

    expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2]);
  });
});
