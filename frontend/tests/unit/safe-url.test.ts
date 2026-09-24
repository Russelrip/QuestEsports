import { describe, expect, it } from "vitest";
import { isAllowedPayHereActionUrl, normalizeSameOriginPath } from "../../lib/safe-url";

describe("normalizeSameOriginPath", () => {
  it("preserves valid paths, queries, and hashes", () => {
    expect(normalizeSameOriginPath("/match-room/abc?tab=veto#chat", "/profile")).toBe(
      "/match-room/abc?tab=veto#chat"
    );
  });

  it.each([
    "https://questesports.lk/profile",
    "//attacker.example/steal",
    "javascript:alert(1)",
    "data:text/html,alert(1)",
    "blob:https://questesports.lk/id",
    "https://user:password@questesports.lk/profile",
    "https://[invalid/profile",
  ])("rejects unsafe destination %s", (value) => {
    expect(normalizeSameOriginPath(value, "/profile")).toBe("/profile");
  });

  it("uses the supplied fallback for null, undefined, and malformed values", () => {
    expect(normalizeSameOriginPath(null, "/profile")).toBe("/profile");
    expect(normalizeSameOriginPath(undefined, "/profile")).toBe("/profile");
    expect(normalizeSameOriginPath("not a path", "/profile")).toBe("/profile");
  });
});

describe("isAllowedPayHereActionUrl", () => {
  it.each([
    "https://sandbox.payhere.lk/pay/checkout",
    "https://www.payhere.lk/pay/checkout?order=123",
  ])("accepts approved PayHere destinations: %s", (value) => {
    expect(isAllowedPayHereActionUrl(value)).toBe(true);
  });

  it.each([
    "http://sandbox.payhere.lk/pay/checkout",
    "https://payhere.lk/pay/checkout",
    "https://sandbox.payhere.lk.evil.test/pay/checkout",
    "https://user:password@www.payhere.lk/pay/checkout",
    "https://www.payhere.lk:444/pay/checkout",
    "https://attacker.example/pay/checkout",
    "not a URL",
  ])("rejects unapproved PayHere destination: %s", (value) => {
    expect(isAllowedPayHereActionUrl(value)).toBe(false);
  });
});
