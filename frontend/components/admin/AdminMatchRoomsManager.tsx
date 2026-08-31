"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export default function AdminMatchRoomsManager() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [matchId, setMatchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRooms(await roomRequest<AdminRoom[]>("/api/v1/admin/match-rooms")); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load match rooms."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    if (!matchId.trim()) return;
    setBusy(true); setError("");
    try {
      await roomRequest(`/api/v1/admin/matches/${encodeURIComponent(matchId.trim())}/room`, { method: "POST", json: {} });
      setMatchId(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create the match room."); }
    finally { setBusy(false); }
  };

  return <AdminShell title="Match Rooms" description="Profile-linked team chat, support, notifications and embedded map veto. Routine updates stay in-app instead of using email.">
    <Card className="p-5"><h2 className="text-lg text-white">Create or resync a room</h2><p className="mt-1 text-sm text-slate-400">Paste a match ID from the tournament schedule. Matches with two registered participants also receive rooms automatically.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder="Match UUID" className="flex-1" /><Button disabled={busy || !matchId.trim()} onClick={() => void sync()}>{busy ? "Syncing…" : "Create / resync"}</Button></div></Card>
    {error ? <p className="mt-5 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
    <div className="mt-6 grid gap-4 xl:grid-cols-2">{loading ? <Card className="p-8 text-center text-slate-400">Loading match rooms…</Card> : rooms.length ? rooms.map((room) => <Card key={room.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[.18em] text-cyan-200/70">{room.match.tournament.title}</p><h2 className="mt-2 text-xl text-white">{room.match.participants.map((entry) => entry.displayName).join(" vs ")}</h2><p className="mt-2 text-xs text-slate-500">{room.match.identifier} · {room.code}</p></div><Badge>{room.match.status.replaceAll("_", " ")}</Badge></div><div className="mt-4 flex flex-wrap gap-2"><Badge>{room.messageCount} messages</Badge><Badge>{room.openSupportCount} support</Badge><Badge>{room.chatLocked ? "chat locked" : "chat open"}</Badge>{room.match.veto ? <Badge>{room.match.veto.format.toUpperCase()} veto</Badge> : null}</div><div className="mt-5 flex gap-2"><Link href={`/match-room/${room.code}`} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">Open room</Link><Link href={room.match.veto ? `/admin/veto-rooms?roomId=${encodeURIComponent(room.match.veto.id)}` : `/admin/veto-rooms?matchId=${encodeURIComponent(room.match.id)}&tournamentId=${encodeURIComponent(room.match.tournament.id)}`} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white">{room.match.veto ? "Open existing veto" : "Start map veto"}</Link></div></Card>) : <Card className="p-8 text-center text-slate-400">No match rooms have been created yet.</Card>}</div>
  </AdminShell>;
}
