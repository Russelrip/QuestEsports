import { describe, expect, it } from "vitest";
import {
  adminNavigationGroups,
  getAdminPageHeaderContent,
} from "../../lib/admin";

describe("admin navigation", () => {
  it("uses the approved groups and keeps every admin destination reachable", () => {
    expect(adminNavigationGroups.map((group) => group.label)).toEqual([
      "Workspace",
      "Competition",
      "People",
      "Commerce",
      "Game Operations",
    ]);

    expect(adminNavigationGroups).toEqual([
      {
        label: "Workspace",
        links: [
          { href: "/admin", label: "Overview", icon: "dashboard" },
          { href: "/admin/media", label: "Media", icon: "image" },
          { href: "/admin/event-albums", label: "Albums", icon: "image" },
        ],
      },
      {
        label: "Competition",
        links: [
          { href: "/admin/tournaments", label: "Tournaments", icon: "trophy" },
          { href: "/admin/events", label: "Events", icon: "calendar" },
          { href: "/admin/event-series", label: "Event Series", icon: "layers" },
          { href: "/admin/registrations", label: "Registrations", icon: "clipboard" },
          { href: "/admin/rulebooks", label: "Rulebooks", icon: "book" },
        ],
      },
      {
        label: "People",
        links: [
          { href: "/admin/users", label: "Users", icon: "users" },
          { href: "/admin/teams", label: "Teams", icon: "users" },
          { href: "/admin/recruitment", label: "Recruitment", icon: "user-plus" },
          { href: "/admin/contact-messages", label: "Messages", icon: "message" },
          { href: "/admin/support", label: "Support Queue", icon: "message" },
        ],
      },
      {
        label: "Commerce",
        links: [
          { href: "/admin/tickets", label: "Ticketing", icon: "ticket" },
          { href: "/admin/expenses", label: "Expenses", icon: "receipt" },
          { href: "/admin/products", label: "Products", icon: "package" },
          { href: "/admin/orders", label: "Orders", icon: "shopping-bag" },
          { href: "/admin/payments", label: "Payments", icon: "credit-card" },
        ],
      },
      {
        label: "Game Operations",
        links: [
          { href: "/admin/games", label: "Games", icon: "gamepad" },
          { href: "/admin/match-rooms", label: "Match Rooms", icon: "monitor" },
          { href: "/admin/veto-rooms", label: "Veto Rooms", icon: "swords" },
          { href: "/admin/valorant", label: "Valorant", icon: "crosshair" },
        ],
      },
    ]);

    const links = adminNavigationGroups.flatMap((group) => group.links);
    expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
  });

  it("keeps the page header renderable without an active-section eyebrow", () => {
    expect(getAdminPageHeaderContent("Overview", "Manage Quest operations.")).toEqual({
      title: "Overview",
      description: "Manage Quest operations.",
    });
  });
});
