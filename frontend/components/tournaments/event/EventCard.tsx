import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { getEventCardPresentation } from "@/lib/event-utils";
import type { EventSeries } from "@/lib/tournaments";

export default function EventCard({ event, preload = false, eager = false }: { event: EventSeries; preload?: boolean; eager?: boolean }) {
  const presentation = getEventCardPresentation(event);
  const preview = presentation.child;
  const games = event.tournaments.length;
  return <Link href={`/events/${event.slug}`} prefetch={false} className={`group relative aspect-[4/3] overflow-hidden rounded-[30px] border bg-[#0d0c13] ${presentation.eventStatus.key === "closed" ? "border-rose-500/45" : "border-white/10"}`}>
    <TournamentBannerImage
      bannerUrl={event.heroUrl || preview?.bannerUrl}
      title={event.title}
      preload={preload}
      loading={eager ? "eager" : "lazy"}
      className="absolute inset-0 h-full w-full object-contain"
    />
    <span className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
    <span className="absolute inset-x-5 bottom-5"><span className="text-xs uppercase tracking-[0.22em] text-purple-200">Event · {games} {games === 1 ? "game" : "games"}</span><span className="mt-2 block text-2xl text-white transition-colors group-hover:text-[var(--interactive-text)]">{event.title}</span><span className="mt-3 flex flex-wrap items-center gap-3 text-sm"><b className="text-white">{preview?.prizePool || "Prize TBA"}</b><b className={presentation.eventStatus.key === "open" ? "text-emerald-300" : "text-slate-300"}>{presentation.eventStatus.label} · Explore</b></span></span>
  </Link>;
}
