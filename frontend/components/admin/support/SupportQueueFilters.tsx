"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SupportQueueFilters as Filters, SupportStatus } from "@/lib/support";

export type SupportQueueView = "inbox" | "mine" | "unassigned" | "archived";

const views: { value: SupportQueueView; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "archived", label: "Archived" },
];

export const viewOf = (filters: Filters): SupportQueueView => filters.archived ? "archived" : filters.assigned === "mine" ? "mine" : filters.assigned === "unassigned" ? "unassigned" : "inbox";

const withView = (filters: Filters, view: SupportQueueView): Filters => ({
  ...filters,
  archived: view === "archived" || undefined,
  assigned: view === "mine" || view === "unassigned" ? view : "all",
});

// Views first, like the folders of a shared inbox; status and search narrow
// whichever view is open.
export default function SupportQueueFilters({ value, onChange }: { value: Filters; onChange: (value: Filters) => void }) {
  const current = viewOf(value);
  return <div className="grid gap-3">
    <div role="tablist" aria-label="Queue view" className="grid grid-cols-4 gap-1 rounded-2xl border border-white/8 bg-black/25 p-1">
      {views.map((view) => <button key={view.value} type="button" role="tab" aria-selected={current === view.value} onClick={() => onChange(withView(value, view.value))} className={cn("h-9 rounded-xl px-2 text-xs font-semibold transition", current === view.value ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200")}>{view.label}</button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <Input aria-label="Search conversations" value={value.search || ""} onChange={(event) => onChange({ ...value, search: event.target.value })} placeholder="Search subject or player…" />
      <Select aria-label="Filter by status" value={value.status || ""} onChange={(event) => onChange({ ...value, status: (event.target.value || undefined) as SupportStatus | undefined })}>
        <option value="">All statuses</option><option value="OPEN">Open</option><option value="PENDING_USER">Awaiting player</option><option value="PENDING_STAFF">Needs staff reply</option><option value="RESOLVED">Resolved</option>
      </Select>
    </div>
  </div>;
}
