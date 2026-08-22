"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToastStore } from "@/hooks/useToastStore";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { createSupportConversation, getSupportConversation, listSupportConversations, markSupportConversationRead, type SupportConversation, type SupportConversationSummary } from "@/lib/support";
import SupportConversationList from "./SupportConversationList";
import SupportComposer from "./SupportComposer";
import SupportThread from "./SupportThread";

const SUPPORT_POLL_INTERVAL_MS = 30_000;
type RequestContext = { key: string; generation: number; userId: string | null; conversationId?: string };

export default function SupportInbox({ conversationId }: { conversationId?: string }) {
  const { user, isLoading: authLoading } = useAuth();
  if (authLoading) return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-10 text-center text-sm text-slate-400">Checking your account…</div>;
  if (!user) return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-10 text-center"><h2 className="text-xl text-white">Sign in to contact support</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Your conversations stay private and available whenever you return.</p><Link href="/login?redirect=%2Fsupport" className="mt-5 inline-flex h-10 items-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950">Sign in to continue</Link></div>;
  return <SupportInboxForUser key={user.id} conversationId={conversationId} userId={user.id} />;
}

function SupportInboxForUser({ conversationId, userId }: { conversationId?: string; userId: string }) {
  const showToast = useToastStore((state) => state.showToast);
  const [items, setItems] = useState<SupportConversationSummary[]>([]); const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [listLoading, setListLoading] = useState(true); const [threadLoading, setThreadLoading] = useState(Boolean(conversationId));
  const [listError, setListError] = useState<string | null>(null); const [threadError, setThreadError] = useState<string | null>(null); const [readError, setReadError] = useState<string | null>(null); const [createError, setCreateError] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const listContextRef = useRef<RequestContext>({ key: userId, generation: 0, userId });
  const threadContextKey = `${userId}|${conversationId ?? ""}`;
  const threadContextRef = useRef<RequestContext>({ key: threadContextKey, generation: 0, userId, conversationId });
  if (threadContextRef.current.key !== threadContextKey) threadContextRef.current = { key: threadContextKey, generation: threadContextRef.current.generation + 1, userId, conversationId };
  const listInFlight = useRef<RequestContext | null>(null);
  const threadInFlight = useRef<RequestContext | null>(null);
  const loadList = useCallback(async () => { const requestContext = listContextRef.current; if (!requestContext.userId || listInFlight.current?.generation === requestContext.generation) return; listInFlight.current = requestContext; try { const result = await listSupportConversations(); if (listContextRef.current.generation !== requestContext.generation) return; setItems(result.items); setListError(null); } catch (error) { if (listContextRef.current.generation !== requestContext.generation) return; setListError(error instanceof Error ? error.message : "Inbox could not be loaded."); } finally { if (listInFlight.current === requestContext) { listInFlight.current = null; if (listContextRef.current.generation === requestContext.generation) setListLoading(false); } } }, []);
  const loadThread = useCallback(async () => { const requestContext = threadContextRef.current; if (!conversationId || requestContext.conversationId !== conversationId || threadInFlight.current?.generation === requestContext.generation) return; threadInFlight.current = requestContext; setThreadLoading(true); setThreadError(null); setReadError(null); try { const result = await getSupportConversation(conversationId); if (threadContextRef.current.generation !== requestContext.generation) return; setConversation(result); try { await markSupportConversationRead(conversationId); if (threadContextRef.current.generation === requestContext.generation) await loadList(); } catch (error) { if (threadContextRef.current.generation === requestContext.generation) setReadError(error instanceof Error ? error.message : "Read status could not be saved."); } } catch (error) { if (threadContextRef.current.generation !== requestContext.generation) return; setConversation(null); setThreadError(error instanceof Error ? error.message : "Conversation could not be loaded."); } finally { if (threadInFlight.current === requestContext) { threadInFlight.current = null; if (threadContextRef.current.generation === requestContext.generation) setThreadLoading(false); } } }, [conversationId, loadList]);
  useEffect(() => { setConversation(null); setThreadError(null); setReadError(null); setThreadLoading(Boolean(conversationId)); }, [conversationId]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (conversationId) void loadThread(); }, [conversationId, loadThread]);
  useEffect(() => { const close = subscribeToRealtimeUpdates(`user:${userId}`, () => { void loadList(); if (conversationId) void loadThread(); }); return close; }, [userId, conversationId, loadList, loadThread]);
  useEffect(() => { const interval = window.setInterval(() => { void loadList(); if (conversationId) void loadThread(); }, SUPPORT_POLL_INTERVAL_MS); return () => window.clearInterval(interval); }, [conversationId, loadList, loadThread]);
  const create = async ({ subject, body }: { subject: string; body: string }) => { setCreating(true); setCreateError(null); try { const next = await createSupportConversation(subject, body); showToast({ title: "Message sent", description: "Your support conversation is ready.", tone: "success" }); await loadList(); window.history.pushState({}, "", `/support/${next.id}`); setConversation(next); return true; } catch (error) { setCreateError(error instanceof Error ? error.message : "Message could not be sent. Try again."); return false; } finally { setCreating(false); } };
  if (listLoading && !items.length) return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-10 text-center text-sm text-slate-400">Loading your conversations…</div>;
  return <div className="grid gap-4 lg:grid-cols-[19rem_1fr]"><aside className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d0c13]"><div className="border-b border-white/8 px-4 py-5"><p className="text-xs uppercase tracking-[.25em] text-slate-500">Your inbox</p><h2 className="mt-2 text-xl text-white">Support conversations</h2></div>{listError && !items.length ? <div className="p-4 text-sm text-red-100"><p>{listError}</p><button className="mt-3 text-cyan-200 underline" onClick={() => { setListLoading(true); void loadList(); }}>Try again</button></div> : items.length ? <SupportConversationList items={items} selectedId={conversationId} /> : <div className="p-5 text-sm leading-6 text-slate-400">No conversations yet. Start a message and the Quest team will pick it up.</div>}</aside><main className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0c13]">{conversationId && threadLoading ? <div className="p-10 text-center text-sm text-slate-400">Loading this conversation…</div> : threadError ? <div className="p-8 text-center"><p role="alert" className="text-sm text-red-100">{threadError}</p><button className="mt-4 text-sm text-cyan-200 underline" onClick={() => void loadThread()}>Try again</button></div> : conversation ? <SupportThread conversation={conversation} currentUserId={userId} readError={readError} onChanged={() => void loadList()} /> : <div className="p-5 sm:p-8"><p className="text-xs uppercase tracking-[.25em] text-cyan-200">Need a hand?</p><h2 className="mt-3 text-3xl text-white">Start a support conversation</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">Share the details once. Keep the thread open for updates from Quest Support.</p>{readError ? <p role="alert" className="mt-4 text-sm text-red-200">{readError}</p> : null}<div className="mt-7 max-w-2xl"><SupportComposer busy={creating} error={createError} onSubmit={create} /></div></div>}</main></div>;
}
