"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import {
  adminRequest,
  formatAdminCompactDateTime,
  type AdminChallongeIntegration,
  type ChallongeSyncLog,
} from "@/lib/admin";

type IntegrationEnvelope = { data: AdminChallongeIntegration | null };
type LogsEnvelope = { data: ChallongeSyncLog[] };
type Editor = NonNullable<AdminChallongeIntegration["editor"]>;
type EditorParticipant = Editor["participants"][number];
type EditorMatch = Editor["matches"][number];

export default function ChallongeAdminPanel({ tournamentId }: { tournamentId: string }) {
  const [integration, setIntegration] = useState<AdminChallongeIntegration | null>(null);
  const [logs, setLogs] = useState<ChallongeSyncLog[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [participantName, setParticipantName] = useState("");
  const [participantSeed, setParticipantSeed] = useState("");
  const [stateAction, setStateAction] = useState("start");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [integrationResponse, logsResponse] = await Promise.all([
      adminRequest<IntegrationEnvelope>(`/api/v1/admin/tournaments/${tournamentId}/challonge`),
      adminRequest<LogsEnvelope>(`/api/v1/admin/tournaments/${tournamentId}/challonge/logs`),
    ]);
    setIntegration(integrationResponse.data);
    setLogs(logsResponse.data);
    if (integrationResponse.data) {
      setIdentifier(integrationResponse.data.identifier);
      setEnabled(integrationResponse.data.enabled);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load()
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Unable to load Challonge settings."))
      .finally(() => setLoading(false));
  }, [load]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The Challonge action failed.");
    } finally {
      setBusy("");
    }
  };

  const updateEditor = (mutate: (editor: Editor) => Editor) => {
    setIntegration((current) => current?.editor ? { ...current, editor: mutate(current.editor) } : current);
  };

  const saveConnection = () => runAction("save", async () => {
    const response = await adminRequest<IntegrationEnvelope>(`/api/v1/admin/tournaments/${tournamentId}/challonge`, {
      method: "PATCH",
      json: {
        identifier: identifier.trim(),
        enabled,
        automaticSyncEnabled: false,
        syncFrequency: "manual",
      },
    });
    setIntegration(response.data);
    setMessage("Challonge connection saved. Public visitors will use the embedded bracket.");
  });

  const refreshEditor = () => runAction("refresh", async () => {
    const response = await adminRequest<IntegrationEnvelope>(`/api/v1/admin/tournaments/${tournamentId}/challonge/sync`, {
      method: "POST",
      json: {},
    });
    setIntegration(response.data);
    setMessage(`Current Challonge editor data loaded. This used ${/^\d+$/.test(identifier.trim()) || integration?.editor?.tournament?.id ? "three" : "up to four"} API resource requests.`);
    await load();
  });

  const addParticipant = () => runAction("participant-create", async () => {
    const response = await adminRequest<{ data: EditorParticipant }>(`/api/v1/admin/tournaments/${tournamentId}/challonge/participants`, {
      method: "POST",
      json: { name: participantName.trim(), seed: participantSeed || null },
    });
    updateEditor((editor) => ({ ...editor, participants: [...editor.participants, response.data] }));
    setParticipantName("");
    setParticipantSeed("");
    setMessage(`${response.data.name} was added to Challonge.`);
  });

  const changeState = () => runAction("state", async () => {
    const response = await adminRequest<{ data: { state: string } }>(`/api/v1/admin/tournaments/${tournamentId}/challonge/state`, {
      method: "PUT",
      json: { state: stateAction },
    });
    updateEditor((editor) => ({ ...editor, tournament: editor.tournament ? { ...editor.tournament, state: response.data.state } : null }));
    setMessage(`Challonge tournament state changed to ${response.data.state.replace(/_/g, " ")}.`);
  });

  const participantById = useMemo(
    () => new Map((integration?.editor?.participants || []).map((participant) => [participant.id, participant])),
    [integration?.editor?.participants]
  );

  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-8">
      <div className="mb-6 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">Low-usage server integration</p>
        <h3 className="mt-2 break-words text-2xl text-white">Challonge Bracket Manager</h3>
        <p className="mt-2 break-words text-sm leading-6 text-slate-400">The public page embeds Challonge directly and does not poll its REST API. Only deliberate admin actions below consume the 500-request monthly allowance. Credentials remain on the API server.</p>
      </div>
      {loading ? <AdminTableSkeleton rows={4} /> : <div className="grid min-w-0 gap-6">
        <section className="grid min-w-0 gap-4 border border-white/8 bg-white/5 p-3 sm:p-4">
          <FormField label="Numeric tournament ID or public URL" htmlFor="challongeIdentifier">
            <Input id="challongeIdentifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="12345678 or https://challonge.com/quest-open" disabled={Boolean(busy)} />
          </FormField>
          <label className="flex min-w-0 items-start gap-3 text-sm text-slate-200"><input className="mt-0.5 shrink-0" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={Boolean(busy)} /><span className="min-w-0 break-words">Use the public Challonge bracket on the tournament page</span></label>
          <div className="grid min-w-0 gap-3 sm:flex sm:flex-wrap [&>*]:min-w-0 [&>*]:w-full sm:[&>*]:w-auto">
            <Button type="button" onClick={() => void saveConnection()} disabled={Boolean(busy) || !identifier.trim()}>{busy === "save" ? "Saving..." : "Save Connection"}</Button>
            <Button type="button" variant="secondary" onClick={() => void refreshEditor()} disabled={Boolean(busy) || !integration}>{busy === "refresh" ? "Loading..." : "Load Current Data (3–4 Requests)"}</Button>
          </div>
        </section>

        {message ? <p className="text-sm text-emerald-300" role="status">{message}</p> : null}
        {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : null}

        {integration?.editor ? <>
          <section className="grid min-w-0 gap-4 border border-white/8 p-3 sm:p-4">
            <div><h4 className="text-lg text-white">Tournament state</h4><p className="mt-1 text-sm text-slate-500">Current state: {integration.editor.tournament?.state?.replace(/_/g, " ") || "unknown"}</p></div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] [&>*]:min-w-0">
              <Select aria-label="Tournament state action" value={stateAction} onChange={(event) => setStateAction(event.target.value)} disabled={Boolean(busy)}>
                <option value="start">Start final stage</option><option value="finalize">Finalize tournament</option><option value="reset">Reset tournament</option><option value="start_group_stage">Start group stage</option><option value="finalize_group_stage">Finalize group stage</option><option value="reset_group_stage">Reset group stage</option>
              </Select>
              <Button type="button" variant="secondary" onClick={() => void changeState()} disabled={Boolean(busy)}>{busy === "state" ? "Applying..." : "Apply State Action"}</Button>
            </div>
          </section>

          <section className="grid min-w-0 gap-4 border border-white/8 p-3 sm:p-4">
            <div><h4 className="text-lg text-white">Participants</h4><p className="mt-1 text-sm text-slate-500">Each create, update or delete action uses one API request.</p></div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] [&>*]:min-w-0">
              <Input aria-label="New participant name" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Team or player name" disabled={Boolean(busy)} />
              <Input aria-label="New participant seed" type="number" min="1" value={participantSeed} onChange={(event) => setParticipantSeed(event.target.value)} placeholder="Seed" disabled={Boolean(busy)} />
              <Button type="button" onClick={() => void addParticipant()} disabled={Boolean(busy) || !participantName.trim()}>{busy === "participant-create" ? "Adding..." : "Add Participant"}</Button>
            </div>
            <div className="grid gap-2">{integration.editor.participants.map((participant) => <ParticipantEditor key={participant.id} participant={participant} tournamentId={tournamentId} busy={busy} runAction={runAction} onUpdated={(next) => updateEditor((editor) => ({ ...editor, participants: editor.participants.map((entry) => entry.id === next.id ? next : entry) }))} onDeleted={(id) => updateEditor((editor) => ({ ...editor, participants: editor.participants.filter((entry) => entry.id !== id) }))} setMessage={setMessage} />)}{integration.editor.participants.length === 0 ? <p className="text-sm text-slate-500">No participants loaded.</p> : null}</div>
          </section>

          <section className="grid min-w-0 gap-4 border border-white/8 p-3 sm:p-4">
            <div><h4 className="text-lg text-white">Match results</h4><p className="mt-1 text-sm text-slate-500">Report comma-separated set scores and choose the winner. Each submission uses one API request.</p></div>
            <div className="grid gap-3">{integration.editor.matches.map((match) => <MatchEditor key={match.id} match={match} participantById={participantById} tournamentId={tournamentId} busy={busy} runAction={runAction} onUpdated={(next) => updateEditor((editor) => ({ ...editor, matches: editor.matches.map((entry) => entry.id === next.id ? next : entry) }))} setMessage={setMessage} />)}{integration.editor.matches.length === 0 ? <p className="text-sm text-slate-500">No matches loaded. Start the bracket in Challonge, then load current data.</p> : null}</div>
          </section>
        </> : integration ? <p className="text-sm text-amber-200">Load current data once before using the API editor.</p> : null}

        {integration ? <div className="grid gap-3 border border-white/8 bg-white/5 p-4 text-sm sm:grid-cols-3"><Status label="Last editor load" value={formatAdminCompactDateTime(integration.lastSuccessAt)} /><Status label="Automatic polling" value="Disabled" /><Status label="Last error" value={integration.lastError?.message || "None"} error={Boolean(integration.lastError)} /></div> : null}
        <div className="min-w-0"><h4 className="text-lg text-white">Recent data-load attempts</h4>{logs.length ? <div className="mt-3 max-w-full overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs uppercase tracking-[0.1em] text-slate-500"><tr><th className="pb-2">Started</th><th>Status</th><th>Tournament</th><th>Records</th><th>Details</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-t border-white/8 text-slate-300"><td className="py-3">{formatAdminCompactDateTime(log.startedAt)}</td><td className={log.status === "failed" ? "text-rose-300" : log.status === "succeeded" ? "text-emerald-300" : "text-amber-200"}>{log.status}</td><td>{log.identifier || integration?.identifier || "Legacy attempt"}</td><td>{log.participantCount} / {log.matchCount}</td><td>{log.errorMessage || log.errorCode?.replace(/_/g, " ") || `${log.durationMs ?? 0} ms`}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-500">No data loads recorded yet.</p>}</div>
      </div>}
    </Card>
  );
}

function ParticipantEditor({ participant, tournamentId, busy, runAction, onUpdated, onDeleted, setMessage }: { participant: EditorParticipant; tournamentId: string; busy: string; runAction: (key: string, action: () => Promise<void>) => Promise<void>; onUpdated: (participant: EditorParticipant) => void; onDeleted: (id: string) => void; setMessage: (message: string) => void }) {
  const [name, setName] = useState(participant.name);
  const [seed, setSeed] = useState(participant.seed?.toString() || "");
  const update = () => runAction(`participant-${participant.id}`, async () => {
    const response = await adminRequest<{ data: EditorParticipant }>(`/api/v1/admin/tournaments/${tournamentId}/challonge/participants/${participant.id}`, { method: "PUT", json: { name: name.trim(), seed: seed || null } });
    onUpdated(response.data); setMessage(`${response.data.name} was updated in Challonge.`);
  });
  const remove = () => {
    if (!window.confirm(`Delete or deactivate ${participant.name} in Challonge?`)) return Promise.resolve();
    return runAction(`participant-${participant.id}`, async () => {
      await adminRequest(`/api/v1/admin/tournaments/${tournamentId}/challonge/participants/${participant.id}`, { method: "DELETE" });
      onDeleted(participant.id); setMessage(`${participant.name} was removed from Challonge.`);
    });
  };
  return <div className="grid min-w-0 gap-2 border border-white/8 bg-white/5 p-3 sm:grid-cols-[minmax(0,1fr)_100px_auto_auto] [&>*]:min-w-0"><Input aria-label={`${participant.name} name`} value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(busy)} /><Input aria-label={`${participant.name} seed`} type="number" min="1" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={Boolean(busy)} /><Button type="button" size="sm" variant="secondary" onClick={() => void update()} disabled={Boolean(busy) || !name.trim()}>{busy === `participant-${participant.id}` ? "Working..." : "Update"}</Button><Button type="button" size="sm" variant="danger" onClick={() => void remove()} disabled={Boolean(busy)}>Remove</Button></div>;
}

function MatchEditor({ match, participantById, tournamentId, busy, runAction, onUpdated, setMessage }: { match: EditorMatch; participantById: Map<string, EditorParticipant>; tournamentId: string; busy: string; runAction: (key: string, action: () => Promise<void>) => Promise<void>; onUpdated: (match: EditorMatch) => void; setMessage: (message: string) => void }) {
  const [player1Score, setPlayer1Score] = useState("");
  const [player2Score, setPlayer2Score] = useState("");
  const [winnerId, setWinnerId] = useState(match.winnerId || "");
  const [tie, setTie] = useState(false);
  const player1 = match.player1Id ? participantById.get(match.player1Id) : null;
  const player2 = match.player2Id ? participantById.get(match.player2Id) : null;
  const isOpen = match.state === "open";
  const disabled = Boolean(busy) || !isOpen;
  const submit = () => runAction(`match-${match.id}`, async () => {
    const response = await adminRequest<{ data: EditorMatch }>(`/api/v1/admin/tournaments/${tournamentId}/challonge/matches/${match.id}`, { method: "PUT", json: { player1Score, player2Score, winnerId, tie } });
    onUpdated(response.data); setMessage(`Match ${match.identifier || match.id} was updated in Challonge.`);
  });
  const ready = Boolean(isOpen && player1 && player2 && player1Score && player2Score && (tie || winnerId));
  return (
    <div className="grid min-w-0 gap-3 border border-white/8 bg-white/5 p-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <div>
          <span className="font-semibold text-white">{match.identifier || `Match ${match.id}`} · Round {match.round ?? "-"}</span>
          <p className="mt-1 text-slate-300">{player1?.name || "TBD"} <span className="text-slate-600">vs</span> {player2?.name || "TBD"}</p>
        </div>
        <span className={isOpen ? "text-emerald-300" : "text-slate-500"}>{match.state.replace(/_/g, " ")}</span>
      </div>
      {!isOpen ? <p className="text-xs text-slate-500">Waiting for the preceding match to determine both competitors.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={`${player1?.name || "Player 1"} scores`} htmlFor={`match-${match.id}-player-1`}>
          <Input id={`match-${match.id}-player-1`} value={player1Score} onChange={(event) => setPlayer1Score(event.target.value)} placeholder="Example: 13,13" disabled={disabled || !player1} />
        </FormField>
        <FormField label={`${player2?.name || "Player 2"} scores`} htmlFor={`match-${match.id}-player-2`}>
          <Input id={`match-${match.id}-player-2`} value={player2Score} onChange={(event) => setPlayer2Score(event.target.value)} placeholder="Example: 8,10" disabled={disabled || !player2} />
        </FormField>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] [&>*]:min-w-0">
        <Select aria-label={`${match.id} winner`} value={winnerId} onChange={(event) => setWinnerId(event.target.value)} disabled={disabled || tie || !player1 || !player2}>
          <option value="">Choose winner</option>
          {match.player1Id ? <option value={match.player1Id}>{player1?.name || match.player1Id}</option> : null}
          {match.player2Id ? <option value={match.player2Id}>{player2?.name || match.player2Id}</option> : null}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={tie} onChange={(event) => setTie(event.target.checked)} disabled={disabled || !player1 || !player2} />Tie</label>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={Boolean(busy) || !ready}>{busy === `match-${match.id}` ? "Submitting..." : "Report Result"}</Button>
      </div>
    </div>
  );
}

function Status({ label, value, error = false }: { label: string; value: string; error?: boolean }) {
  return <div><p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-1 break-words ${error ? "text-rose-300" : "text-slate-200"}`}>{value}</p></div>;
}
