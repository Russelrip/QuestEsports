"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToastStore } from "@/hooks/useToastStore";
import type { SupportConversation, SupportStatus } from "@/lib/support";
import { archiveAdminSupportConversation, deleteAdminSupportConversation, sendAdminSupportMessage, updateAdminSupportStatus } from "@/lib/support";
import SupportAssignmentControl from "./SupportAssignmentControl";
import SupportAttachmentPicker from "@/components/support/SupportAttachmentPicker";
import SupportAttachments from "@/components/support/SupportAttachments";

const labels: Record<SupportStatus, string> = { OPEN: "Open", PENDING_USER: "Awaiting player", PENDING_STAFF: "Needs staff reply", RESOLVED: "Resolved" };
const format = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const person = (user: SupportConversation["owner"]) => user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Player" : "Player";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "That update could not be saved. Try again.";

export default function AdminSupportThread({ conversation: initial, currentUserId, onChanged, onAssign, onDeleted, readError, busy: externalBusy = false }: { conversation: SupportConversation; currentUserId: string; onChanged: (conversationId: string) => void; onAssign: (id: string | null) => Promise<void>; onDeleted: (conversationId: string) => void; readError?: string | null; busy?: boolean }) {
  const [conversation, setConversation] = useState(initial);
  const [body, setBody] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const showToast = useToastStore((state) => state.showToast);
  useEffect(() => setConversation(initial), [initial]);
  const disabled = busy || externalBusy;
  const archived = Boolean(conversation.archivedAt);

  const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); return true; } catch (nextError) { setError(errorMessage(nextError)); return false; } finally { setBusy(false); } };

  const send = async (resolveAfter: boolean) => {
    if (!body.trim()) { setError("Reply message is required."); return; }
    await run(async () => {
      const result = await (screenshots.length ? sendAdminSupportMessage(conversation.id, body.trim(), screenshots) : sendAdminSupportMessage(conversation.id, body.trim()));
      setConversation((current) => ({ ...current, status: result.status, messages: [...current.messages, result.message] }));
      setBody("");
      setScreenshots([]);
      if (resolveAfter) setConversation(await updateAdminSupportStatus(conversation.id, "RESOLVED"));
      showToast({ tone: "success", title: resolveAfter ? "Reply sent and resolved" : "Reply sent" });
      onChanged(conversation.id);
    });
  };

  const changeStatus = (status: SupportStatus) => void run(async () => {
    setConversation(await updateAdminSupportStatus(conversation.id, status));
    showToast({ tone: "success", title: `Marked ${labels[status].toLowerCase()}` });
    onChanged(conversation.id);
  });

  const toggleArchive = () => void run(async () => {
    setConversation(await archiveAdminSupportConversation(conversation.id, !archived));
    showToast({ tone: "success", title: archived ? "Moved back to the inbox" : "Conversation archived", description: archived ? undefined : "A reply from the player brings it back." });
    onChanged(conversation.id);
  });

  const remove = async () => {
    const removed = await run(async () => { await deleteAdminSupportConversation(conversation.id); });
    setConfirmingDelete(false);
    if (!removed) return;
    showToast({ tone: "success", title: "Conversation deleted" });
    onDeleted(conversation.id);
  };

  const actions: MenuItem[] = [
    { label: archived ? "Move to inbox" : "Archive", onSelect: toggleArchive },
    { label: "Delete permanently…", tone: "danger", separatorBefore: true, onSelect: () => setConfirmingDelete(true) },
  ];

  return <div className="flex min-h-[38rem] flex-col">
    <header className="border-b border-white/8 p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-xs uppercase tracking-[.25em] text-cyan-200/70">Private support thread</p><h2 className="mt-2 break-words text-2xl text-white">{conversation.subject}</h2><p className="mt-2 text-sm text-slate-500">{person(conversation.owner)} · opened {format(conversation.createdAt)}</p></div>
        <Menu label="More actions" items={actions} disabled={disabled}><span aria-hidden="true" className="text-lg leading-none">⋯</span></Menu>
      </div>
      {archived ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-sm text-amber-100"><span>Archived {format(conversation.archivedAt as string)}. Hidden from the inbox; the player still sees it.</span><Button size="sm" variant="ghost" disabled={disabled} onClick={toggleArchive}>Move to inbox</Button></div> : null}
      {readError ? <p role="alert" className="mt-3 text-sm text-amber-200">{readError}</p> : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2"><label htmlFor="support-status" className="text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Status</label><Select id="support-status" aria-label="Conversation status" disabled={disabled} value={conversation.status} onChange={(event) => changeStatus(event.target.value as SupportStatus)}>{(Object.keys(labels) as SupportStatus[]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}</Select></div>
        <SupportAssignmentControl conversation={conversation} currentUserId={currentUserId} busy={disabled} onChange={(id) => void run(async () => { await onAssign(id); showToast({ tone: "success", title: id ? (id === currentUserId ? "Assigned to you" : "Assigned") : "Unassigned" }); })} />
      </div>
    </header>
    <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">{conversation.messages.map((message) => { const mine = message.senderUserId === currentUserId; return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${mine ? "rounded-br-sm bg-cyan-300 text-slate-950" : "rounded-bl-sm border border-white/10 bg-white/[.05] text-slate-200"}`}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p><SupportAttachments attachments={message.attachments} /><time className={`mt-2 block text-[11px] ${mine ? "text-slate-800/70" : "text-slate-500"}`}>{mine ? "You" : message.sender ? person(message.sender) : "Quest Support"} · {format(message.createdAt)}</time></div></div>; })}</div>
    <form onSubmit={(event) => { event.preventDefault(); void send(false); }} className="border-t border-white/8 p-5 sm:p-7">
      <label htmlFor="admin-support-reply" className="text-sm font-semibold text-white">Reply to {person(conversation.owner)}</label>
      <Textarea id="admin-support-reply" value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(false); } }} disabled={disabled} maxLength={2000} rows={4} className="mt-3" placeholder="Write a clear, helpful reply…" />
      <div className="mt-3"><SupportAttachmentPicker files={screenshots} onChange={setScreenshots} disabled={disabled} /></div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-100">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">{body.length}/2,000 · Ctrl+Enter to send</span><div className="flex gap-2"><Button type="button" variant="ghost" disabled={disabled || !body.trim()} onClick={() => void send(true)}>Send & resolve</Button><Button type="submit" disabled={disabled || !body.trim()}>{busy ? "Sending…" : "Send reply"}</Button></div></div>
    </form>
    <ConfirmDialog open={confirmingDelete} busy={busy} title="Delete this conversation?" confirmLabel="Delete permanently" onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} description={<><p>&ldquo;{conversation.subject}&rdquo; and all of its messages and screenshots will be removed for staff and for {person(conversation.owner)}. This cannot be undone.</p><p className="mt-2">To clear it from the queue but keep it, archive it instead.</p></>} />
  </div>;
}
