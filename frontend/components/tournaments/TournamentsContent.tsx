"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { buildApiUrl } from "@/lib/api";
import type { EventSeries, GameCategory, Tournament } from "@/lib/tournaments";
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
  mlbb: "/game-icon-images/mobile-legends-bang-bang.png",
  "mobile-legends": "/game-icon-images/mobile-legends-bang-bang.png",
  "mobile-legends-bang-bang": "/game-icon-images/mobile-legends-bang-bang.png",
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
  ["league-of-legends", "League of Legends"],
  ["mortal-kombat-11", "Mortal Kombat 11"],
  ["tekken", "Tekken"],
  ["call-of-duty", "Call of Duty"],
  ["counter-strike-2", "Counter-Strike 2"],
  ["dota-2", "Dota 2"],
  ["e-chess", "E-Chess"],
  ["assetto-corsa", "Assetto Corsa"],
  ["beat-saber", "Beat Saber"],
  ["clash-royale", "Clash Royale"],
  ["fc", "EA Sports FC"],
  ["free-fire", "Free Fire"],
  ["honor-of-kings", "Honor of Kings"],
  ["overwatch", "Overwatch"],
].map(([slug, displayName]) => ({
  id: `local-${slug}`,
  slug,
  displayName,
  artworkUrl: null,
  logoUrl: null,
}));

const gameSlugAliases: Record<string, string> = {
  chess: "e-chess",
  cod: "call-of-duty",
  "call-of-duty-mobile": "codm",
  "cod-mobile": "codm",
  "counter-strike": "counter-strike-2",
  cs2: "counter-strike-2",
  dota: "dota-2",
  dota2: "dota-2",
  "ea-fc": "fc",
  "ea-sports-fc": "fc",
  lol: "league-of-legends",
  "mobile-legends": "mlbb",
  "mobile-legends-bang-bang": "mlbb",
  mk11: "mortal-kombat-11",
  "mortal-kombat": "mortal-kombat-11",
  pubgm: "pubg-mobile",
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

function getUniqueGameFilters(categories: GameCategory[]) {
  const seenSlugs = new Set<string>();
  const seenIcons = new Set<string>();

  return [...localGameFilters, ...categories].filter((category) => {
    const slug = normalizeGameSlug(category.slug || category.displayName);
    const icon = getGameIcon(category);
    if (seenSlugs.has(slug) || (icon && seenIcons.has(icon))) return false;

    seenSlugs.add(slug);
    if (icon) seenIcons.add(icon);
    return true;
  });
}

export default function TournamentsContent({ tournaments, series = [], categories = [], initialGameFilter = "all" }: { tournaments: Tournament[]; series?: EventSeries[]; categories?: GameCategory[]; initialGameFilter?: string }) {
  const [gameFilter, setGameFilter] = useState(() => normalizeGameSlug(initialGameFilter) || "all");
  const gameScrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const gameFilters = getUniqueGameFilters(categories);
  const matches = (tournament: Tournament) => gameFilter === "all" || normalizeGameSlug(tournament.gameCategory?.slug || tournament.game) === gameFilter;
  const active = tournaments.filter((item) => !item.isCompleted && !item.series && matches(item));
  const past = tournaments
    .filter((item) => item.isCompleted && !item.series && matches(item))
    .sort((left, right) => {
      const leftDate = new Date(left.endDate || left.startDate || left.createdAt || 0).getTime();
      const rightDate = new Date(right.endDate || right.startDate || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });
  const standaloneTournaments = [...active, ...past];
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
        <button type="button" onClick={() => setGameFilter("all")} className={`h-24 w-28 shrink-0 snap-start rounded-none border px-4 text-sm font-semibold transition ${gameFilter === "all" ? "border-purple-300 bg-purple-400/15 text-purple-100" : "border-white/10 text-slate-300 hover:border-purple-300/40"}`}>View All Games</button>
        {gameFilters.map((category) => {
          const icon = getGameIcon(category);
          const categorySlug = normalizeGameSlug(category.slug);
          return <button key={categorySlug} type="button" onClick={() => setGameFilter(categorySlug)} aria-label={`View ${category.displayName} tournaments`} title={category.displayName} className={`relative h-24 w-28 shrink-0 snap-start overflow-hidden rounded-none border bg-[#0d0c13] transition ${gameFilter === categorySlug ? "border-purple-300 shadow-[0_10px_30px_rgba(168,85,247,0.22)]" : "border-white/10 hover:border-purple-300/40"}`}>
            {icon ? <Image src={icon} alt="" fill sizes="112px" draggable={false} className="object-cover" /> : <span className="flex h-full items-center justify-center px-3 text-center text-sm font-semibold text-white">{category.displayName}</span>}
            <span className="sr-only">{category.displayName}</span>
          </button>;
        })}
      </div>
      <button type="button" onClick={() => scrollGames(-1)} aria-label="Scroll games left" className={`absolute left-2 top-1/2 z-10 hidden h-16 w-10 -translate-y-1/2 items-center justify-center rounded-none border border-white/15 bg-black/80 text-3xl text-white shadow-xl backdrop-blur transition hover:border-purple-300/60 hover:bg-black md:flex ${canScrollLeft ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <span aria-hidden="true">‹</span>
      </button>
      <button type="button" onClick={() => scrollGames(1)} aria-label="Scroll games right" className={`absolute right-2 top-1/2 z-10 hidden h-16 w-10 -translate-y-1/2 items-center justify-center rounded-none border border-white/15 bg-black/80 text-3xl text-white shadow-xl backdrop-blur transition hover:border-purple-300/60 hover:bg-black md:flex ${canScrollRight ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <span aria-hidden="true">›</span>
      </button>
    </div>

    {filteredSeries.length ? <div className="mb-9 grid gap-5 md:grid-cols-2">{filteredSeries.map((item) => {
      const available = item.tournaments.find((tournament) => tournament.isRegistrationOpen);
      const preview = available || item.tournaments[0];
      return <Link key={item.id} href={`/tournaments/series/${item.slug}`} prefetch={false} className={`group relative aspect-[4/3] overflow-hidden rounded-[30px] border bg-[#0d0c13] ${preview && !preview.isRegistrationOpen ? "border-rose-500/45" : "border-white/10"}`}>
        <TournamentBannerImage bannerUrl={item.heroUrl || preview?.bannerUrl} title={item.title} className="absolute inset-0 h-full w-full object-contain" />
        <span className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
        <span className="absolute inset-x-5 bottom-5"><span className="text-xs uppercase tracking-[0.22em] text-purple-200">Event Series · {preview?.game || "Multiple games"}</span><span className="mt-2 block text-2xl text-white transition-colors group-hover:text-[var(--interactive-text)]">{item.title}</span><span className="mt-3 flex flex-wrap items-center gap-3 text-sm"><b className="text-white">{preview?.prizePool || "Prize TBA"}</b><b className={available ? "text-emerald-300" : "text-rose-300"}>{available ? "Registration Open · Register" : "View Details"}</b></span></span>
      </Link>;
    })}</div> : null}

    {standaloneTournaments.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{standaloneTournaments.map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />)}</div> : filteredSeries.length === 0 ? <EmptyState title="No tournaments match this game" description="Choose another game or view all events." /> : null}
  </Section>;
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const statusLabel = tournament.isCompleted
    ? "Completed"
    : tournament.isRegistrationOpen
      ? "Registration Open"
      : tournament.isSlotsFull
        ? "Slots Full"
        : "Registration Closed";
  const statusClassName = tournament.isCompleted
    ? "text-rose-400"
    : tournament.isRegistrationOpen
      ? "text-emerald-300"
      : "text-slate-300";

  return <Link href={`/tournaments/${tournament.slug}`} prefetch={false} className="group relative flex h-full flex-col overflow-hidden border border-white/10 bg-[#0d0c13]">
    <div className="relative aspect-[4/3] overflow-hidden bg-[#09080e]">
      <TournamentBannerImage bannerUrl={tournament.bannerUrl} title={tournament.title} rounded={false} showFallbackTitle={false} className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-85 motion-reduce:transition-none" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/25 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none" />
    </div>
    <div className="bg-[#0d0c13] px-5 py-5"><h3 className="line-clamp-2 min-h-16 text-xl font-bold uppercase leading-8 text-white transition-colors group-hover:text-[var(--interactive-text)]">{tournament.title}</h3></div>
    <dl className="grid flex-1 grid-cols-2 bg-[#0d0c13] text-xs [&>div:nth-child(-n+2)]:bg-white/[0.025]"><Meta label="Organizer" value={tournament.organizer} /><Meta label="Location" value={tournament.location} /><Meta label="Registration Closing Date" value={formatTournamentDate(tournament.registrationDeadline, tournament.registrationDeadlineStatus)} /><Meta label="Event Start Date" value={formatTournamentDate(tournament.startDate, tournament.startDateStatus)} /></dl>
    <div className="flex items-center justify-center bg-black/25 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.1em]"><span className={`whitespace-nowrap ${statusClassName}`}>{statusLabel}</span></div>
  </Link>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="min-w-0 px-5 py-4"><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt><dd className="mt-2 line-clamp-1 text-[15px] font-semibold text-white">{value}</dd></div>; }
