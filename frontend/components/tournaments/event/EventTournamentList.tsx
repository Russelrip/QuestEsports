"use client";

import { useState } from "react";
import TournamentCard from "@/components/tournaments/TournamentCard";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import type { EventSeries } from "@/lib/tournaments";

export default function EventTournamentList({ event }: { event: EventSeries }) {
  const [filter, setFilter] = useState("all");
  const categories = Array.from(new Map(event.tournaments.map((item) => [item.gameCategory?.slug || item.game, { key: item.gameCategory?.slug || item.game, label: item.gameCategory?.displayName || item.game }])).values());
  const tournaments = event.tournaments.filter((item) => filter === "all" || (item.gameCategory?.slug || item.game) === filter);
  return <Section className="pb-16" containerClassName="scroll-mt-8" ><div id="tournaments"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.3em] text-purple-200">Choose your game</p><h2 className="mt-3 font-display text-4xl text-white">Tournament titles</h2></div><span className="hidden text-sm text-slate-500 sm:block">{tournaments.length} {tournaments.length === 1 ? "game" : "games"}</span></div>
    <div className="mb-7 flex flex-wrap gap-2" role="group" aria-label="Filter event games">{[{ key: "all", label: "All Games" }, ...categories].map((item) => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300 ${filter === item.key ? "border-purple-300 bg-purple-300/15 text-white" : "border-white/10 text-slate-300 hover:border-purple-300/50"}`}>{item.label}</button>)}</div>
    {tournaments.length === 0 ? <EmptyState title="Games are being announced" description="Check back soon for the tournament line-up." /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tournaments.map((tournament, index) => <TournamentCard key={tournament.id} tournament={tournament} eager={index < 4} />)}</div>}
  </div></Section>;
}
