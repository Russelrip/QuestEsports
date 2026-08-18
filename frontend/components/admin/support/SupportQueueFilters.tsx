"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SupportQueueFilters as Filters, SupportStatus } from "@/lib/support";

export default function SupportQueueFilters({ value, onChange }: { value: Filters; onChange: (value: Filters) => void }) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <Input aria-label="Search conversations" value={value.search || ""} onChange={(event) => onChange({ ...value, search: event.target.value })} placeholder="Search subject or player…" />
    <Select aria-label="Filter by status" value={value.status || ""} onChange={(event) => onChange({ ...value, status: (event.target.value || undefined) as SupportStatus | undefined })}>
      <option value="">All statuses</option><option value="OPEN">Open</option><option value="PENDING_USER">Awaiting player</option><option value="PENDING_STAFF">Needs staff reply</option><option value="RESOLVED">Resolved</option>
    </Select>
    <Select aria-label="Filter by assignment" value={value.assigned || "all"} onChange={(event) => onChange({ ...value, assigned: event.target.value as Filters["assigned"] })}>
      <option value="all">All assignments</option><option value="unassigned">Unassigned</option><option value="mine">Assigned to me</option>
    </Select>
  </div>;
}
