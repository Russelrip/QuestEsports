import { adminRequest, type Pagination } from "@/lib/admin";
import { sriLankaDateTimeLocalToIso } from "@/lib/date-time";

export type AuditSource = "web" | "admin" | "mobile" | "bot" | "system";

export type AuditLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  actor: { id: string; username: string; name: string | null; email: string } | null;
  source: AuditSource | null;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  beforeData: unknown;
  afterData: unknown;
};

export type AuditLogFacets = {
  actions: { value: string; count: number }[];
  targetTypes: { value: string; count: number }[];
  sources: AuditSource[];
};

/** Filter state as the page holds it. Dates are Sri Lanka calendar days (`YYYY-MM-DD`). */
export type AuditLogFilters = {
  actor: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  source: string;
  fromDate: string;
  toDate: string;
};

export const emptyAuditLogFilters: AuditLogFilters = {
  actor: "",
  actorUserId: "",
  action: "",
  targetType: "",
  targetId: "",
  source: "",
  fromDate: "",
  toDate: "",
};

export const AUDIT_LOG_PAGE_SIZE = 25;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const nextCalendarDay = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
};

/**
 * Query string for GET /api/v1/admin/audit-logs. A day range covers whole
 * Sri Lanka days: `from` is that day's midnight and `to` (exclusive) is the
 * midnight after the last day.
 */
export const buildAuditLogQuery = (filters: AuditLogFilters, page: number, pageSize = AUDIT_LOG_PAGE_SIZE) => {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
  };
  set("actor", filters.actor);
  set("actorUserId", filters.actorUserId);
  set("action", filters.action);
  set("targetType", filters.targetType);
  set("targetId", filters.targetId);
  set("source", filters.source);
  if (DATE_PATTERN.test(filters.fromDate)) {
    params.set("from", sriLankaDateTimeLocalToIso(`${filters.fromDate}T00:00`));
  }
  if (DATE_PATTERN.test(filters.toDate)) {
    params.set("to", sriLankaDateTimeLocalToIso(`${nextCalendarDay(filters.toDate)}T00:00`));
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
};

/** Filters a link can open the page with, e.g. `/admin/audit-log?targetType=User&targetId=…`. */
export const auditLogFiltersFromSearchParams = (params: URLSearchParams): AuditLogFilters => ({
  ...emptyAuditLogFilters,
  ...Object.fromEntries(
    (Object.keys(emptyAuditLogFilters) as (keyof AuditLogFilters)[])
      .map((key) => [key, params.get(key)?.trim() ?? ""])
      .filter(([, value]) => value),
  ),
});

export const hasActiveAuditLogFilters = (filters: AuditLogFilters) =>
  Object.values(filters).some((value) => value.trim() !== "");

type ListEnvelope = { data?: { entries?: AuditLogEntry[]; pagination?: Pagination } };
type FacetsEnvelope = { data?: AuditLogFacets };

export async function listAuditLogs(filters: AuditLogFilters, page: number) {
  const result = await adminRequest<ListEnvelope>(`/api/v1/admin/audit-logs?${buildAuditLogQuery(filters, page)}`);
  return {
    entries: result?.data?.entries ?? [],
    pagination: result?.data?.pagination ?? { page, pageSize: AUDIT_LOG_PAGE_SIZE, total: 0, totalPages: 1 },
  };
}

export async function getAuditLogFacets(): Promise<AuditLogFacets> {
  const result = await adminRequest<FacetsEnvelope>("/api/v1/admin/audit-logs/facets");
  return result?.data ?? { actions: [], targetTypes: [], sources: [] };
}

export const auditSourceLabel = (source: AuditSource | null) => {
  switch (source) {
    case "web":
      return "Website";
    case "admin":
      return "Admin panel";
    case "mobile":
      return "Mobile admin";
    case "bot":
      return "Bot / automation";
    case "system":
      return "System";
    default:
      // Rows written before source tracking existed.
      return "Not recorded";
  }
};

export const describeAuditActor = (entry: Pick<AuditLogEntry, "actor" | "source">) => {
  if (entry.actor) return entry.actor.name ? `${entry.actor.name} (@${entry.actor.username})` : `@${entry.actor.username}`;
  // No actor id is stored for automation, and it is cleared when an account is deleted.
  return entry.source === "bot" || entry.source === "system" ? "Automation" : "System or deleted account";
};

export type AuditChange = { field: string; before: unknown; after: unknown; changed: boolean };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Field-by-field view of a row's before and after. Objects are compared by
 * top-level key; anything else is shown as one `value` row. Changed fields
 * come first so a large snapshot still leads with what moved.
 */
export const diffAuditData = (before: unknown, after: unknown): AuditChange[] => {
  if (before == null && after == null) return [];
  if (!isPlainObject(before ?? {}) || !isPlainObject(after ?? {})) {
    return [{ field: "value", before: before ?? null, after: after ?? null, changed: !sameValue(before, after) }];
  }
  const beforeObject = (before ?? {}) as Record<string, unknown>;
  const afterObject = (after ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])];
  return fields
    .map((field) => ({
      field,
      before: field in beforeObject ? beforeObject[field] : undefined,
      after: field in afterObject ? afterObject[field] : undefined,
      changed: !sameValue(beforeObject[field], afterObject[field]),
    }))
    .sort((left, right) => Number(right.changed) - Number(left.changed));
};

export const formatAuditValue = (value: unknown) => {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};
