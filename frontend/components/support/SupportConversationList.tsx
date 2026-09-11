"use client";
import Link from "next/link";
import type { SupportConversationSummary, SupportStatus } from "@/lib/support";

export const statusLabel: Record<SupportStatus, string> = { OPEN: "Open", PENDING_USER: "Your reply needed", PENDING_STAFF: "Waiting for support", RESOLVED: "Resolved" };
export const statusTone: Record<SupportStatus, string> = { OPEN: "text-cyan-200 bg-cyan-300/10", PENDING_USER: "text-amber-200 bg-amber-300/10", PENDING_STAFF: "text-purple-200 bg-purple-300/10", RESOLVED: "text-slate-300 bg-white/8" };
const date = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));

function ConversationRows({ items, selectedId }: { items: SupportConversationSummary[]; selectedId?: string }) {
  return <div className="divide-y divide-white/10">{items.map((item) => <Link key={item.id} href={`/support/${item.id}`} aria-current={selectedId === item.id ? "page" : undefined} className={`block border-l-2 px-5 py-4 transition-colors focus-visible:outline-2 focus-visible:outline-cyan-200 focus-visible:-outline-offset-2 hover:bg-white/[.04] ${selectedId === item.id ? "border-cyan-300 bg-white/[.05]" : "border-transparent"}`}>
    <div className="flex items-start justify-between gap-3"><h3 className={`min-w-0 break-words text-sm ${item.unreadCount ? "font-bold text-white" : "font-medium text-slate-200"}`}>{item.subject}</h3><time dateTime={item.updatedAt} className="shrink-0 text-xs text-slate-400">{date(item.updatedAt)}</time></div>
    <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>{item.unreadCount ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200"><span aria-hidden="true" className="size-1.5 rounded-full bg-cyan-300" />New reply</span> : null}</div>
    <p className="mt-2 truncate text-sm leading-5 text-slate-400">{item.preview || "No messages yet."}</p>
  </Link>)}</div>;
}

export default function SupportConversationList({ items, selectedId }: { items: SupportConversationSummary[]; selectedId?: string }) {
  const sorted = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const active = sorted.filter((item) => item.status !== "RESOLVED");
  const resolved = sorted.filter((item) => item.status === "RESOLVED");
  return <>
    <h3 className="px-5 pb-2 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Active ({active.length})</h3>
    {active.length ? <ConversationRows items={active} selectedId={selectedId} /> : <p className="px-5 py-4 text-sm text-slate-400">No active conversations.</p>}
    {resolved.length > 0 && <details key={resolved.some((item) => item.id === selectedId) ? "selected" : "collapsed"} open={resolved.some((item) => item.id === selectedId) || undefined} className="border-t border-white/10"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-300">Resolved ({resolved.length}){resolved.some((item) => item.unreadCount > 0) ? " · New reply" : ""}</summary><ConversationRows items={resolved} selectedId={selectedId} /></details>}
  </>;
}
