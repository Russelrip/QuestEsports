"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/lib/auth";
import { apiFetchJson } from "@/lib/auth";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";

type NotificationData = {
  items: Array<{ id: string; type: string; title: string; body: string; actionUrl: string | null; readAt: string | null; createdAt: string }>;
  unreadCount: number;
  push: { enabled: boolean; publicKey: string | null };
  preference: { matchPushEnabled: boolean; soundEnabled: boolean; matchEmailEnabled: false };
};

type Envelope<T> = { success?: boolean; data?: T };
const empty: NotificationData = { items: [], unreadCount: 0, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } };

const decodeVapidKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export default function NotificationBell({ user, compact = false }: { user: AuthUser; compact?: boolean }) {
  const [data, setData] = useState<NotificationData>(empty);
  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { response, data: envelope } = await apiFetchJson<Envelope<NotificationData>>("/api/v1/notifications?limit=30");
    if (response.ok && envelope.data) setData(envelope.data);
  }, []);

  useEffect(() => {
    void load();
    const closeRealtime = subscribeToRealtimeUpdates(`user:${user.id}`, () => void load());
    const poll = window.setInterval(() => void load(), 60_000);
    return () => { closeRealtime(); window.clearInterval(poll); };
  }, [load, user.id]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const markRead = async (id: string) => {
    await apiFetchJson(`/api/v1/notifications/${id}/read`, { method: "PATCH", json: {} });
    setData((current) => ({ ...current, unreadCount: Math.max(0, current.unreadCount - (current.items.find((item) => item.id === id)?.readAt ? 0 : 1)), items: current.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item) }));
  };

  const enablePush = async () => {
    if (!data.push.publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.register("/quest-sw.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(data.push.publicKey) });
      await apiFetchJson("/api/v1/notifications/push-subscriptions", { method: "POST", json: subscription.toJSON() });
      await load();
    } finally { setPushBusy(false); }
  };

  return (
    <div className={compact ? "relative w-full" : "relative"} ref={root}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={`${data.unreadCount} unread notifications`} className={compact ? "flex w-full items-center justify-between rounded-2xl bg-white/6 px-4 py-3 text-sm text-white" : "relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] text-slate-200 transition hover:bg-white/10"}>
        <span className={compact ? "flex items-center gap-3" : ""}><svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{compact ? "Notifications" : null}</span>
        {data.unreadCount ? <span className={compact ? "rounded-full bg-cyan-300 px-2 py-0.5 text-xs font-bold text-slate-950" : "absolute -right-1 -top-1 min-w-5 rounded-full bg-cyan-300 px-1 text-center text-[10px] font-bold leading-5 text-slate-950"}>{Math.min(data.unreadCount, 99)}</span> : null}
      </button>
      {open ? <div className={compact ? "mt-2 max-h-[28rem] overflow-y-auto rounded-2xl border border-white/10 bg-[#0c0c14] p-3" : "absolute right-0 top-[calc(100%+.75rem)] z-50 max-h-[32rem] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto border border-white/10 bg-[rgba(12,12,20,.99)] p-3 shadow-2xl"}>
        <div className="flex items-center justify-between border-b border-white/8 px-2 pb-3"><div><p className="font-semibold text-white">Notifications</p><p className="text-xs text-slate-500">Match updates stay in the app</p></div>{data.unreadCount ? <button type="button" className="text-xs text-cyan-200" onClick={() => void apiFetchJson("/api/v1/notifications/read-all", { method: "PATCH", json: {} }).then(load)}>Mark all read</button> : null}</div>
        <div className="mt-2 grid gap-1">{data.items.length ? data.items.map((item) => <Link key={item.id} href={item.actionUrl || "/profile"} onClick={() => { setOpen(false); void markRead(item.id); }} className={`rounded-xl px-3 py-3 transition hover:bg-white/8 ${item.readAt ? "opacity-65" : "bg-cyan-400/[.07]"}`}><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-white">{item.title}</p>{!item.readAt ? <span className="mt-1 size-2 shrink-0 rounded-full bg-cyan-300" /> : null}</div><p className="mt-1 text-xs leading-5 text-slate-400">{item.body}</p></Link>) : <p className="px-3 py-10 text-center text-sm text-slate-500">No match notifications yet.</p>}</div>
        {data.push.enabled && typeof Notification !== "undefined" && Notification.permission !== "granted" ? <button type="button" disabled={pushBusy} onClick={() => void enablePush()} className="mt-3 w-full rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100">{pushBusy ? "Enabling…" : "Enable browser alerts"}</button> : null}
      </div> : null}
    </div>
  );
}
