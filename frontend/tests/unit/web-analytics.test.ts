// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { readWebAnalyticsToken } from "../../lib/web-analytics";

// A placeholder in the token's shape, built at runtime so secret scanners do
// not mistake a literal for a real key.
const TOKEN = "ab".repeat(16);

afterEach(() => vi.unstubAllEnvs());

it("analytics stays off without a token", () => {
  expect(readWebAnalyticsToken({})).toBeNull();
  expect(readWebAnalyticsToken({ CLOUDFLARE_WEB_ANALYTICS_TOKEN: "  " })).toBeNull();
});

it("accepts the 32-character hex token from the Cloudflare snippet", () => {
  expect(readWebAnalyticsToken({ CLOUDFLARE_WEB_ANALYTICS_TOKEN: ` ${TOKEN} ` })).toBe(TOKEN);
});

it("disables analytics instead of throwing on a malformed token", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(
    readWebAnalyticsToken({ CLOUDFLARE_WEB_ANALYTICS_TOKEN: '"><script>' })
  ).toBeNull();
  warn.mockRestore();
});

it("CSP allows the beacon's report origin only when analytics is on", () => {
  const off = proxy(new NextRequest("https://questesports.lk/"));
  expect(off.headers.get("content-security-policy")).not.toContain("cloudflareinsights.com");

  vi.stubEnv("CLOUDFLARE_WEB_ANALYTICS_TOKEN", TOKEN);
  const on = proxy(new NextRequest("https://questesports.lk/"));
  const csp = on.headers.get("content-security-policy") ?? "";
  expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  // The script itself is admitted by nonce under 'strict-dynamic', not by host.
  expect(csp).not.toMatch(/script-src [^;]*cloudflareinsights/);
});
