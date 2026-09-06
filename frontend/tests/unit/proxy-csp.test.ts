// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
afterEach(() => vi.unstubAllEnvs());
it("review: browser CSP uses the public API even with internal Docker origin", () => {
  vi.stubEnv("INTERNAL_API_URL", "http://backend:5001");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.questesports.lk");
  const response = proxy(new NextRequest("https://questesports.lk/"));
  const csp = response.headers.get("content-security-policy");
  expect(csp).toContain("https://api.questesports.lk");
  expect(csp).not.toContain("http://backend:5001");
});
