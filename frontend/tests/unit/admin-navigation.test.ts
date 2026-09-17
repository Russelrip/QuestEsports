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
          { href: "/admin/media", label: "Media", icon: "image", permission: "media" },
          { href: "/admin/event-albums", label: "Albums", icon: "image", permission: "media" },
          { href: "/admin/audit-log", label: "Audit Log", icon: "shield" },
        ],
      },
      {
        label: "Competition",
        links: [
          { href: "/admin/tournaments", label: "Tournaments", icon: "trophy", permission: "tournaments" },
          { href: "/admin/events", label: "Events", icon: "calendar", permission: "tournaments" },
          { href: "/admin/event-series", label: "Event Series", icon: "layers", permission: "tournaments" },
          { href: "/admin/registrations", label: "Registrations", icon: "clipboard", permission: "registrations" },
          { href: "/admin/rulebooks", label: "Rulebooks", icon: "book", permission: "rulebooks" },
        ],
      },
      {
        label: "People",
        links: [
          { href: "/admin/users", label: "Users", icon: "users" },
          { href: "/admin/roles", label: "Roles", icon: "shield" },
          { href: "/admin/teams", label: "Teams", icon: "users", permission: "teams" },
          { href: "/admin/recruitment", label: "Recruitment", icon: "user-plus", permission: "recruitment" },
          { href: "/admin/contact-messages", label: "Messages", icon: "message", permission: "contact_messages" },
          { href: "/admin/support", label: "Support Queue", icon: "message" },
        ],
      },
      {
        label: "Commerce",
        links: [
          { href: "/admin/tickets", label: "Ticketing", icon: "ticket", permission: "tickets" },
          { href: "/admin/expenses", label: "Expenses", icon: "receipt", permission: "expenses" },
          { href: "/admin/products", label: "Products", icon: "package", permission: "shop" },
          { href: "/admin/orders", label: "Orders", icon: "shopping-bag", permission: "shop" },
          { href: "/admin/payments", label: "Payments", icon: "credit-card", permission: "payments" },
        ],
      },
      {
        label: "Game Operations",
        links: [
          { href: "/admin/games", label: "Games", icon: "gamepad", permission: "games" },
          { href: "/admin/match-rooms", label: "Match Rooms", icon: "monitor" },
          { href: "/admin/veto-rooms", label: "Veto Rooms", icon: "swords" },
          { href: "/admin/valorant", label: "Valorant", icon: "crosshair", permission: "valorant_leaderboard" },
          { href: "/admin/game-accounts", label: "Account Changes", icon: "user-plus", permission: "game_accounts" },
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
