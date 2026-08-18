import { describe, expect, it } from "vitest";
import { adminNavigationGroups } from "../../lib/admin";

describe("admin navigation", () => {
  it("uses the approved groups and keeps every admin destination reachable", () => {
    expect(adminNavigationGroups.map((group) => group.label)).toEqual([
      "Workspace",
      "Competition",
      "People",
      "Commerce",
      "Game Operations",
    ]);

    expect(adminNavigationGroups.find((group) => group.label === "Competition")?.links).toEqual([
      { href: "/admin/tournaments", label: "Tournaments" },
      { href: "/admin/events", label: "Events" },
      { href: "/admin/event-series", label: "Event Series" },
      { href: "/admin/registrations", label: "Registrations" },
      { href: "/admin/rulebooks", label: "Rulebooks" },
    ]);
    expect(adminNavigationGroups.find((group) => group.label === "Game Operations")?.links).toEqual([
      { href: "/admin/games", label: "Games" },
      { href: "/admin/match-rooms", label: "Match Rooms" },
      { href: "/admin/veto-rooms", label: "Veto Rooms" },
      { href: "/admin/valorant", label: "Valorant" },
    ]);

    const links = adminNavigationGroups.flatMap((group) => group.links);
    expect(links.map((link) => link.href)).toEqual([
      "/admin",
      "/admin/media",
      "/admin/event-albums",
      "/admin/tournaments",
      "/admin/events",
      "/admin/event-series",
      "/admin/registrations",
      "/admin/rulebooks",
      "/admin/users",
      "/admin/teams",
      "/admin/recruitment",
      "/admin/contact-messages",
      "/admin/tickets",
      "/admin/expenses",
      "/admin/products",
      "/admin/orders",
      "/admin/payments",
      "/admin/games",
      "/admin/match-rooms",
      "/admin/veto-rooms",
      "/admin/valorant",
    ]);
    expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
  });
});
