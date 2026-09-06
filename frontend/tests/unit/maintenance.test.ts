import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  parseMaintenanceBoolean,
  parseMaintenanceMessage,
  parseMaintenanceRetryAfter,
  readSiteMaintenanceConfig,
} from "../../lib/maintenance";
import { proxy } from "../../proxy";

afterEach(() => vi.unstubAllEnvs());

describe("maintenance configuration", () => {
  it("uses safe defaults", () => {
    expect(readSiteMaintenanceConfig({})).toEqual({
      enabled: false,
      message: DEFAULT_MAINTENANCE_MESSAGE,
      retryAfterSeconds: 900,
    });
  });

  it("normalizes valid values and rejects ambiguous configuration", () => {
    expect(parseMaintenanceBoolean("YES")).toBe(true);
    expect(parseMaintenanceBoolean("off")).toBe(false);
    expect(parseMaintenanceMessage("  Back   shortly  ")).toBe("Back shortly");
    expect(parseMaintenanceRetryAfter("60")).toBe(60);
    expect(() => parseMaintenanceBoolean("maybe")).toThrow(/Expected true or false/);
    expect(() => parseMaintenanceMessage("x".repeat(241))).toThrow(/240 characters/);
    expect(() => parseMaintenanceRetryAfter("0")).toThrow(/1 to 86400/);
  });
});

describe("maintenance proxy", () => {
  it("redirects the production Vercel alias to the canonical domain", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://questesports.lk");
    const response = proxy(
      new NextRequest("https://quest-esports.vercel.app/tournaments?game=valorant"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://questesports.lk/tournaments?game=valorant",
    );
  });

  it("does not redirect Vercel preview deployments", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://questesports.lk");
    const response = proxy(
      new NextRequest("https://quest-esports-git-feature.vercel.app/tournaments"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not loop when the configured canonical host is a Vercel alias", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://quest-esports.vercel.app");
    const response = proxy(
      new NextRequest("https://quest-esports.vercel.app/tournaments"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rewrites public pages to a 503 maintenance response", () => {
    vi.stubEnv("SITE_MAINTENANCE_MODE", "true");
    vi.stubEnv("SITE_MAINTENANCE_RETRY_AFTER_SECONDS", "600");
    const response = proxy(new NextRequest("https://questesports.lk/tournaments"));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://questesports.lk/maintenance"
    );
    expect(response.headers.get("retry-after")).toBe("600");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-maintenance-mode")).toBe("active");
  });

  it("does not loop when rendering the maintenance page", () => {
    vi.stubEnv("SITE_MAINTENANCE_MODE", "true");
    const response = proxy(new NextRequest("https://questesports.lk/maintenance"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("continues normally when maintenance mode is disabled", () => {
    vi.stubEnv("SITE_MAINTENANCE_MODE", "false");
    const response = proxy(new NextRequest("https://questesports.lk/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-maintenance-mode")).toBeNull();
  });

  it("fails safely when the runtime API URL is malformed", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "not a URL");

    expect(() => proxy(new NextRequest("https://questesports.lk/"))).not.toThrow();
    const response = proxy(new NextRequest("https://questesports.lk/"));

    expect(response.headers.get("content-security-policy")).not.toContain("not a URL");
  });
});
