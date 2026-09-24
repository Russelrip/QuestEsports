import { describe, expect, it } from "vitest";
import { clearDraftAfterSuccess } from "../src/drafts";
import { sanitizeDetailRecord } from "../src/detail-record";
import { isSessionInvalidResponse, positiveNumber, requiredTrimmed } from "../src/input-validation";

describe("mobile admin safety helpers", () => {
  it("allowlists detail fields and removes capability-like values recursively", () => {
    expect(sanitizeDetailRecord({ id: "order-1", status: "paid", publicToken: "capability", nested: { name: "visible", token: "secret" } })).toEqual({ id: "order-1", status: "paid" });
  });

  it("preserves drafts on failed requests and clears only the submitted draft after success", () => {
    expect(clearDraftAfterSuccess("announcement", "announcement", false)).toBe("announcement");
    expect(clearDraftAfterSuccess("new draft", "sent draft", true)).toBe("new draft");
    expect(clearDraftAfterSuccess("sent draft", "sent draft", true)).toBe("");
  });

  it("trims required inputs and rejects blank or invalid financial values", () => {
    expect(requiredTrimmed("  provider-ref  ", "Provider refund ID")).toBe("provider-ref");
    expect(() => requiredTrimmed("  ", "Reconciliation note")).toThrow("Reconciliation note is required.");
    expect(positiveNumber(" 12.50 ", "Amount")).toBe("12.50");
    expect(() => positiveNumber("  ", "Amount")).toThrow("Amount is required.");
    expect(() => positiveNumber("0", "Amount")).toThrow("Amount must be greater than zero.");
  });

  it("clears only invalid sessions, not ordinary business forbidden responses", () => {
    expect(isSessionInvalidResponse("/api/admin/orders/1", 403, { message: "Order cannot be cancelled." })).toBe(false);
    expect(isSessionInvalidResponse("/api/mobile/auth/me", 403, { message: "Admin access is required." })).toBe(true);
    expect(isSessionInvalidResponse("/api/admin/orders/1", 403, { code: "session_revoked" })).toBe(true);
    expect(isSessionInvalidResponse("/api/admin/orders/1", 401, {})).toBe(true);
  });

  it("signs out a demoted admin on the admin guard's code, wherever the API puts it", () => {
    // Unversioned routes carry it in `details`, /api/v1 routes in `error` too.
    expect(isSessionInvalidResponse("/api/admin/orders/1", 403, { details: { code: "admin_access_required" } })).toBe(true);
    expect(isSessionInvalidResponse("/api/v1/admin/veto-rooms", 403, { error: { code: "admin_access_required" } })).toBe(true);
    // A super-admin-only route or a staff-area refusal must not end a session.
    expect(isSessionInvalidResponse("/api/admin/staff-roles", 403, { message: "Super admin access is required." })).toBe(false);
    expect(isSessionInvalidResponse("/api/v1/admin/veto-rooms", 403, { error: { code: "forbidden" } })).toBe(false);
  });
});
