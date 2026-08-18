"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { SupportConversation, SupportStatus } from "@/lib/support";
import { sendAdminSupportMessage, updateAdminSupportStatus } from "@/lib/support";
import SupportAssignmentControl from "./SupportAssignmentControl";

const labels: Record<SupportStatus, string> = { OPEN: "Open", PENDING_USER: "Awaiting player", PENDING_STAFF: "Needs staff reply", RESOLVED: "Resolved" };
const format = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const person = (user: SupportConversation["owner"]) => user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Player" : "Player";

export default function AdminSupportThread({ conversation: initial, currentUserId, onChanged, onAssign, busy: externalBusy = false }: { conversation: SupportConversation; currentUserId: string; onChanged: () => void; onAssign: (id: string | null) => Promise<void>; busy?: boolean }) {
  const [conversation, setConversation] = useState(initial); const [body, setBody] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => setConversation(initial), [initial]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "That update could not be saved. Try again."); } finally { setBusy(false); } };
  const send = async (event: React.FormEvent) => { event.preventDefault(); if (!body.trim()) { setError("Reply message is required."); return; } await run(async () => { const result = await sendAdminSupportMessage(conversation.id, body.trim()); setConversation((current) => ({ ...current, status: result.status, messages: [...current.messages, result.message] })); setBody(""); onChanged(); }); };
  const changeStatus = () => void run(async () => { const next = await updateAdminSupportStatus(conversation.id, conversation.status === "RESOLVED" ? "OPEN" : "RESOLVED"); setConversation(next); onChanged(); });
  return <div className="flex min-h-[38rem] flex-col">
    <header className="border-b border-white/8 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs uppercase tracking-[.25em] text-cyan-200/70">Private support thread</p><h2 className="mt-2 break-words text-2xl text-white">{conversation.subject}</h2><p className="mt-2 text-sm text-slate-500">{person(conversation.owner)} · opened {format(conversation.createdAt)}</p></div><div className="flex flex-wrap items-center gap-2"><Badge>{labels[conversation.status]}</Badge><Button size="sm" variant={conversation.status === "RESOLVED" ? "secondary" : "ghost"} disabled={busy || externalBusy} onClick={changeStatus}>{conversation.status === "RESOLVED" ? "Reopen" : "Resolve"}</Button></div></div><div className="mt-5 max-w-sm"><SupportAssignmentControl conversation={conversation} currentUserId={currentUserId} busy={busy || externalBusy} onChange={(id) => void run(() => onAssign(id))} /></div></header>
    <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">{conversation.messages.map((message) => { const mine = message.senderUserId === currentUserId; return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${mine ? "rounded-br-sm bg-cyan-300 text-slate-950" : "rounded-bl-sm border border-white/10 bg-white/[.05] text-slate-200"}`}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p><time className={`mt-2 block text-[11px] ${mine ? "text-slate-800/70" : "text-slate-500"}`}>{mine ? "You" : message.sender ? person(message.sender) : "Quest Support"} · {format(message.createdAt)}</time></div></div>; })}</div>
    <form onSubmit={send} className="border-t border-white/8 p-5 sm:p-7"><label htmlFor="admin-support-reply" className="text-sm font-semibold text-white">Reply to {person(conversation.owner)}</label><Textarea id="admin-support-reply" value={body} onChange={(event) => setBody(event.target.value)} disabled={busy || externalBusy} maxLength={2000} rows={4} className="mt-3" placeholder="Write a clear, helpful reply…" />{error ? <p role="alert" className="mt-3 text-sm text-red-100">{error}</p> : null}<div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Up to 2,000 characters</span><Button type="submit" disabled={busy || externalBusy || !body.trim()}>{busy ? "Sending…" : "Send reply"}</Button></div></form>
  </div>;
}
