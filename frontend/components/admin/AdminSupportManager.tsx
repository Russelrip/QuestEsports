"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AdminShell from "@/components/admin/AdminShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { assignSupportConversation, getAdminSupportConversation, listAdminSupportConversations, markAdminSupportConversationRead, type SupportConversation, type SupportConversationSummary, type SupportQueueFilters as AdminQueueFilters, type SupportStatus } from "@/lib/support";
import SupportQueueFilters from "./support/SupportQueueFilters";
import AdminSupportThread from "./support/AdminSupportThread";

const labels: Record<SupportStatus, string> = { OPEN: "Open", PENDING_USER: "Awaiting player", PENDING_STAFF: "Needs staff reply", RESOLVED: "Resolved" };
const name = (user: SupportConversationSummary["owner"]) => user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Player" : "Player";
const date = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));

export default function AdminSupportManager() {
  const { user, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const queryConversationId = searchParams.get("conversationId");
  const [filters, setFilters] = useState<AdminQueueFilters>({ assigned: "all" });
  const [items, setItems] = useState<SupportConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SupportConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const queueGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const openedQueryConversationRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const generation = ++queueGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminSupportConversations(filters);
      if (generation !== queueGeneration.current) return;
      setItems(result.items);
    } catch (nextError) {
      if (generation !== queueGeneration.current) return;
      setError(nextError instanceof Error ? nextError.message : "Support queue could not be loaded.");
    } finally {
      if (generation === queueGeneration.current) setLoading(false);
    }
  }, [filters]);

  const loadThread = useCallback(async (id: string) => {
    const generation = ++detailGeneration.current;
    setSelectedId(id);
    selectedIdRef.current = id;
    setSelected(null);
    setThreadLoading(true);
    setThreadError(null);
    setReadError(null);
    try {
      const result = await getAdminSupportConversation(id);
      if (generation !== detailGeneration.current) return;
      setSelected(result);
      setThreadLoading(false);
      void (async () => {
        try {
          await markAdminSupportConversationRead(id);
          if (generation !== detailGeneration.current) return;
          setReadError(null);
          setSelected((current) => current ? { ...current, unreadCount: 0 } : current);
          void load();
        } catch (nextError) {
          if (generation === detailGeneration.current) setReadError(nextError instanceof Error ? nextError.message : "Read status could not be saved.");
        }
      })();
    } catch (nextError) {
      if (generation !== detailGeneration.current) return;
      setThreadError(nextError instanceof Error ? nextError.message : "Conversation could not be loaded.");
    } finally {
      if (generation === detailGeneration.current) setThreadLoading(false);
    }
  }, [load]);

  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, user, load]);

  useEffect(() => {
    if (authLoading || loading || !queryConversationId || openedQueryConversationRef.current === queryConversationId) return;
    openedQueryConversationRef.current = queryConversationId;
    void loadThread(queryConversationId);
  }, [authLoading, loading, queryConversationId, loadThread]);

  const refresh = (targetId: string) => {
    if (selectedIdRef.current !== targetId) return;
    void load();
    if (selectedIdRef.current === targetId) void loadThread(targetId);
  };

  const assign = async (id: string | null) => {
    const targetId = selectedIdRef.current;
    if (!targetId) return;
    setAssignmentBusy(true);
    try {
      const result = await assignSupportConversation(targetId, id);
      if (selectedIdRef.current !== targetId) return;
      setSelected(result);
      await load();
    } finally {
      setAssignmentBusy(false);
    }
  };

  if (authLoading) return <AdminShell title="Support queue" description="Private conversations between players and Quest staff."><Card className="p-10 text-center text-sm text-slate-400">Checking staff access…</Card></AdminShell>;

  return <AdminShell title="Support queue" description="Keep player conversations moving: claim a thread, reply with context, and close the loop."><div className="grid gap-4 xl:grid-cols-[minmax(20rem,.8fr)_minmax(0,1.4fr)]"><Card className="min-w-0 overflow-hidden"><div className="border-b border-white/8 p-5 sm:p-6"><div className="flex items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[.25em] text-cyan-200/70">Inbox</p><h2 className="mt-2 text-xl text-white">Player conversations</h2></div><span className="text-xs text-slate-500">{items.length} shown</span></div><div className="mt-5"><SupportQueueFilters value={filters} onChange={(next) => { detailGeneration.current += 1; selectedIdRef.current = null; setFilters(next); setSelectedId(null); setSelected(null); setThreadLoading(false); setThreadError(null); setReadError(null); }} /></div></div>{loading ? <div role="status" aria-label="Loading support queue"><AdminTableSkeleton /></div> : error ? <div className="p-7 text-center"><p role="alert" className="text-sm text-red-100">{error}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => void load()}>Try again</Button></div> : items.length === 0 ? <div className="p-8 text-center"><p className="text-lg text-white">Queue is clear</p><p className="mt-2 text-sm leading-6 text-slate-500">No conversations match these filters. Try widening the search or assignment view.</p></div> : <div className="divide-y divide-white/8">{items.map((item) => <button type="button" key={item.id} onClick={() => void loadThread(item.id)} className={`block w-full p-5 text-left transition hover:bg-white/[.04] ${selectedId === item.id ? "border-l-2 border-cyan-300 bg-white/[.05]" : "border-l-2 border-transparent"}`}><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 truncate text-sm font-semibold text-white">{item.subject}</h3><time className="shrink-0 text-[11px] text-slate-500">{date(item.updatedAt)}</time></div><p className="mt-2 text-xs text-slate-400">{name(item.owner)} {item.assignedStaff ? `· ${name(item.assignedStaff)}` : "· Unassigned"}</p><div className="mt-3 flex items-center gap-2"><Badge>{labels[item.status]}</Badge>{item.unreadCount ? <span className="rounded-full bg-cyan-300 px-1.5 text-[10px] font-bold text-slate-950">{item.unreadCount}</span> : null}</div><p className="mt-3 truncate text-xs leading-5 text-slate-500">{item.preview || "No messages yet."}</p></button>)}</div>}</Card><Card className="min-w-0 overflow-hidden">{threadLoading ? <div role="status" aria-label="Loading support conversation" className="p-10 text-center text-sm text-slate-400">Loading conversation…</div> : threadError ? <div className="p-10 text-center"><p role="alert" className="text-sm text-red-100">{threadError}</p><Button className="mt-4" variant="secondary" size="sm" onClick={() => selectedId && void loadThread(selectedId)}>Try again</Button></div> : selected && user ? <AdminSupportThread conversation={selected} currentUserId={user.id} readError={readError} onChanged={refresh} onAssign={assign} busy={assignmentBusy} /> : <div className="flex min-h-[38rem] items-center justify-center p-10 text-center"><div><p className="text-xs uppercase tracking-[.25em] text-cyan-200/70">Select a conversation</p><h2 className="mt-3 text-2xl text-white">Your next reply starts here</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">Choose a player conversation from the queue to read the full thread and take action.</p></div></div>}</Card></div></AdminShell>;
}
