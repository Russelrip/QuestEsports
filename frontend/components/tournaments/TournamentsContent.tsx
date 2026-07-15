"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import EmptyState from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/section";
import { buildApiUrl } from "@/lib/api";
import type { EventSeries, GameCategory, Tournament } from "@/lib/tournaments";
import { getTournamentRegistrationShortLabel } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";

const gameIconBySlug: Record<string, string> = {
  "assetto-corsa": "/game-icon-images/assetto corsa.png",
  "beat-saber": "/game-icon-images/beat saber.png",
  "call-of-duty": "/game-icon-images/call of duty.png",
  "call-of-duty-mobile": "/game-icon-images/COD Mobile.png",
  "clash-royale": "/game-icon-images/clash royale.png",
  codm: "/game-icon-images/COD Mobile.png",
  "counter-strike-2": "/game-icon-images/counter strike 2.png",
  cs2: "/game-icon-images/counter strike 2.png",
  "dota-2": "/game-icon-images/DOTA 2.png",
  chess: "/game-icon-images/e-chess.png",
  "e-chess": "/game-icon-images/e-chess.png",
  "ea-fc": "/game-icon-images/FC.png",
  "ea-sports-fc": "/game-icon-images/FC.png",
  fc: "/game-icon-images/FC.png",
  "free-fire": "/game-icon-images/free fire.png",
  "honor-of-kings": "/game-icon-images/honor of kings.png",
  "league-of-legends": "/game-icon-images/league of legends.png",
  mlbb: "/game-icon-images/Molbile Legends Bang bang.png",
  "mobile-legends": "/game-icon-images/Molbile Legends Bang bang.png",
  "mobile-legends-bang-bang": "/game-icon-images/Molbile Legends Bang bang.png",
  "mortal-kombat-11": "/game-icon-images/mortal kombat 11.png",
  mk11: "/game-icon-images/mortal kombat 11.png",
  overwatch: "/game-icon-images/overwatch.png",
  "pubg-mobile": "/game-icon-images/PUBG mobile.png",
  tekken: "/game-icon-images/tekken.png",
  valorant: "/game-icon-images/valorant.png",
};

const localGameFilters: GameCategory[] = [
  ["valorant", "Valorant"],
  ["pubg-mobile", "PUBG Mobile"],
  ["mlbb", "Mobile Legends: Bang Bang"],
  ["codm", "Call of Duty: Mobile"],
  ["assetto-corsa", "Assetto Corsa"],
  ["beat-saber", "Beat Saber"],
  ["call-of-duty", "Call of Duty"],
  ["clash-royale", "Clash Royale"],
  ["counter-strike-2", "Counter-Strike 2"],
  ["dota-2", "Dota 2"],
  ["e-chess", "E-Chess"],
  ["fc", "EA Sports FC"],
  ["free-fire", "Free Fire"],
  ["honor-of-kings", "Honor of Kings"],
  ["league-of-legends", "League of Legends"],
  ["mortal-kombat-11", "Mortal Kombat 11"],
  ["overwatch", "Overwatch"],
  ["tekken", "Tekken"],
].map(([slug, displayName]) => ({
  id: `local-${slug}`,
  slug,
  displayName,
  artworkUrl: null,
  logoUrl: null,
}));

const gameSlugAliases: Record<string, string> = {
  chess: "e-chess",
  "call-of-duty-mobile": "codm",
  "cod-mobile": "codm",
  "counter-strike": "counter-strike-2",
  cs2: "counter-strike-2",
  dota: "dota-2",
  "ea-fc": "fc",
  "ea-sports-fc": "fc",
  "mobile-legends": "mlbb",
  "mobile-legends-bang-bang": "mlbb",
  mk11: "mortal-kombat-11",
  "mortal-kombat": "mortal-kombat-11",
};

function normalizeGameSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return gameSlugAliases[slug] || slug;
}

function getGameIcon(category: GameCategory) {
  const categorySlug = normalizeGameSlug(category.slug);
  const displayNameSlug = normalizeGameSlug(category.displayName);
  return gameIconBySlug[categorySlug] || gameIconBySlug[displayNameSlug] || (category.artworkUrl ? buildApiUrl(category.artworkUrl) : null);
}

export default function TournamentsContent({ tournaments, series = [], categories = [] }: { tournaments: Tournament[]; series?: EventSeries[]; categories?: GameCategory[] }) {
  const [gameFilter, setGameFilter] = useState("all");
  const gameScrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const localGameSlugs = new Set(localGameFilters.map((category) => category.slug));
  const gameFilters = [...localGameFilters, ...categories.filter((category) => !localGameSlugs.has(normalizeGameSlug(category.slug)))];
  const matches = (tournament: Tournament) => gameFilter === "all" || normalizeGameSlug(tournament.gameCategory?.slug || tournament.game) === gameFilter;
  const active = tournaments.filter((item) => !item.isCompleted && !item.series && matches(item));
  const filteredSeries = series.filter((item) => item.tournaments.some(matches));

  useEffect(() => {
    const scroller = gameScrollerRef.current;
    if (!scroller) return;

    const updateScrollButtons = () => {
      setCanScrollLeft(scroller.scrollLeft > 2);
      setCanScrollRight(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2);
    };

    updateScrollButtons();
    scroller.addEventListener("scroll", updateScrollButtons, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, []);

  const scrollGames = (direction: -1 | 1) => {
    const scroller = gameScrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(scroller.clientWidth * 0.75, 320), behavior: "smooth" });
  };

  return <Section className="pt-6">
    <div className="relative mb-8">
      <div ref={gameScrollerRef} className="flex max-w-full snap-x snap-proximity gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter tournaments by game">
        <button type="button" onClick={() => setGameFilter("all")} className={`h-24 w-28 shrink-0 snap-start rounded-2xl border px-4 text-sm font-semibold transition ${gameFilter === "all" ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:border-white/30"}`}>View All Games</button>
        {gameFilters.map((category) => {
          const icon = getGameIcon(category);
          return <button key={category.id} type="button" onClick={() => setGameFilter(category.slug)} aria-label={`View ${category.displayName} tournaments`} title={category.displayName} className={`relative h-24 w-28 shrink-0 snap-start overflow-hidden rounded-2xl border bg-[#0d0c13] transition hover:-translate-y-0.5 ${gameFilter === category.slug ? "border-cyan-300 shadow-[0_10px_30px_rgba(34,211,238,0.2)]" : "border-white/10 hover:border-white/30"}`}>
            {icon ? <Image src={icon} alt="" fill sizes="112px" draggable={false} className="object-cover" /> : <span className="flex h-full items-center justify-center px-3 text-center text-sm font-semibold text-white">{category.displayName}</span>}
            <span className="sr-only">{category.displayName}</span>
          </button>;
        })}
      </div>
      <button type="button" onClick={() => scrollGames(-1)} aria-label="Scroll games left" className={`absolute left-2 top-1/2 z-10 hidden h-16 w-10 -translate-y-1/2 items-center justify-center rounded-xl border border-white/15 bg-black/80 text-3xl text-white shadow-xl backdrop-blur transition hover:border-cyan-300/60 hover:bg-black md:flex ${canScrollLeft ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <span aria-hidden="true">‹</span>
      </button>
      <button type="button" onClick={() => scrollGames(1)} aria-label="Scroll games right" className={`absolute right-2 top-1/2 z-10 hidden h-16 w-10 -translate-y-1/2 items-center justify-center rounded-xl border border-white/15 bg-black/80 text-3xl text-white shadow-xl backdrop-blur transition hover:border-cyan-300/60 hover:bg-black md:flex ${canScrollRight ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <span aria-hidden="true">›</span>
      </button>
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
