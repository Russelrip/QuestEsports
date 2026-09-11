"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/lib/auth";
import { apiFetchJson } from "@/lib/auth";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { notifySupportRead } from "@/components/support/SupportProvider";

type NotificationData = {
  items: Array<{ id: string; type: string; title: string; body: string; actionUrl: string | null; readAt: string | null; createdAt: string }>;
  unreadCount: number;
  push: { enabled: boolean; publicKey: string | null };
  preference: { matchPushEnabled: boolean; soundEnabled: boolean; matchEmailEnabled: false };
};

type Envelope<T> = { success?: boolean; data?: T };
const empty: NotificationData = { items: [], unreadCount: 0, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } };
const notificationHref = (item: NotificationData["items"][number]) => item.type === "support_message" && item.actionUrl?.startsWith("/support/") ? item.actionUrl : item.actionUrl || "/profile";

type NotificationBellProps = {
  user: AuthUser;
  compact?: boolean;
  alignToAccount?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const decodeVapidKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export default function NotificationBell({
  user,
  compact = false,
  alignToAccount = false,
  open: controlledOpen,
  onOpenChange,
}: NotificationBellProps) {
  const [data, setData] = useState<NotificationData>(empty);
  const [internalOpen, setInternalOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const ownedControllers = useRef(new Map<number, Set<AbortController>>());
  const refreshInFlight = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const open = controlledOpen ?? internalOpen;

  const isCurrent = useCallback((requestGeneration: number, signal?: AbortSignal) => (
    requestGeneration === generation.current && !signal?.aborted
  ), []);

  const createController = useCallback((requestGeneration: number) => {
    const controller = new AbortController();
    const controllers = ownedControllers.current.get(requestGeneration) || new Set<AbortController>();
    controllers.add(controller);
    ownedControllers.current.set(requestGeneration, controllers);
    return controller;
  }, []);

  const releaseController = useCallback((requestGeneration: number, controller: AbortController) => {
    const controllers = ownedControllers.current.get(requestGeneration);
    controllers?.delete(controller);
    if (controllers?.size === 0) ownedControllers.current.delete(requestGeneration);
  }, []);

  const cancelGeneration = useCallback((requestGeneration: number) => {
    const controllers = ownedControllers.current.get(requestGeneration);
    controllers?.forEach((controller) => controller.abort());
    ownedControllers.current.delete(requestGeneration);
    if (refreshInFlight.current?.generation === requestGeneration) refreshInFlight.current = null;
  }, []);

  const updateOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);

  const load = useCallback(async (requestGeneration: number, requestSignal: AbortSignal) => {
    try {
      const { response, data: envelope } = await apiFetchJson<Envelope<NotificationData>>("/api/v1/notifications?limit=30", { signal: requestSignal });
      if (!response.ok || !envelope.data) throw new Error("Unable to load notifications.");
      if (!isCurrent(requestGeneration, requestSignal)) return;
      setData({ ...envelope.data, items: envelope.data.items.map((item) => ({ ...item, actionUrl: notificationHref(item) })) });
      setError("");
    } catch (caught) {
      if (isCurrent(requestGeneration, requestSignal)) setError(caught instanceof Error ? caught.message : "Unable to load notifications.");
    }
  }, [isCurrent]);

  const refresh = useCallback((requestGeneration = generation.current, suppliedController?: AbortController) => {
    if (requestGeneration !== generation.current) return Promise.resolve();
    if (refreshInFlight.current?.generation === requestGeneration) return refreshInFlight.current.promise;
    const controller = suppliedController || createController(requestGeneration);
    if (controller.signal.aborted) return Promise.resolve();
    const request = load(requestGeneration, controller.signal);
    refreshInFlight.current = { generation: requestGeneration, promise: request };
    void request.finally(() => {
      if (refreshInFlight.current?.promise === request) refreshInFlight.current = null;
      releaseController(requestGeneration, controller);
    });
    return request;
  }, [createController, load, releaseController]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    const controllers = ownedControllers.current.get(requestGeneration) || new Set<AbortController>();
    controllers.add(controller);
    ownedControllers.current.set(requestGeneration, controllers);
    setData(empty);
    setError("");
    setPushBusy(false);
    void refresh(requestGeneration, controller);
    const requestRefresh = () => {
      if (document.visibilityState === "visible") void refresh(requestGeneration);
    };
    const closeRealtime = subscribeToRealtimeUpdates(`user:${user.id}`, requestRefresh);
    const poll = window.setInterval(requestRefresh, 60_000);
    return () => {
      cancelGeneration(requestGeneration);
      generation.current += 1;
      closeRealtime();
      window.clearInterval(poll);
    };
  }, [cancelGeneration, refresh, user.id]);
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("quest:support-read", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("quest:support-read", onVisibilityChange);
    };
  }, [refresh]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) updateOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [updateOpen]);

  const mutate = useCallback(async (path: string, apply?: (current: NotificationData) => NotificationData): Promise<boolean> => {
    const requestGeneration = generation.current;
    const controller = createController(requestGeneration);
    try {
      const result = await apiFetchJson(path, { method: "PATCH", json: {}, signal: controller.signal });
      if (!result.response.ok) throw new Error("Unable to update notifications.");
      if (!isCurrent(requestGeneration, controller.signal)) return false;
      if (apply) setData(apply); else await refresh(requestGeneration);
      return true;
    } catch (caught) {
      if (isCurrent(requestGeneration, controller.signal)) setError(caught instanceof Error ? caught.message : "Unable to update notifications.");
      return false;
    } finally {
      releaseController(requestGeneration, controller);
    }
  }, [createController, isCurrent, refresh, releaseController]);

  const markRead = useCallback((id: string) => mutate(`/api/v1/notifications/${id}/read`, (current) => ({
    ...current,
    unreadCount: Math.max(0, current.unreadCount - (current.items.find((item) => item.id === id)?.readAt ? 0 : 1)),
    items: current.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
  })), [mutate]);

  const markAllRead = useCallback(async () => {
    const completed = await mutate("/api/v1/notifications/read-all");
    if (completed) notifySupportRead();
  }, [mutate]);

  const enablePush = useCallback(async () => {
    if (!data.push.publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const requestGeneration = generation.current;
    const controller = createController(requestGeneration);
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted" || !isCurrent(requestGeneration, controller.signal)) return;
      const registration = await navigator.serviceWorker.register("/quest-sw.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(data.push.publicKey) });
      if (!isCurrent(requestGeneration, controller.signal)) return;
      await apiFetchJson("/api/v1/notifications/push-subscriptions", { method: "POST", json: subscription.toJSON(), signal: controller.signal });
      if (!isCurrent(requestGeneration, controller.signal)) return;
      await refresh(requestGeneration);
    } catch (caught) {
      if (isCurrent(requestGeneration, controller.signal)) setError(caught instanceof Error ? caught.message : "Unable to enable browser alerts.");
    } finally {
      releaseController(requestGeneration, controller);
      if (isCurrent(requestGeneration, controller.signal)) setPushBusy(false);
    }
  }, [createController, data.push.publicKey, isCurrent, refresh, releaseController]);

  return (
    <div className={compact ? "relative w-full" : alignToAccount ? "contents" : "relative"} ref={root}>
      {error ? <div className="mb-2 flex items-center justify-between gap-2 text-xs text-rose-200" role="alert"><span>{error}</span><button type="button" className="font-semibold text-cyan-200" onClick={() => void refresh()}>Retry</button></div> : null}
      <button type="button" onClick={() => updateOpen(!open)} aria-label={`${data.unreadCount} unread notifications`} aria-expanded={open} className={compact ? "flex w-full items-center justify-between rounded-2xl bg-white/6 px-4 py-3 text-sm text-white" : "relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] text-slate-200 transition hover:bg-white/10"}>
        <span className={compact ? "flex items-center gap-3" : ""}><svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{compact ? "Notifications" : null}</span>
        {data.unreadCount ? <span className={compact ? "rounded-full bg-cyan-300 px-2 py-0.5 text-xs font-bold text-slate-950" : "absolute -right-1 -top-1 min-w-5 rounded-full bg-cyan-300 px-1 text-center text-[10px] font-bold leading-5 text-slate-950"}>{Math.min(data.unreadCount, 99)}</span> : null}
      </button>
      {open ? <div className={compact ? "mt-2 max-h-[28rem] overflow-y-auto rounded-2xl border border-white/10 bg-[#0c0c14] p-3" : "absolute right-0 top-[calc(100%+.75rem)] z-50 max-h-[32rem] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto border border-white/10 bg-[rgba(12,12,20,.99)] p-3 shadow-2xl"}>
        <div className="flex items-center justify-between border-b border-white/8 px-2 pb-3"><div><p className="font-semibold text-white">Notifications</p><p className="text-xs text-slate-500">Your latest updates</p></div>{data.unreadCount ? <button type="button" className="text-xs text-cyan-200" onClick={() => void markAllRead()}>Mark all read</button> : null}</div>
        <div className="mt-2 grid gap-3">{data.items.length ? [
          { label: "Support", items: data.items.filter((item) => item.type === "support_message") },
          { label: "Matches", items: data.items.filter((item) => item.type !== "support_message" && item.type.includes("match")) },
          { label: "Other updates", items: data.items.filter((item) => item.type !== "support_message" && !item.type.includes("match")) },
        ].filter((group) => group.items.length).map((group) => <section key={group.label} aria-label={`${group.label} notifications`}>
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300">{group.label}</h3>
          {group.items.map((item) => <Link key={item.id} href={item.actionUrl || "/profile"} onClick={() => { updateOpen(false); void markRead(item.id); }} className={`block rounded-xl border-l-2 px-3 py-3 transition-colors hover:bg-white/8 ${item.type === "support_message" ? "border-purple-300/60" : "border-transparent"} ${item.readAt ? "" : "bg-cyan-400/[.07]"}`}>
            <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-white">{item.title}</p>{!item.readAt ? <span className="mt-1 size-2 shrink-0 rounded-full bg-cyan-300"><span className="sr-only">Unread</span></span> : null}</div>
            <p className="mt-1 text-sm leading-5 text-slate-300">{item.type === "support_message" ? "A message is waiting in your private conversation." : item.body}</p>
            <time dateTime={item.createdAt} className="mt-2 block text-xs text-slate-400">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.createdAt))}</time>
            {item.type === "support_message" && <span className="mt-2 block text-sm font-semibold text-cyan-200">View conversation →</span>}
          </Link>)}
        </section>) : <p className="px-3 py-10 text-center text-sm text-slate-300">No notifications yet.</p>}</div>
        <Link href="/support" onClick={() => updateOpen(false)} className="mt-3 flex min-h-11 items-center justify-center border-t border-white/10 text-sm font-semibold text-cyan-200">View support inbox</Link>
        {data.push.enabled && typeof Notification !== "undefined" && Notification.permission !== "granted" ? <button type="button" disabled={pushBusy} onClick={() => void enablePush()} className="mt-3 w-full rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100">{pushBusy ? "Enabling…" : "Enable browser alerts"}</button> : null}
      </div> : null}
    </div>
  );
}
