"use client";

import { Select } from "@/components/ui/select";
import type { SupportConversation } from "@/lib/support";

export default function SupportAssignmentControl({ conversation, currentUserId, busy, onChange }: { conversation: SupportConversation; currentUserId: string; busy?: boolean; onChange: (id: string | null) => void }) {
  const assigned = conversation.assignedStaff;
  const label = assigned ? [assigned.firstName, assigned.lastName].filter(Boolean).join(" ") || assigned.username || "Assigned staff" : "Unassigned";
  return <div className="grid gap-2">
    <label htmlFor="support-assignment" className="text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Owner</label>
    <div className="flex flex-wrap gap-2">
      <Select id="support-assignment" aria-label="Conversation owner" disabled={busy} value={conversation.assignedStaffUserId || ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Unassigned</option><option value={currentUserId}>Me</option>
        {assigned && assigned.id !== currentUserId ? <option value={assigned.id}>{label}</option> : null}
      </Select>
      {assigned ? <span className="self-center text-xs text-slate-500">{label}</span> : null}
    </div>
  </div>;
}
