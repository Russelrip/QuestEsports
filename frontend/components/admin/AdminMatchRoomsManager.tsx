"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminRequest } from "@/lib/admin";
import { roomRequest } from "@/lib/match-rooms";

type AdminRoom = {
  id: string;
  code: string;
  chatLocked: boolean;
  messageCount: number;
  openSupportCount: number;
  match: {
    id: string;
    identifier: string;
    status: string;
    scheduledAt: string | null;
    tournament: { id: string; title: string; game: string };
    participants: Array<{ slot: number; displayName: string }>;
    veto: { id: string; code: string; status: string; format: string } | null;
  };
};

type TournamentOption = { id: string; title: string; status: string };
type BulkSummary = { total: number; created: number; updated: number; skipped: Array<{ matchId: string; label: string; teams: string; reason: string }> };

// Rooms for active matches are rebuilt automatically, so only finished ones can go.
const FINISHED_MATCH_STATUSES = ["completed", "cancelled", "walkover"];

export default function AdminMatchRoomsManager() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [matchId, setMatchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentId, setTournamentId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRooms(await roomRequest<AdminRoom[]>("/api/v1/admin/match-rooms")); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load match rooms."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    Promise.resolve()
      .then(() => adminRequest<{ tournaments: TournamentOption[] }>("/api/admin/tournaments?pageSize=100"))
      .then((result) => setTournaments(result?.tournaments || []))
      .catch(() => setTournaments([]));
  }, []);

  const syncTournament = async () => {
    if (!tournamentId) return;
    setBulkBusy(true); setError(""); setSummary(null);
    try {
      setSummary(await roomRequest<BulkSummary>(`/api/v1/admin/tournaments/${encodeURIComponent(tournamentId)}/match-rooms`, { method: "POST", json: {} }));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create rooms for this tournament."); }
    finally { setBulkBusy(false); }
  };

  const sync = async () => {
    if (!matchId.trim()) return;
    setBusy(true); setError("");
    try {
      await roomRequest(`/api/v1/admin/matches/${encodeURIComponent(matchId.trim())}/room`, { method: "POST", json: {} });
      setMatchId(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create the match room."); }
    finally { setBusy(false); }
  };

  const remove = async (room: AdminRoom) => {
    const name = room.match.participants.map((entry) => entry.displayName).join(" vs ") || room.code;
    if (!window.confirm(`Delete the room for ${name}? Its ${room.messageCount} messages and all support requests are removed permanently.`)) return;
    setDeletingId(room.id); setError("");
    try {
      await roomRequest(`/api/v1/admin/matches/${encodeURIComponent(room.match.id)}/room`, { method: "DELETE" });
      setRooms((current) => current.filter((entry) => entry.id !== room.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete the match room."); }
    finally { setDeletingId(""); }
  };

  return <AdminShell title="Match Rooms" description="Profile-linked team chat, support, notifications and embedded map veto. Routine updates stay in-app instead of using email.">
    <Card className="p-5"><h2 className="text-lg text-white">Create or resync a room</h2><p className="mt-1 text-sm text-slate-400">Paste a match ID from the tournament schedule. Matches with two registered participants also receive rooms automatically.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder="Match UUID" className="flex-1" /><Button disabled={busy || !matchId.trim()} onClick={() => void sync()}>{busy ? "Syncing…" : "Create / resync"}</Button></div></Card>
    <Card className="mt-5 p-5"><h2 className="text-lg text-white">Create rooms for a whole tournament</h2><p className="mt-1 text-sm text-slate-400">Creates a room for every upcoming match with two registered teams, and refreshes the members of rooms that already exist. Players are notified about new rooms.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Select aria-label="Tournament" value={tournamentId} onChange={(event) => { setTournamentId(event.target.value); setSummary(null); }} className="flex-1"><option value="">Choose a tournament…</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.title}</option>)}</Select><Button disabled={bulkBusy || !tournamentId} onClick={() => void syncTournament()}>{bulkBusy ? "Creating rooms…" : "Create rooms for all matches"}</Button></div>
      {summary ? <div className="mt-4 border-t border-white/10 pt-4" role="status"><p className="text-sm text-white">{summary.total ? `${summary.created} created · ${summary.updated} already existed · ${summary.skipped.length} skipped, out of ${summary.total} matches.` : "This tournament has no matches yet."}</p>{summary.skipped.length ? <ul className="mt-3 grid gap-1 text-xs text-slate-400">{summary.skipped.map((entry) => <li key={entry.matchId}><span className="text-slate-200">{entry.label}</span> · {entry.teams} — {entry.reason}</li>)}</ul> : null}</div> : null}</Card>
    {error ? <p className="mt-5 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
    <div className="mt-6 grid gap-4 xl:grid-cols-2">{loading ? <Card className="p-8 text-center text-slate-400">Loading match rooms…</Card> : rooms.length ? rooms.map((room) => <Card key={room.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[.18em] text-cyan-200/70">{room.match.tournament.title}</p><h2 className="mt-2 text-xl text-white">{room.match.participants.map((entry) => entry.displayName).join(" vs ")}</h2><p className="mt-2 text-xs text-slate-500">{room.match.identifier} · {room.code}</p></div><Badge>{room.match.status.replaceAll("_", " ")}</Badge></div><div className="mt-4 flex flex-wrap gap-2"><Badge>{room.messageCount} messages</Badge><Badge>{room.openSupportCount} support</Badge><Badge>{room.chatLocked ? "chat locked" : "chat open"}</Badge>{room.match.veto ? <Badge>{room.match.veto.format.toUpperCase()} veto</Badge> : null}</div><div className="mt-5 flex flex-wrap gap-2"><Link href={`/match-room/${room.code}`} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">Open room</Link>{(room.match.tournament.game.toLowerCase() === "valorant" && room.match.participants.length === 2) ? <Link href={room.match.veto ? `/admin/veto-rooms?roomId=${encodeURIComponent(room.match.veto.id)}` : `/admin/veto-rooms?matchId=${encodeURIComponent(room.match.id)}&tournamentId=${encodeURIComponent(room.match.tournament.id)}`} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white">{room.match.veto ? "Open existing veto" : "Start map veto"}</Link> : <span className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-500">Map veto unavailable for this match</span>}{FINISHED_MATCH_STATUSES.includes(room.match.status) ? <Button size="sm" variant="danger" className="ml-auto" disabled={Boolean(deletingId)} onClick={() => void remove(room)}>{deletingId === room.id ? "Deleting…" : "Delete room"}</Button> : null}</div></Card>) : <Card className="p-8 text-center text-slate-400">No match rooms have been created yet.</Card>}</div>
  </AdminShell>;
}
