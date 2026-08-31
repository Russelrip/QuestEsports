"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import VetoRoomView from "@/components/veto/VetoRoomView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveImageUrl } from "@/lib/media";
import { type MatchRoom, type RoomMessage, type SupportRequest, roomRequest } from "@/lib/match-rooms";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { cn, getInitials } from "@/lib/utils";

type Tab = "overview" | "veto" | "chat" | "support";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "veto", label: "Map veto" },
  { id: "chat", label: "Room chat" },
  { id: "support", label: "Support" },
];

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "To be announced";

const MemberAvatar = ({ member }: { member: MatchRoom["members"][number] }) => {
  const avatarUrl = resolveImageUrl(member.user.avatarUrl);
  return (
  <div className="flex items-center gap-3">
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-violet-700 text-xs font-bold text-white">
      {getInitials(member.user.firstName, member.user.lastName, member.user.username)}{avatarUrl ? <Image src={avatarUrl} alt="" width={40} height={40} unoptimized className="absolute h-full w-full object-cover" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied === "true") image.style.display = "none"; else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; } }} /> : null}
    </span>
    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{member.user.username}</span><span className="block text-[10px] uppercase tracking-[.16em] text-slate-500">{member.role}</span></span>
  </div>
  );
};

export default function MatchRoomView({ code }: { code: string }) {
  const [room, setRoom] = useState<MatchRoom | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [support, setSupport] = useState<SupportRequest[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [official, setOfficial] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [replyByRequest, setReplyByRequest] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const roomReady = Boolean(room?.id);

  const loadRoom = useCallback(async () => {
    try {
      setRoom(await roomRequest<MatchRoom>(`/api/v1/match-rooms/${encodeURIComponent(code)}`));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open this match room.");
    }
  }, [code]);
  const loadMessages = useCallback(async () => {
    const data = await roomRequest<{ items: RoomMessage[] }>(`/api/v1/match-rooms/${encodeURIComponent(code)}/messages`);
    setMessages(data.items);
  }, [code]);
  const loadSupport = useCallback(async () => setSupport(await roomRequest<SupportRequest[]>(`/api/v1/match-rooms/${encodeURIComponent(code)}/support`)), [code]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);
  useEffect(() => {
    if (!roomReady) return;
    void Promise.all([loadMessages(), loadSupport()]).catch(() => undefined);
    const closeRealtime = subscribeToRealtimeUpdates(
      `match-room:${code}`,
      () => void Promise.all([loadRoom(), loadMessages(), loadSupport()]).catch(() => undefined),
    );
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void Promise.all([loadRoom(), loadMessages(), loadSupport()]).catch(() => undefined);
    }, 5_000);
    return () => { closeRealtime(); window.clearInterval(poll); };
  }, [code, loadMessages, loadRoom, loadSupport, roomReady]);
  useEffect(() => {
    if (tab !== "chat" || !room) return;
    void roomRequest(`/api/v1/match-rooms/${encodeURIComponent(code)}/read`, { method: "PATCH", json: {} });
  }, [code, room, tab]);

  const teams = useMemo(() => [1, 2].map((slot) => ({
    participant: room?.match.participants.find((entry) => entry.slot === slot),
    members: room?.members.filter((entry) => entry.teamSlot === slot) || [],
  })), [room]);

  const run = async (key: string, action: () => Promise<unknown>, refresh: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await action(); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "The action failed."); } finally { setBusy(""); }
  };

  if (!room) return <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-16"><Card className="p-10 text-center"><div className="mx-auto size-10 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" /><p className="mt-4 text-slate-400">{error || "Opening secure match room…"}</p>{error ? <Link href="/profile" className="mt-5 inline-block text-cyan-200">Return to profile</Link> : null}</Card></main>;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Card className="relative overflow-hidden border-cyan-300/15 bg-[#080a12] p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_15%_0%,rgba(34,211,238,.14),transparent_32%),radial-gradient(circle_at_85%_0%,rgba(139,92,246,.13),transparent_34%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex flex-wrap gap-2"><Badge>{room.match.status.replaceAll("_", " ")}</Badge><Badge>{room.access.role}</Badge><Badge>{room.match.tournament.game}</Badge></div><p className="mt-5 text-xs uppercase tracking-[.22em] text-cyan-200/70">{room.match.tournament.title}</p><h1 className="mt-2 text-3xl text-white sm:text-5xl">{teams[0].participant?.displayName || "Team 1"} <span className="text-slate-600">vs</span> {teams[1].participant?.displayName || "Team 2"}</h1><p className="mt-3 text-sm text-slate-400">{formatDate(room.match.scheduledAt || room.match.estimatedAt)}{room.match.station ? ` · ${room.match.station}` : ""} · Room {room.code}</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => setError("Could not copy the room link on this browser."))}>{copied ? "Link copied" : "Copy room link"}</Button>{room.access.role === "staff" ? <Button variant="secondary" onClick={() => void run("lock", () => roomRequest(`/api/v1/match-rooms/${code}/chat-lock`, { method: "PATCH", json: { locked: !room.chatLocked } }), loadRoom)}>{room.chatLocked ? "Unlock chat" : "Lock chat"}</Button> : null}</div>
        </div>
      </Card>

      <div className="mt-5 flex gap-2 overflow-x-auto border-b border-white/10 pb-3" role="tablist">
        {tabs.map((item) => <button key={item.id} type="button" aria-label={item.id === "veto" ? "Map veto · read-only for broadcast links" : item.label} onClick={() => setTab(item.id)} className={cn("shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition", tab === item.id ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10")}>{item.label}{item.id === "veto" ? <span className="ml-2 text-[10px] uppercase tracking-wider opacity-60">Live view</span> : null}{item.id === "chat" && messages.length ? <span className="ml-2 text-xs opacity-60">{messages.length}</span> : null}</button>)}
      </div>
      {error ? <p className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

      <section className="mt-6">
        {tab === "overview" ? <div className="grid gap-5 lg:grid-cols-2">{teams.map((team, index) => { const participantLogoUrl = resolveImageUrl(team.participant?.logoUrl); return <Card key={index} className="p-6"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.18em] text-slate-500">Team {index + 1}</p><h2 className="mt-2 text-2xl text-white">{team.participant?.displayName || `Team ${index + 1}`}</h2></div>{participantLogoUrl ? <Image src={participantLogoUrl} alt="" width={56} height={56} unoptimized className="size-14 object-contain" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied === "true") image.style.display = "none"; else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; } }} /> : null}</div><div className="mt-5 grid gap-3">{team.members.length ? team.members.map((member) => <div key={member.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[.03] p-3"><MemberAvatar member={member} />{room.access.role === "staff" && member.role !== "staff" ? <Button variant="ghost" size="sm" disabled={busy === `mute-${member.id}`} onClick={() => void run(`mute-${member.id}`, () => roomRequest(`/api/v1/match-rooms/${code}/members/${member.id}/mute`, { method: "PATCH", json: { mutedUntil: member.mutedUntil ? null : new Date(Date.now() + 15 * 60_000).toISOString() } }), loadRoom)}>{member.mutedUntil ? "Unmute" : "Mute 15m"}</Button> : null}</div>) : <p className="text-sm text-slate-500">Roster profiles will appear after invitations are accepted.</p>}</div></Card>; })}</div> : null}

        {tab === "veto" ? room.match.veto ? <VetoRoomView code={room.match.veto.code} /> : <Card className="p-10 text-center"><h2 className="text-2xl text-white">Veto has not been created</h2><p className="mt-2 text-sm text-slate-400">Match staff will select the pool and format before the veto begins.</p></Card> : null}

        {tab === "chat" ? <Card className="p-4 sm:p-6"><div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1" aria-live="polite">{messages.length ? messages.map((entry) => <div key={entry.id} className={cn("rounded-xl border p-3", entry.kind === "staff" ? "border-cyan-300/25 bg-cyan-400/10" : "border-white/8 bg-white/[.025]", entry.hidden && "opacity-60")}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-300">{entry.kind === "staff" ? "Official · " : ""}{entry.sender?.username || "System"}</p><time className="text-[10px] text-slate-600">{formatDate(entry.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-100">{entry.body}</p>{room.access.role === "staff" && !entry.hidden ? <button type="button" className="mt-2 text-xs text-rose-200" onClick={() => void run(`hide-${entry.id}`, () => roomRequest(`/api/v1/match-rooms/${code}/messages/${entry.id}/hide`, { method: "POST", json: { reason: "Hidden by match staff" } }), loadMessages)}>Hide message</button> : null}</div>) : <p className="py-16 text-center text-sm text-slate-500">No messages yet. Use this room for match coordination.</p>}</div><form className="mt-5 border-t border-white/8 pt-5" onSubmit={(event) => { event.preventDefault(); if (!message.trim()) return; void run("send", () => roomRequest(`/api/v1/match-rooms/${code}/messages`, { method: "POST", json: { body: message, official } }), async () => { setMessage(""); await loadMessages(); }); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} disabled={room.chatLocked} placeholder={room.chatLocked ? "Chat is read-only" : "Message the match room"} className="min-h-24 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none focus:border-cyan-300/50" />{room.access.role === "staff" ? <label className="mt-2 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={official} onChange={(event) => setOfficial(event.target.checked)} /> Send as an official announcement</label> : null}<div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">{message.length}/1000</span><Button type="submit" disabled={room.chatLocked || busy === "send"}>{busy === "send" ? "Sending…" : "Send"}</Button></div></form></Card> : null}

        {tab === "support" ? <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><Card className="p-5"><h2 className="text-xl text-white">Contact match staff</h2><p className="mt-2 text-sm text-slate-400">Use this for server, roster, rule, or veto issues. It does not send email.</p><form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); void run("support-open", () => roomRequest(`/api/v1/match-rooms/${code}/support`, { method: "POST", json: { subject: supportSubject, body: supportBody } }), async () => { setSupportSubject(""); setSupportBody(""); await loadSupport(); }); }}><input value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)} maxLength={160} required placeholder="Short subject" className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white" /><textarea value={supportBody} onChange={(event) => setSupportBody(event.target.value)} maxLength={2000} required placeholder="Describe the issue" className="min-h-32 rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white" /><Button type="submit" disabled={busy === "support-open"}>Open support request</Button></form></Card><div className="grid gap-4">{support.length ? support.map((request) => <Card key={request.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><Badge>{request.status}</Badge><h3 className="mt-2 text-lg text-white">{request.subject}</h3><p className="text-xs text-slate-500">Opened by {request.openedBy.username}</p></div>{room.access.role === "staff" && request.status === "open" ? <Button variant="secondary" size="sm" onClick={() => void run(`resolve-${request.id}`, () => roomRequest(`/api/v1/match-rooms/${code}/support/${request.id}/resolve`, { method: "POST", json: {} }), loadSupport)}>Resolve</Button> : null}</div><div className="mt-4 grid gap-2">{request.messages.map((entry) => <div key={entry.id} className="rounded-xl bg-white/[.04] p-3"><p className="text-xs font-semibold text-cyan-100">{entry.sender.username}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{entry.body}</p></div>)}</div>{request.status === "open" ? <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); const value = replyByRequest[request.id]?.trim(); if (!value) return; void run(`reply-${request.id}`, () => roomRequest(`/api/v1/match-rooms/${code}/support/${request.id}/messages`, { method: "POST", json: { body: value } }), async () => { setReplyByRequest((current) => ({ ...current, [request.id]: "" })); await loadSupport(); }); }}><input value={replyByRequest[request.id] || ""} onChange={(event) => setReplyByRequest((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} placeholder="Reply" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white" /><Button type="submit">Send</Button></form> : null}</Card>) : <Card className="p-8 text-center text-sm text-slate-500">No support requests for this room.</Card>}</div></div> : null}
      </section>
    </main>
  );
}
