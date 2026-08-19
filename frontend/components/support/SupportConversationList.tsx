"use client";
import Link from "next/link";
import type { SupportConversationSummary, SupportStatus } from "@/lib/support";

export const statusLabel: Record<SupportStatus, string> = { OPEN: "Open", PENDING_USER: "Your reply", PENDING_STAFF: "With support", RESOLVED: "Resolved" };
export const statusTone: Record<SupportStatus, string> = { OPEN: "text-cyan-200 bg-cyan-300/10", PENDING_USER: "text-amber-200 bg-amber-300/10", PENDING_STAFF: "text-purple-200 bg-purple-300/10", RESOLVED: "text-slate-300 bg-white/8" };
const date = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));

export default function SupportConversationList({ items, selectedId }: { items: SupportConversationSummary[]; selectedId?: string }) {
  return <div className="divide-y divide-white/8">{items.map((item) => <Link key={item.id} href={`/support/${item.id}`} className={`block border-l-2 px-4 py-4 transition hover:bg-white/[.04] ${selectedId === item.id ? "border-cyan-300 bg-white/[.05]" : "border-transparent"}`}><div className="flex items-start justify-between gap-3"><h3 className={`min-w-0 truncate text-sm font-semibold ${item.unreadCount ? "text-white" : "text-slate-200"}`}>{item.subject}</h3><time className="shrink-0 text-[11px] text-slate-500">{date(item.updatedAt)}</time></div><div className="mt-2 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>{item.unreadCount ? <span className="rounded-full bg-cyan-300 px-1.5 text-[10px] font-bold text-slate-950">{item.unreadCount}</span> : null}</div><p className="mt-2 truncate text-xs leading-5 text-slate-500">{item.preview || "No messages yet."}</p></Link>)}</div>;
}
