import { describe, expect, it } from "vitest";
import { safeTicketOrderPath } from "@/lib/tickets";

describe("safeTicketOrderPath", () => {
  it("accepts the order page the server hands back, token intact", () => {
    const token = "a".repeat(48);
    expect(safeTicketOrderPath(`/tickets/order#token=${token}`)).toBe(`/tickets/order#token=${token}`);
  });

  it.each([
    ["an absolute URL on another origin", "https://evil.example/tickets/order#token=x"],
    ["a protocol-relative URL", "//evil.example/tickets/order"],
    ["a script URL", "javascript:alert(1)"],
    ["another page on this site", "/profile"],
    ["a path that only starts like the order page", "/tickets/orders#token=x"],
    ["a traversal that resolves elsewhere", "/tickets/order/../../admin"],
    ["a backslash trick", "/\\evil.example"],
    ["nothing", ""],
    ["a missing value", undefined],
  ])("rejects %s", (_label, value) => {
    expect(safeTicketOrderPath(value)).toBeNull();
  });
});
