"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { createSupportConversation, getSupportConversation, listSupportConversations, markSupportConversationRead, type SupportConversation, type SupportConversationSummary } from "@/lib/support";
import SupportConversationList from "./SupportConversationList";
import SupportComposer from "./SupportComposer";
import SupportThread from "./SupportThread";
import { notifySupportRead } from "./SupportProvider";

const SUPPORT_POLL_INTERVAL_MS = 30_000;
type RequestContext = { key: string; generation: number; userId: string | null; conversationId?: string };
type CreateRequestContext = { userId: string; generation: number };

export default function SupportInbox({ conversationId, composing = false, sent = false }: { conversationId?: string; composing?: boolean; sent?: boolean }) {
  const { user, isLoading: authLoading } = useAuth();
  if (authLoading) return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-10 text-center text-sm text-slate-400">Checking your account…</div>;
  if (!user) return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-10 text-center"><h2 className="text-xl text-white">Sign in to contact support</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Your conversations stay private and available whenever you return.</p><Link href={`/login?redirect=${encodeURIComponent(conversationId ? `/support/${conversationId}` : composing ? "/support/new" : "/support")}`} className="mt-5 inline-flex h-10 items-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950! hover:text-slate-950! focus-visible:text-slate-950!">Sign in to continue</Link></div>;
  return <SupportInboxForUser key={user.id} conversationId={conversationId} userId={user.id} composing={composing} sent={sent} />;
}

function SupportInboxForUser({ conversationId, userId, composing, sent }: { conversationId?: string; userId: string; composing: boolean; sent: boolean }) {
  const router = useRouter();
  const composerHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (composing) composerHeading.current?.focus(); }, [composing]);
  const [items, setItems] = useState<SupportConversationSummary[]>([]); const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [listLoading, setListLoading] = useState(true); const [threadLoading, setThreadLoading] = useState(Boolean(conversationId));
  const [listError, setListError] = useState<string | null>(null); const [threadError, setThreadError] = useState<string | null>(null); const [readError, setReadError] = useState<string | null>(null); const [createError, setCreateError] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const listContextRef = useRef<RequestContext>({ key: userId, generation: 0, userId });
  const threadContextKey = `${userId}|${conversationId ?? ""}`;
  const threadContextRef = useRef<RequestContext>({ key: threadContextKey, generation: 0, userId, conversationId });
  const listRefreshQueued = useRef<RequestContext | null>(null);
  const threadRefreshQueued = useRef<RequestContext | null>(null);
  const createGenerationRef = useRef(0);
  const createUserIdRef = useRef(userId);
  const createRequestRef = useRef<CreateRequestContext | null>(null);
  const mountedRef = useRef(false);
  if (createUserIdRef.current !== userId) {
    createUserIdRef.current = userId;
    createGenerationRef.current += 1;
    createRequestRef.current = null;
  }
  if (threadContextRef.current.key !== threadContextKey) {
    threadContextRef.current = { key: threadContextKey, generation: threadContextRef.current.generation + 1, userId, conversationId };
    threadRefreshQueued.current = null;
  }
  const listInFlight = useRef<RequestContext | null>(null);
  const threadInFlight = useRef<RequestContext | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      createGenerationRef.current += 1;
      createRequestRef.current = null;
      listRefreshQueued.current = null;
      threadRefreshQueued.current = null;
    };
  }, []);
  const loadList = useCallback(async () => { const requestContext = listContextRef.current; if (!requestContext.userId) return; if (listInFlight.current?.generation === requestContext.generation) { listRefreshQueued.current = requestContext; return; } listInFlight.current = requestContext; try { const result = await listSupportConversations();
      let cursor = result.nextCursor;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor) && mountedRef.current) {
        visited.add(cursor);
        const page = await listSupportConversations(cursor);
        result.items = [...new Map([...result.items, ...page.items].map((item) => [item.id, item])).values()];
        cursor = page.nextCursor;
      } if (!mountedRef.current || listContextRef.current.generation !== requestContext.generation) return; setItems(result.items); setListError(null); } catch (error) { if (!mountedRef.current || listContextRef.current.generation !== requestContext.generation) return; setListError(error instanceof Error ? error.message : "Inbox could not be loaded."); } finally { if (listInFlight.current === requestContext) { listInFlight.current = null; const refreshQueued = listRefreshQueued.current === requestContext; listRefreshQueued.current = null; if (listContextRef.current.generation === requestContext.generation) { if (refreshQueued) void loadList(); else setListLoading(false); } } } }, []);
  const loadThread = useCallback(async () => { const requestContext = threadContextRef.current; if (!conversationId || requestContext.conversationId !== conversationId) return; if (threadInFlight.current?.generation === requestContext.generation) { threadRefreshQueued.current = requestContext; return; } threadInFlight.current = requestContext; setThreadError(null); try { const result = await getSupportConversation(conversationId); if (!mountedRef.current || threadContextRef.current.generation !== requestContext.generation) return; setConversation(result); } catch (error) { if (!mountedRef.current || threadContextRef.current.generation !== requestContext.generation) return; setThreadError(error instanceof Error ? error.message : "Conversation could not be loaded."); } finally { if (threadInFlight.current === requestContext) { threadInFlight.current = null; const refreshQueued = threadRefreshQueued.current === requestContext; threadRefreshQueued.current = null; if (threadContextRef.current.generation === requestContext.generation) { if (refreshQueued) void loadThread(); else setThreadLoading(false); } } } }, [conversationId]);
  useEffect(() => { setConversation(null); setThreadError(null); setReadError(null); setThreadLoading(Boolean(conversationId)); }, [conversationId]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (conversationId) void loadThread(); }, [conversationId, loadThread]);
  useEffect(() => { const close = subscribeToRealtimeUpdates(`user:${userId}`, () => { void loadList(); if (conversationId) void loadThread(); }); return close; }, [userId, conversationId, loadList, loadThread]);
  useEffect(() => { const refresh = () => { if (document.visibilityState !== "hidden") { void loadList(); if (conversationId) void loadThread(); } }; const interval = window.setInterval(refresh, SUPPORT_POLL_INTERVAL_MS); document.addEventListener("visibilitychange", refresh); return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); }; }, [conversationId, loadList, loadThread]);
  const lastMessageId = conversation && conversation.id === conversationId ? conversation.messages.at(-1)?.id : undefined;
  useEffect(() => {
    if (!conversationId || !lastMessageId) return;
    let active = true;
    let acknowledged = false;
    let pending = false;
    const acknowledge = async () => {
      if (document.visibilityState === "hidden" || acknowledged || pending) return;
      pending = true;
      try {
        await markSupportConversationRead(conversationId, lastMessageId);
        if (active) { acknowledged = true; setReadError(null); notifySupportRead(); void loadList(); }
      } catch { if (active) setReadError("Your conversation loaded, but we couldn't update its read status. We'll retry automatically."); }
      finally { pending = false; }
    };
    void acknowledge();
    document.addEventListener("visibilitychange", acknowledge);
    const interval = window.setInterval(() => void acknowledge(), SUPPORT_POLL_INTERVAL_MS);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", acknowledge); };
  }, [conversationId, lastMessageId, loadList]);
  const create = async ({ subject, body, screenshots }: { subject: string; body: string; screenshots: File[] }) => {
    const requestContext: CreateRequestContext = { userId, generation: createGenerationRef.current + 1 };
    createGenerationRef.current = requestContext.generation;
    createRequestRef.current = requestContext;
    const isCurrentRequest = () => mountedRef.current && createUserIdRef.current === requestContext.userId && createRequestRef.current === requestContext;
    setCreating(true);
    setCreateError(null);
    try {
      const next = await (screenshots.length ? createSupportConversation(subject, body, screenshots) : createSupportConversation(subject, body));
      if (!isCurrentRequest()) return false;

      await loadList();
      if (!isCurrentRequest()) return false;
      router.push(`/support/${next.id}?sent=1`);
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      setCreateError(error instanceof Error ? error.message : "Message could not be sent. Try again.");
      return false;
    } finally {
      if (isCurrentRequest()) setCreating(false);
    }
  };
  const detail = Boolean(conversationId || composing);
  const visibleConversation = conversation?.id === conversationId ? conversation : null;
  const primaryLink = "inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-slate-950! hover:text-slate-950! focus-visible:text-slate-950! transition-colors hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200";
  return <div className="mx-auto max-w-6xl space-y-4 px-4 pb-12 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      {detail ? <Link href="/support" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200">← Back to support inbox</Link> : <p className="text-sm text-slate-300">Private conversations with Quest Support</p>}
      {!composing && <Link href="/support/new" className={primaryLink}>+ New conversation</Link>}
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[20rem_1fr]">
      <aside aria-label="Support conversations" className={`${detail ? "hidden lg:block" : ""} overflow-hidden rounded-2xl border border-white/10 bg-[#0d0c13]`}>
        <h2 className="border-b border-white/10 px-5 py-5 text-lg text-white">Your inbox</h2>
        {listError && <div role="alert" className="p-5 text-sm text-red-100"><p>{listError}</p><button className="mt-2 min-h-11 text-cyan-200 underline" onClick={() => void loadList()}>Try again</button></div>}
        {listLoading && !items.length ? <p role="status" className="p-5 text-sm text-slate-300">Loading your conversations…</p> : items.length ? <SupportConversationList items={items} selectedId={conversationId} /> : !listError ? <div className="p-5 text-sm leading-6 text-slate-300"><p className="font-semibold text-white">No conversations yet.</p><p className="mt-2">Get help with your account, tournament registration, payments, or technical issues.</p><p className="mt-2">Your messages are private to you and authorized Quest support staff.</p></div> : null}
      </aside>
      <section aria-label={composing ? "New conversation" : "Conversation"} className={`${!detail ? "hidden lg:block" : ""} min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0c13]`}>
        {composing ? <div className="p-5 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-200">Quest Support</p>
          <h2 ref={composerHeading} tabIndex={-1} className="mt-3 text-3xl text-white outline-none">New conversation</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Get help with your account, tournament registration, payments, or technical issues. Replies appear here. This is not live chat.</p>
          <div className="mt-6"><SupportComposer draftKey="new" busy={creating} error={createError} onSubmit={create} /></div>
        </div> : conversationId ? <>
          {sent && <div role="status" className="border-b border-cyan-300/20 bg-cyan-300/10 px-5 py-4 text-sm leading-6 text-cyan-100"><strong>Message sent.</strong> Quest Support will reply here. Return through Account → Support inbox.</div>}
          {threadError && <div role="alert" className="p-5 text-sm text-red-100"><p>{threadError}</p><button className="mt-2 min-h-11 text-cyan-200 underline" onClick={() => void loadThread()}>Try again</button></div>}
          {visibleConversation ? <SupportThread key={visibleConversation.id} conversation={visibleConversation} currentUserId={userId} readError={readError} onChanged={() => { void loadList(); void loadThread(); }} /> : threadLoading ? <p role="status" className="p-10 text-center text-sm text-slate-300">Loading this conversation…</p> : null}
        </> : <div className="px-8 py-16 text-center"><h2 className="text-2xl text-white">Choose a conversation</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-300">Select an existing conversation or start a new one.</p><Link href="/support/new" className="mt-5 inline-flex min-h-11 items-center font-semibold text-cyan-200">Start a conversation →</Link></div>}
      </section>
    </div>
  </div>;
}
