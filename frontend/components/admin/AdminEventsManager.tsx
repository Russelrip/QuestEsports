"use client";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminEvents } from "@/hooks/api/useAdmin";
import { getAdminEventStatusLabel } from "@/lib/admin";
import { useState } from "react";

export default function AdminEventsManager() {
  const { data, error, loading } = useAdminEvents();
  const [search, setSearch] = useState("");
  const events = (data?.events || []).filter((event) => `${event.title} ${event.slug}`.toLowerCase().includes(search.toLowerCase()));
  return <AdminShell title="Events" description="Shape the event identity, timeline, and tournament lineup without losing the existing Event Series tools." actions={<Link href="/admin/events/new" className={buttonClassName({})}>New Event</Link>}>
    <Card className="p-6 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-2xl text-white">Event library</h3><p className="text-sm text-slate-400">Draft first, publish when the public page is ready.</p></div><Input className="sm:max-w-xs" aria-label="Search events" placeholder="Search events..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {loading ? <AdminTableSkeleton /> : error ? <EmptyState description={error} /> : events.length === 0 ? <EmptyState description="No events matched your search." /> : <div className="grid gap-4">{events.map((event) => <div key={event.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/5 p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-purple-300/20 bg-purple-400/10 px-3 py-1 text-xs text-purple-100">{getAdminEventStatusLabel(event.eventStatus)}</span><span className="text-xs text-slate-500">/{event.slug}</span></div><h4 className="mt-3 text-xl text-white">{event.title}</h4><p className="mt-1 text-sm text-slate-400">{event.tournaments.length} tournaments · {event.aggregate.teamsRegistered} teams · {event.aggregate.playersRegistered} players</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><Link href={`/admin/events/${event.id}`} className={buttonClassName({ variant: "secondary" })}>Manage event</Link><Link href={`/events/${event.slug}`} target="_blank" className={buttonClassName({ variant: "ghost" })}>View public</Link></div></div>)}</div>}
    </Card>
  </AdminShell>;
}
