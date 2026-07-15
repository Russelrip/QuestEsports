"use client";

import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import EmptyState from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/section";
import { buildApiUrl } from "@/lib/api";
import type { EventSeries, GameCategory, Tournament } from "@/lib/tournaments";
import { getTournamentRegistrationShortLabel } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";

export default function TournamentsContent({ tournaments, series = [], categories = [] }: { tournaments: Tournament[]; series?: EventSeries[]; categories?: GameCategory[] }) {
  const [gameFilter, setGameFilter] = useState("all");
  const matches = (tournament: Tournament) => gameFilter === "all" || tournament.gameCategory?.slug === gameFilter || tournament.game === gameFilter;
  const active = tournaments.filter((item) => !item.isCompleted && !item.series && matches(item));
  const filteredSeries = series.filter((item) => item.tournaments.some(matches));
  return <Section className="pt-6">
    <div className="mb-8 flex gap-3 overflow-x-auto pb-3" role="group" aria-label="Filter tournaments by game">
      <button type="button" onClick={() => setGameFilter("all")} className={`min-w-fit rounded-2xl border px-5 py-3 text-sm font-semibold transition ${gameFilter === "all" ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:border-white/30"}`}>View All Games</button>
      {categories.map((category) => <button key={category.id} type="button" onClick={() => setGameFilter(category.slug)} aria-label={`View ${category.displayName} tournaments`} title={category.displayName} className={`relative h-20 w-36 shrink-0 overflow-hidden rounded-2xl border bg-[#0d0c13] transition hover:-translate-y-0.5 ${gameFilter === category.slug ? "border-cyan-300 shadow-[0_10px_30px_rgba(34,211,238,0.2)]" : "border-white/10 hover:border-white/30"}`}>
        {category.artworkUrl ? <Image src={buildApiUrl(category.artworkUrl)} alt="" fill className="object-contain" /> : <span className="flex h-full items-center justify-center px-3 text-center text-sm font-semibold text-white">{category.displayName}</span>}
        <span className="sr-only">{category.displayName}</span>
      </button>)}
    </div>

    {filteredSeries.length ? <div className="mb-9 grid gap-5 md:grid-cols-2">{filteredSeries.map((item) => {
      const available = item.tournaments.find((tournament) => tournament.isRegistrationOpen);
      const preview = available || item.tournaments[0];
      return <Link key={item.id} href={`/tournaments/series/${item.slug}`} className={`group relative aspect-[4/3] overflow-hidden rounded-[30px] border bg-[#0d0c13] transition hover:-translate-y-1 ${preview && !preview.isRegistrationOpen ? "border-rose-500/45" : "border-white/10 hover:border-fuchsia-300/35"}`}>
        <TournamentBannerImage bannerUrl={item.heroUrl || preview?.bannerUrl} title={item.title} className="absolute inset-0 h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" />
        <span className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
        <span className="absolute inset-x-5 bottom-5"><span className="text-xs uppercase tracking-[0.22em] text-cyan-200">Event Series · {preview?.game || "Multiple games"}</span><span className="mt-2 block text-2xl text-white">{item.title}</span><span className="mt-3 flex flex-wrap items-center gap-3 text-sm"><b className="text-white">{preview?.prizePool || "Prize TBA"}</b><b className={available ? "text-emerald-300" : "text-rose-300"}>{available ? "Registration Open · Register" : "View Details"}</b></span></span>
      </Link>;
    })}</div> : null}

    {active.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{active.map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />)}</div> : filteredSeries.length === 0 ? <EmptyState title="No active tournaments match this game" description="Choose another game or view all current events." /> : null}
  </Section>;
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const closed = !tournament.isRegistrationOpen;
  const fee = tournament.registrationFee.amount > 0 ? `${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toLocaleString()}` : "Free";
  const date = tournament.startDate ? new Date(tournament.startDate) : null;
  return <Link href={`/tournaments/${tournament.slug}`} className={`group overflow-hidden rounded-[28px] border bg-[#0d0c13] transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(0,0,0,0.35)] ${closed ? "border-rose-500/45 hover:border-rose-400/70" : "border-white/10 hover:border-cyan-300/40"}`}>
    <div className="relative aspect-[4/3] bg-black/40"><TournamentBannerImage bannerUrl={tournament.bannerUrl} title={tournament.title} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" /><span className={`absolute right-3 top-3 rounded-full border px-3 py-1 text-xs font-bold uppercase ${closed ? "border-rose-400/50 bg-rose-950/90 text-rose-200" : "border-emerald-300/40 bg-emerald-950/90 text-emerald-200"}`}>{getTournamentRegistrationShortLabel(tournament)}</span></div>
    <div className="p-5"><p className="text-xs uppercase tracking-[0.22em] text-cyan-200">{tournament.gameCategory?.displayName || tournament.game}</p><h3 className="mt-2 text-2xl leading-tight text-white">{tournament.title}</h3><dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><Meta label="Organizer" value={tournament.organizer} /><Meta label="Country" value={tournament.country} /><Meta label="Location" value={tournament.location} /><Meta label="Prize" value={tournament.prizePool} /><Meta label="Date" value={formatTournamentDate(tournament.startDate, tournament.startDateStatus)} /><Meta label="Time" value={date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : tournament.startDateStatus.toUpperCase()} /><Meta label="Entry fee" value={fee} /><Meta label="Format" value={tournament.format} /></dl></div>
  </Link>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</dt><dd className="mt-1 line-clamp-1 font-medium text-slate-200">{value}</dd></div>; }
