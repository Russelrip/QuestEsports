"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatAdminCompactDateTime, getAdminPaginationSummary, type Pagination } from "@/lib/admin";
import {
  auditLogFiltersFromSearchParams,
  auditSourceLabel,
  describeAuditActor,
  diffAuditData,
  emptyAuditLogFilters,
  formatAuditValue,
  getAuditLogFacets,
  hasActiveAuditLogFilters,
  listAuditLogs,
  type AuditLogEntry,
  type AuditLogFacets,
  type AuditLogFilters,
} from "@/lib/audit-log";

const ValueCell = ({ value, tone }: { value: unknown; tone: "before" | "after" }) => (
  <pre
    className={
      "max-h-48 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs " +
      (tone === "before" ? "text-rose-200/90" : "text-emerald-200/90")
    }
  >
    {formatAuditValue(value)}
  </pre>
);

function AuditLogDetails({ entry }: { entry: AuditLogEntry }) {
  const changes = diffAuditData(entry.beforeData, entry.afterData);
  const unchanged = changes.filter((change) => !change.changed).length;

  return (
    <div className="grid gap-4 border-t border-white/10 pt-4">
      {changes.length === 0 ? (
        <p className="text-sm text-slate-400">No before or after data was recorded for this action.</p>
      ) : (
        <div className="grid gap-2">
          <div className="hidden grid-cols-[minmax(8rem,0.6fr)_1fr_1fr] gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid">
            <span>Field</span>
            <span>Before</span>
            <span>After</span>
          </div>
          {changes.map((change) => (
            <div
              key={change.field}
              className={
                "grid min-w-0 gap-2 md:grid-cols-[minmax(8rem,0.6fr)_1fr_1fr] md:gap-3 " +
                (change.changed ? "" : "opacity-60")
              }
            >
              <p className="break-all font-mono text-xs text-slate-300">
                {change.field}
                {change.changed ? null : <span className="ml-2 text-slate-500">(unchanged)</span>}
              </p>
              <ValueCell value={change.before} tone="before" />
              <ValueCell value={change.after} tone="after" />
            </div>
          ))}
          {unchanged > 0 ? (
            <p className="text-xs text-slate-500">
              {unchanged} unchanged {unchanged === 1 ? "field is" : "fields are"} shown dimmed for context.
            </p>
          ) : null}
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
        <div className="min-w-0"><dt className="inline">Entry ID: </dt><dd className="inline break-all font-mono">{entry.id}</dd></div>
        <div className="min-w-0"><dt className="inline">Request ID: </dt><dd className="inline break-all font-mono">{entry.requestId || "Not recorded"}</dd></div>
        <div className="min-w-0"><dt className="inline">IP address: </dt><dd className="inline break-all font-mono">{entry.ipAddress || "Not recorded"}</dd></div>
        <div className="min-w-0"><dt className="inline">Actor email: </dt><dd className="inline break-all">{entry.actor?.email || "—"}</dd></div>
      </dl>
    </div>
  );
}

export default function AdminAuditLog() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<AuditLogFilters>(() => auditLogFiltersFromSearchParams(searchParams));
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [facets, setFacets] = useState<AuditLogFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Typing fields wait for a pause; menus and dates apply at once.
  const debouncedActor = useDebouncedValue(filters.actor);
  const debouncedTargetId = useDebouncedValue(filters.targetId);
  const appliedFilters = { ...filters, actor: debouncedActor, targetId: debouncedTargetId };
  const appliedKey = JSON.stringify(appliedFilters);

  useEffect(() => {
    getAuditLogFacets().then(setFacets).catch(() => setFacets(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listAuditLogs(JSON.parse(appliedKey) as AuditLogFilters, page);
      setEntries(result.entries);
      setPagination(result.pagination);
    } catch (reason) {
      setEntries([]);
      setPagination(null);
      setError(reason instanceof Error ? reason.message : "Unable to load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [appliedKey, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateFilter = (key: keyof AuditLogFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const applyFilters = (next: Partial<AuditLogFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A filter opened from a link may name a value no longer in the menu; keep it selectable.
  const withCurrent = (options: { value: string; count: number }[] | undefined, current: string) =>
    current && !options?.some((option) => option.value === current)
      ? [{ value: current, count: 0 }, ...(options ?? [])]
      : options ?? [];

  return (
    <AdminShell
      title="Audit log"
      description="Every recorded change across Quest: who made it, from where, and what it changed. Entries cannot be edited or deleted from here."
      actions={
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      }
    >
      <Card className="p-6 sm:p-8">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Actor" htmlFor="audit-actor">
            <Input
              id="audit-actor"
              value={filters.actor}
              onChange={(event) => updateFilter("actor", event.target.value)}
              placeholder="Name, username or email"
            />
          </FormField>
          <FormField label="Action" htmlFor="audit-action">
            <Select id="audit-action" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)}>
              <option value="">All actions</option>
              {withCurrent(facets?.actions, filters.action).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}{option.count ? ` (${option.count})` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Target type" htmlFor="audit-target-type">
            <Select id="audit-target-type" value={filters.targetType} onChange={(event) => updateFilter("targetType", event.target.value)}>
              <option value="">All targets</option>
              {withCurrent(facets?.targetTypes, filters.targetType).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}{option.count ? ` (${option.count})` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Target ID" htmlFor="audit-target-id">
            <Input
              id="audit-target-id"
              value={filters.targetId}
              onChange={(event) => updateFilter("targetId", event.target.value)}
              placeholder="Exact ID"
            />
          </FormField>
          <FormField label="Source" htmlFor="audit-source">
            <Select id="audit-source" value={filters.source} onChange={(event) => updateFilter("source", event.target.value)}>
              <option value="">All sources</option>
              {(facets?.sources ?? ["web", "admin", "mobile", "bot", "system"]).map((source) => (
                <option key={source} value={source}>{auditSourceLabel(source)}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="From" htmlFor="audit-from" hint="Sri Lanka time">
            <Input id="audit-from" type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(event) => updateFilter("fromDate", event.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="audit-to" hint="Includes the whole day">
            <Input id="audit-to" type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(event) => updateFilter("toDate", event.target.value)} />
          </FormField>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={!hasActiveAuditLogFilters(filters)}
              onClick={() => applyFilters(emptyAuditLogFilters)}
            >
              Clear filters
            </Button>
          </div>
        </div>
        {filters.actorUserId ? (
          <p className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-300">
            Showing one account&apos;s changes only.
            <button
              type="button"
              className="text-violet-200 underline hover:text-white"
              onClick={() => updateFilter("actorUserId", "")}
            >
              Show every account
            </button>
          </p>
        ) : null}
      </Card>

      {loading && entries.length === 0 ? (
        <AdminTableSkeleton />
      ) : error ? (
        <EmptyState title="Could not load the audit log" description={error} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No entries"
          description={hasActiveAuditLogFilters(filters) ? "Nothing recorded matches these filters." : "Nothing has been recorded yet."}
        />
      ) : (
        <Card className="p-4 sm:p-6">
          <ol className="grid gap-3" aria-busy={loading}>
            {entries.map((entry) => {
              const open = expanded.has(entry.id);
              return (
                <li key={entry.id} className="grid min-w-0 gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <div className="grid min-w-0 gap-3 lg:grid-cols-[10rem_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-start">
                    <p className="text-sm text-slate-400">
                      <time dateTime={entry.createdAt}>{formatAdminCompactDateTime(entry.createdAt)}</time>
                    </p>
                    <div className="min-w-0">
                      {entry.actor ? (
                        <button
                          type="button"
                          className="break-all text-left text-sm font-semibold text-white hover:text-violet-200 hover:underline"
                          title="Show only this account's changes"
                          onClick={() => applyFilters({ actorUserId: entry.actor!.id, actor: "" })}
                        >
                          {describeAuditActor(entry)}
                        </button>
                      ) : (
                        <p className="text-sm font-semibold text-slate-300">{describeAuditActor(entry)}</p>
                      )}
                      <p className="text-xs text-slate-500">{auditSourceLabel(entry.source)}</p>
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="break-all text-left font-mono text-sm text-violet-200 hover:underline"
                        title="Show only this action"
                        onClick={() => applyFilters({ action: entry.action })}
                      >
                        {entry.action}
                      </button>
                      {entry.reason ? <p className="mt-1 break-words text-sm text-slate-300">“{entry.reason}”</p> : null}
                    </div>
                    <div className="min-w-0 text-sm">
                      <button
                        type="button"
                        className="break-all text-left text-slate-300 hover:text-white hover:underline"
                        title="Show the full history of this record"
                        onClick={() => applyFilters({ targetType: entry.targetType, targetId: entry.targetId ?? "" })}
                      >
                        {entry.targetType}
                      </button>
                      {entry.targetId ? <p className="break-all font-mono text-xs text-slate-500">{entry.targetId}</p> : null}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full lg:w-auto"
                      aria-expanded={open}
                      aria-controls={`audit-details-${entry.id}`}
                      onClick={() => toggle(entry.id)}
                    >
                      {open ? "Hide changes" : "Changes"}
                    </Button>
                  </div>
                  {open ? (
                    <div id={`audit-details-${entry.id}`}>
                      <AuditLogDetails entry={entry} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {pagination ? (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination, "entries")}</p>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" disabled={loading || pagination.page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                <Button type="button" variant="secondary" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </AdminShell>
  );
}
