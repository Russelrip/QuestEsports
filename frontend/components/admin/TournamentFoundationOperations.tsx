"use client";

import { useCallback, useEffect, useState } from "react";
import { adminRequest, type TeamRegistration } from "@/lib/admin";
import type { LiveMatch, MatchStatus } from "@/lib/matches";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Envelope<T> = { success: true; data: T; meta: { serverNow: string } };
type Integration = {
  id: string; identifier: string; enabled: boolean; syncFrequency: "manual" | "one_minute" | "five_minutes";
  lastAttemptAt: string | null; lastSuccessAt: string | null; nextSyncAt: string | null; lastError: { code: string; message: string } | null;
  participants: Array<{ id: string; displayName: string; seed: number | null; registrationId: string | null; isConfirmed: boolean }>;
};
type SyncLog = { id: string; status: string; trigger: string; startedAt: string; durationMs: number | null; errorCode: string | null };
type StaffAssignment = { id: string; role: "tournament_admin" | "referee"; user: { id: string; username: string; email: string } };

const statuses: MatchStatus[] = ["not_scheduled", "scheduled", "check_in_open", "veto_starting_soon", "veto_in_progress", "ready", "live", "delayed", "paused", "completed", "cancelled", "walkover"];
const jsonHeaders = { "Content-Type": "application/json" };
const v1 = async <T,>(path: string, options?: Parameters<typeof adminRequest>[1]) => (await adminRequest<Envelope<T>>(path, options)).data;
const localDateTime = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";

export default function TournamentFoundationOperations({ tournamentId, registrations }: { tournamentId: string; registrations: TeamRegistration[] }) {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [frequency, setFrequency] = useState<Integration["syncFrequency"]>("five_minutes");
  const [enabled, setEnabled] = useState(false);
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [staff, setStaff] = useState<StaffAssignment[]>([]);
  const [staffUserId, setStaffUserId] = useState("");
  const [staffRole, setStaffRole] = useState<StaffAssignment["role"]>("referee");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ identifier: "", team1: "", team2: "", scheduledAt: "", station: "" });

  const load = useCallback(async () => {
    const [nextIntegration, nextMatches, nextLogs] = await Promise.all([
      v1<Integration | null>(`/api/v1/admin/tournaments/${tournamentId}/challonge`),
      v1<LiveMatch[]>(`/api/v1/admin/tournaments/${tournamentId}/matches`),
      v1<SyncLog[]>(`/api/v1/admin/tournaments/${tournamentId}/challonge/logs`),
    ]);
    setIntegration(nextIntegration); setMatches(nextMatches); setLogs(nextLogs);
    if (nextIntegration) { setIdentifier(nextIntegration.identifier); setFrequency(nextIntegration.syncFrequency); setEnabled(nextIntegration.enabled); }
    try { setStaff(await v1<StaffAssignment[]>(`/api/v1/admin/tournaments/${tournamentId}/staff`)); } catch { setStaff([]); }
  }, [tournamentId]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load live operations.")); }, [load]);

  const act = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setMessage("");
    try { await action(); setMessage(success); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); }
  };

  return <div className="grid gap-6">
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-2xl text-white">Challonge synchronization</h3><p className="mt-1 max-w-2xl text-sm text-slate-400">Server-side participant, bracket, and score synchronization. Existing native bracket data is preserved while this integration is linked.</p></div><Button disabled={busy || !integration} variant="secondary" onClick={() => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/challonge/sync`, { method: "POST" }); }, "Synchronization completed.")}>Synchronize now</Button></div>
      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <Input aria-label="Challonge identifier or URL" placeholder="Tournament identifier or HTTPS URL" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        <Select aria-label="Synchronization frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Integration["syncFrequency"])}><option value="manual">Manual only</option><option value="five_minutes">Every five minutes</option><option value="one_minute">Every minute</option></Select>
        <label className="flex items-center gap-3 border border-white/10 px-4"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled</label>
      </div>
      <Button className="mt-4" disabled={busy || !identifier.trim()} onClick={() => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/challonge`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ identifier, syncFrequency: frequency, enabled }) }); }, "Integration settings saved.")}>Save integration</Button>
      {integration ? <div className="mt-5 grid gap-2 border-t border-white/8 pt-5 text-xs text-slate-400 sm:grid-cols-3"><p>Last success: <span className="text-white">{integration.lastSuccessAt ? new Date(integration.lastSuccessAt).toLocaleString() : "Never"}</span></p><p>Next attempt: <span className="text-white">{integration.nextSyncAt ? new Date(integration.nextSyncAt).toLocaleString() : "Manual"}</span></p><p>{integration.lastError ? <span className="text-rose-200">{integration.lastError.code}: {integration.lastError.message}</span> : "No current sync error"}</p></div> : null}
      {message ? <p className="mt-4 text-sm text-slate-200" role="status">{message}</p> : null}
    </Card>

    {integration?.participants.length ? <Card className="p-6 sm:p-8"><h3 className="text-2xl text-white">Participant mapping</h3><p className="mt-1 text-sm text-slate-400">Mappings grant match access only after an administrator confirms them.</p><div className="mt-5 grid gap-3">{integration.participants.map((participant) => <div key={participant.id} className="grid min-w-0 gap-3 border border-white/8 bg-white/[0.025] p-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,1fr)] md:items-center"><p className="overflow-wrap-anywhere text-sm text-white">{participant.seed ? `#${participant.seed} ` : ""}{participant.displayName}{participant.isConfirmed ? <span className="ml-2 text-emerald-300">Confirmed</span> : null}</p><Select aria-label={`Map ${participant.displayName}`} value={participant.registrationId || ""} disabled={busy} onChange={(event) => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/challonge/participants/${participant.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ registrationId: event.target.value || null }) }); }, "Participant mapping updated.")}><option value="">Not mapped</option>{registrations.map((registration) => <option key={registration.id} value={registration.id}>{registration.teamName || registration.captain?.name || registration.contactEmail}</option>)}</Select></div>)}</div></Card> : null}

    <Card className="p-6 sm:p-8"><h3 className="text-2xl text-white">Match operations</h3><p className="mt-1 text-sm text-slate-400">Create local fixtures and maintain authoritative operational times, station, status, and staff assignment.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Input placeholder="Match label" value={draft.identifier} onChange={(event) => setDraft((value) => ({ ...value, identifier: event.target.value }))} /><Input placeholder="Team / player one" value={draft.team1} onChange={(event) => setDraft((value) => ({ ...value, team1: event.target.value }))} /><Input placeholder="Team / player two" value={draft.team2} onChange={(event) => setDraft((value) => ({ ...value, team2: event.target.value }))} /><Input type="datetime-local" aria-label="Scheduled time" value={draft.scheduledAt} onChange={(event) => setDraft((value) => ({ ...value, scheduledAt: event.target.value }))} /><Input placeholder="Station" value={draft.station} onChange={(event) => setDraft((value) => ({ ...value, station: event.target.value }))} /></div>
      <Button className="mt-3" disabled={busy} onClick={() => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/matches`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ identifier: draft.identifier, scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null, station: draft.station, status: draft.scheduledAt ? "scheduled" : "not_scheduled", participants: [{ displayName: draft.team1 }, { displayName: draft.team2 }] }) }); setDraft({ identifier: "", team1: "", team2: "", scheduledAt: "", station: "" }); }, "Match created.")}>Create match</Button>
      <div className="mt-6 grid gap-4">{matches.length ? matches.map((match) => <MatchOperationRow key={match.id} match={match} staff={staff} busy={busy} onSave={(body) => act(async () => { await v1(`/api/v1/admin/matches/${match.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) }); }, "Match updated.")} />) : <p className="border border-dashed border-white/10 p-5 text-sm text-slate-400">No normalized matches exist for this tournament.</p>}</div>
    </Card>

    <Card className="p-6 sm:p-8"><h3 className="text-2xl text-white">Tournament staff</h3><p className="mt-1 text-sm text-slate-400">Super admins can assign tournament administrators and referees by account ID.</p><div className="mt-5 flex flex-col gap-3 sm:flex-row"><Input placeholder="User ID" value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)} /><Select value={staffRole} onChange={(event) => setStaffRole(event.target.value as StaffAssignment["role"])}><option value="referee">Referee</option><option value="tournament_admin">Tournament admin</option></Select><Button disabled={busy || !staffUserId.trim()} onClick={() => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/staff`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ userId: staffUserId, role: staffRole }) }); setStaffUserId(""); }, "Staff assignment saved.")}>Assign</Button></div>{staff.length ? <div className="mt-5 grid gap-2">{staff.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/8 p-3 text-sm"><span className="overflow-wrap-anywhere text-white">{assignment.user.username} · {assignment.role.replace("_", " ")}</span><Button size="sm" variant="danger" disabled={busy} onClick={() => void act(async () => { await v1(`/api/v1/admin/tournaments/${tournamentId}/staff/${assignment.id}`, { method: "DELETE" }); }, "Staff assignment removed.")}>Remove</Button></div>)}</div> : null}</Card>

    {logs.length ? <Card className="p-6 sm:p-8"><h3 className="text-2xl text-white">Recent sync attempts</h3><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Started</th><th className="p-2">Trigger</th><th className="p-2">Status</th><th className="p-2">Duration</th><th className="p-2">Error</th></tr></thead><tbody>{logs.slice(0, 10).map((log) => <tr key={log.id} className="border-t border-white/8 text-slate-300"><td className="p-2">{new Date(log.startedAt).toLocaleString()}</td><td className="p-2">{log.trigger}</td><td className="p-2">{log.status}</td><td className="p-2">{log.durationMs === null ? "—" : `${log.durationMs} ms`}</td><td className="p-2">{log.errorCode || "—"}</td></tr>)}</tbody></table></div></Card> : null}
  </div>;
}

function MatchOperationRow({ match, staff, busy, onSave }: { match: LiveMatch; staff: StaffAssignment[]; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ status: match.status, scheduledAt: localDateTime(match.scheduledAt), estimatedAt: localDateTime(match.estimatedAt), checkInDeadline: localDateTime(match.checkInDeadline), vetoStartAt: localDateTime(match.vetoStartAt), station: match.station || "", assignedStaffId: match.assignedStaff?.id || "", localNotes: match.localNotes || "" });
  const date = (value: string) => value ? new Date(value).toISOString() : null;
  const allowedStatuses = match.source === "quest" ? statuses : Array.from(new Set<MatchStatus>([match.status, "check_in_open", "veto_starting_soon", "veto_in_progress", "ready", "delayed", "paused"]));
  return <div className="min-w-0 border border-white/10 bg-[#151821] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="overflow-wrap-anywhere font-semibold text-white">{match.participants[0]?.displayName || "TBD"} vs {match.participants[1]?.displayName || "TBD"}</p><p className="mt-1 text-xs text-slate-500">{match.source} · {match.identifier}</p></div><Select className="w-auto" value={form.status} onChange={(event) => setForm((value) => ({ ...value, status: event.target.value as MatchStatus }))}>{allowedStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</Select></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs text-slate-400">Scheduled<Input className="mt-1" type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((value) => ({ ...value, scheduledAt: event.target.value }))} /></label><label className="text-xs text-slate-400">Estimate<Input className="mt-1" type="datetime-local" value={form.estimatedAt} onChange={(event) => setForm((value) => ({ ...value, estimatedAt: event.target.value }))} /></label><label className="text-xs text-slate-400">Check-in deadline<Input className="mt-1" type="datetime-local" value={form.checkInDeadline} onChange={(event) => setForm((value) => ({ ...value, checkInDeadline: event.target.value }))} /></label><label className="text-xs text-slate-400">Veto start<Input className="mt-1" type="datetime-local" value={form.vetoStartAt} onChange={(event) => setForm((value) => ({ ...value, vetoStartAt: event.target.value }))} /></label><Input placeholder="Station" value={form.station} onChange={(event) => setForm((value) => ({ ...value, station: event.target.value }))} /><Select aria-label="Assigned staff" value={form.assignedStaffId} onChange={(event) => setForm((value) => ({ ...value, assignedStaffId: event.target.value }))}><option value="">No assigned staff</option>{staff.map((assignment) => <option key={assignment.id} value={assignment.user.id}>{assignment.user.username} ({assignment.role.replace("_", " ")})</option>)}</Select><Textarea className="md:col-span-2" placeholder="Local operational notes" value={form.localNotes} onChange={(event) => setForm((value) => ({ ...value, localNotes: event.target.value }))} /></div><Button className="mt-3" size="sm" disabled={busy} onClick={() => void onSave({ ...form, scheduledAt: date(form.scheduledAt), estimatedAt: date(form.estimatedAt), checkInDeadline: date(form.checkInDeadline), vetoStartAt: date(form.vetoStartAt), assignedStaffId: form.assignedStaffId || null })}>Save match</Button></div>;
}
