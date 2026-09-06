"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import TournamentCard from "@/components/tournaments/TournamentCard";
import EventCard from "@/components/tournaments/event/EventCard";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { resolveImageUrl } from "@/lib/media";
import { composeTournamentListing, normalizeGameSlug } from "@/lib/tournament-listing";
import type { EventSeries, GameCategory, Tournament } from "@/lib/tournaments";

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

function getGameIcon(category: GameCategory) {
  const categorySlug = normalizeGameSlug(category.slug);
  const displayNameSlug = normalizeGameSlug(category.displayName);
  return gameIconBySlug[categorySlug] || gameIconBySlug[displayNameSlug] || resolveImageUrl(category.artworkUrl);
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

export default function TournamentsContent({ tournaments, events = [], categories = [], initialGameFilter = "all" }: { tournaments: Tournament[]; events?: EventSeries[]; categories?: GameCategory[]; initialGameFilter?: string }) {
  const [gameFilter, setGameFilter] = useState(() => normalizeGameSlug(initialGameFilter) || "all");
  const gameScrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const gameFilters = getUniqueGameFilters(categories);
  const listing = composeTournamentListing({ tournaments, events, gameFilter });

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
          const isDynamicIcon = Boolean(category.artworkUrl && !gameIconBySlug[categorySlug] && !gameIconBySlug[normalizeGameSlug(category.displayName)]) || Boolean(icon?.startsWith("http"));
          return <button key={categorySlug} type="button" onClick={() => setGameFilter(categorySlug)} aria-label={`View ${category.displayName} tournaments`} title={category.displayName} className={`relative h-24 w-28 shrink-0 snap-start overflow-hidden rounded-none border bg-[#0d0c13] transition ${gameFilter === categorySlug ? "border-purple-300 shadow-[0_10px_30px_rgba(168,85,247,0.22)]" : "border-white/10 hover:border-purple-300/40"}`}>
            {icon ? <Image src={icon} alt="" fill sizes="112px" draggable={false} unoptimized className="object-cover" onError={isDynamicIcon ? (event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied === "true") image.style.display = "none"; else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; } } : undefined} /> : <span className="flex h-full items-center justify-center px-3 text-center text-sm font-semibold text-white">{category.displayName}</span>}
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


    {listing.isEmpty ? <EmptyState title="No tournaments match this game" description="Choose another game, or view all games to see everything Quest is running." /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listing.events.map((event, index) => <EventCard key={event.id} event={event} preload={index === 0} eager={index < 4} />)}
      {listing.tournaments.map((tournament, index) => { const position = listing.events.length + index; return <TournamentCard key={tournament.id} tournament={tournament} preload={position === 0} eager={position < 4} />; })}
    </div>}
  </Section>;
}
