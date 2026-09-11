import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscordConnectionGate from "../../components/auth/DiscordConnectionGate";

const mocks = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, isLoading: false },
  pathname: "/tournaments",
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/account-linking", () => ({
  getProviderLinkUrl: () => "https://api.example.com/auth/discord/link",
}));

const player = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: "user",
  discordId: null,
  ...overrides,
});

const renderAt = (pathname: string) => {
  mocks.pathname = pathname;
  render(
    <DiscordConnectionGate>
      <p>protected page</p>
    </DiscordConnectionGate>,
  );
};

const heldBack = () => screen.queryByText("protected page") === null;

beforeEach(() => {
  mocks.auth = { user: null, isLoading: false };
  mocks.pathname = "/tournaments";
});

afterEach(() => cleanup());

describe("DiscordConnectionGate", () => {
  it("holds a signed-in session with no linked Discord", () => {
    mocks.auth = { user: player(), isLoading: false };
    renderAt("/tournaments");

    expect(heldBack()).toBe(true);
    expect(screen.getByRole("heading", { name: "Connect your Discord account" })).toBeInTheDocument();
    // The connect action lives in the gate itself, so a held session never has
    // to reach a page it is being kept out of.
    expect(screen.getByRole("button", { name: "Connect Discord" })).toBeInTheDocument();
  });

  it.each(["/support", "/support/new", "/support/thread-1", "/contact"])("keeps %s reachable when Discord linking is incomplete", (path) => {
    mocks.auth = { user: player(), isLoading: false };
    renderAt(path);
    expect(heldBack()).toBe(false);
  });

  it("lets a linked session through", () => {
    mocks.auth = { user: player({ discordId: "900000000000000001" }), isLoading: false };
    renderAt("/tournaments");

    expect(heldBack()).toBe(false);
  });

  it("lets signed-out visitors browse", () => {
    // The site is public. Holding anonymous traffic would show a connect screen
    // to someone with no account to connect it to.
    renderAt("/tournaments");

    expect(heldBack()).toBe(false);
  });

  it("does not flash the gate while the session is still loading", () => {
    mocks.auth = { user: null, isLoading: true };
    renderAt("/tournaments");

    expect(heldBack()).toBe(false);
  });

  it("exempts admins", () => {
    // Staff reach each other through the server's own role structure, and an
    // operator locked out of the dashboard cannot investigate the lockout.
    mocks.auth = { user: player({ role: "admin" }), isLoading: false };
    renderAt("/admin/events");

    expect(heldBack()).toBe(false);
  });

  it("exempts the routes needed to sign in, recover, and manage connections", () => {
    for (const pathname of [
      "/login",
      "/signup",
      "/join/abc",
      "/forgot-password",
      "/reset-password",
      "/confirm-email-change",
      "/profile",
      "/admin",
      "/maintenance",
    ]) {
      cleanup();
      mocks.auth = { user: player(), isLoading: false };
      renderAt(pathname);
      expect(heldBack(), `${pathname} must stay reachable`).toBe(false);
    }
  });

  it("does not exempt a path that merely starts with an exempt word", () => {
    // "/profiles" is not "/profile". Prefix matching without the boundary would
    // quietly open whole sections of the site.
    mocks.auth = { user: player(), isLoading: false };
    renderAt("/profiles-of-players");

    expect(heldBack()).toBe(true);
  });
});
