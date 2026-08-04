import { describe, expect, it } from "vitest";
import { normalizeSafeRedirectPath } from "../../lib/safe-redirect";

describe("normalizeSafeRedirectPath", () => {
  it("keeps same-origin paths, queries, and fragments", () => {
    expect(normalizeSafeRedirectPath("/admin/payments?status=pending#latest")).toBe(
      "/admin/payments?status=pending#latest"
    );
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/%5cevil.example/phish",
    "/%2fevil.example/phish",
    "/admin\n/redirect",
    "javascript:alert(1)",
  ])("rejects unsafe redirect %s", (redirect) => {
    expect(normalizeSafeRedirectPath(redirect)).toBeNull();
  });
});
