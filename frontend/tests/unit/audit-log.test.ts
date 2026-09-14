import { describe, expect, it } from "vitest";
import {
  auditLogFiltersFromSearchParams,
  buildAuditLogQuery,
  describeAuditActor,
  diffAuditData,
  emptyAuditLogFilters,
  hasActiveAuditLogFilters,
} from "../../lib/audit-log";

describe("audit log query", () => {
  it("sends only the filters that are set, trimmed", () => {
    const query = new URLSearchParams(
      buildAuditLogQuery({ ...emptyAuditLogFilters, action: " match.updated ", actor: "", source: "admin" }, 2),
    );
    expect(Object.fromEntries(query)).toEqual({ action: "match.updated", source: "admin", page: "2", pageSize: "25" });
  });

  it("turns a day range into whole Sri Lanka days with an exclusive end", () => {
    const query = new URLSearchParams(
      buildAuditLogQuery({ ...emptyAuditLogFilters, fromDate: "2026-09-01", toDate: "2026-09-30" }, 1),
    );
    // Midnight in Colombo is 18:30 UTC the evening before.
    expect(query.get("from")).toBe("2026-08-31T18:30:00.000Z");
    expect(query.get("to")).toBe("2026-09-30T18:30:00.000Z");
  });

  it("rolls the end of a range over month and year boundaries", () => {
    const query = new URLSearchParams(buildAuditLogQuery({ ...emptyAuditLogFilters, toDate: "2026-12-31" }, 1));
    expect(query.get("to")).toBe("2026-12-31T18:30:00.000Z");
  });

  it("opens with the filters a link carries and ignores anything else", () => {
    const filters = auditLogFiltersFromSearchParams(
      new URLSearchParams("targetType=User&targetId=%20u-1%20&foo=bar&action="),
    );
    expect(filters).toEqual({ ...emptyAuditLogFilters, targetType: "User", targetId: "u-1" });
    expect(hasActiveAuditLogFilters(filters)).toBe(true);
    expect(hasActiveAuditLogFilters(emptyAuditLogFilters)).toBe(false);
  });
});

describe("audit log presentation", () => {
  it("names the actor, and says honestly when there is none", () => {
    const actor = { id: "a", username: "russ", name: "Russel Perera", email: "r@example.com" };
    expect(describeAuditActor({ actor, source: "admin" })).toBe("Russel Perera (@russ)");
    expect(describeAuditActor({ actor: { ...actor, name: null }, source: "admin" })).toBe("@russ");
    expect(describeAuditActor({ actor: null, source: "bot" })).toBe("Automation");
    expect(describeAuditActor({ actor: null, source: null })).toBe("System or deleted account");
  });

  it("lists changed fields first and keeps unchanged ones for context", () => {
    const changes = diffAuditData(
      { status: "pending", teamName: "Quest", permissions: [] },
      { status: "approved", teamName: "Quest", permissions: ["valorant_leaderboard"], note: "ok" },
    );
    expect(changes.map((change) => [change.field, change.changed])).toEqual([
      ["status", true],
      ["permissions", true],
      ["note", true],
      ["teamName", false],
    ]);
    expect(changes.find((change) => change.field === "note")?.before).toBeUndefined();
  });

  it("handles creations, deletions and non-object snapshots", () => {
    expect(diffAuditData(null, null)).toEqual([]);
    expect(diffAuditData(null, { title: "Cup" })).toEqual([{ field: "title", before: undefined, after: "Cup", changed: true }]);
    expect(diffAuditData({ title: "Cup" }, null)).toEqual([{ field: "title", before: "Cup", after: undefined, changed: true }]);
    expect(diffAuditData(["a"], ["a", "b"])).toEqual([{ field: "value", before: ["a"], after: ["a", "b"], changed: true }]);
  });
});
