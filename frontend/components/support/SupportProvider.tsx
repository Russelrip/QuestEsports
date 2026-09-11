"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getSupportUnread } from "@/lib/support";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";

export type SupportDraft = { subject: string; body: string };
type SupportState = { unread: number | null; drafts: Map<string, SupportDraft>; signedIn: boolean };
const SupportContext = createContext<SupportState | null>(null);
export const useSupportState = () => useContext(SupportContext);
export const notifySupportRead = () => window.dispatchEvent(new Event("quest:support-read"));

export function SupportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <UserSupportState key={user?.id || "guest"} userId={user?.id}>{children}</UserSupportState>;
}

function UserSupportState({ userId, children }: { userId?: string; children: ReactNode }) {
  const [unread, setUnread] = useState<number | null>(null);
  // Memory only, destroyed on account switch/sign-out. Never persist private drafts in URLs.
  const [drafts] = useState(() => new Map<string, SupportDraft>());
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let running = false;
    let queued = false;
    const refresh = async () => {
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      if (running) { queued = true; return; }
      running = true;
      try {
        const result = await getSupportUnread(controller.signal);
        if (!controller.signal.aborted) setUnread(result.unreadConversations);
      } catch { /* Keep the last known count; a failed request is not an empty inbox. */ }
      finally {
        running = false;
        if (queued) { queued = false; void refresh(); }
      }
    };
    const invalidate = () => { void refresh(); };
    invalidate();
    const close = subscribeToRealtimeUpdates(`user:${userId}`, invalidate);
    const interval = window.setInterval(invalidate, 30_000);
    window.addEventListener("quest:support-read", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    return () => {
      controller.abort(); close(); window.clearInterval(interval);
      window.removeEventListener("quest:support-read", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
    };
  }, [userId]);
  const value = useMemo(() => ({ unread, drafts, signedIn: Boolean(userId) }), [unread, drafts, userId]);
  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export function SupportUnreadBadge() {
  const unread = useSupportState()?.unread;
  return unread ? <span className="ml-auto rounded-full bg-cyan-300 px-2 py-0.5 text-xs font-bold text-slate-950" aria-label={`${unread} conversations with unread replies`}>{unread > 99 ? "99+" : unread}</span> : null;
}

export function SupportUnreadDot({ id }: { id?: string } = {}) {
  const unread = useSupportState()?.unread;
  return unread ? <span id={id} className="inline-flex size-2 shrink-0 rounded-full bg-cyan-300"><span className="sr-only">Unread support replies</span></span> : null;
}
