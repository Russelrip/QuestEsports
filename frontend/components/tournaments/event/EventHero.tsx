import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { buttonClassName } from "@/components/ui/button";
import { getCountdownTarget, formatEventCountdown, getEventStatus } from "@/lib/event-utils";
import type { EventSeries } from "@/lib/tournaments";

export default function EventHero({ event }: { event: EventSeries }) {
  const status = getEventStatus(event);
  const countdown = getCountdownTarget(event);
  return (
    <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#08070d]">
      <div className="absolute inset-0 opacity-40"><TournamentBannerImage bannerUrl={event.heroUrl || event.bannerUrl || event.tournaments[0]?.bannerUrl || null} title={event.title} showFallbackTitle={false} className="h-full w-full object-cover blur-sm" /></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_22%,rgba(168,85,247,0.25),transparent_34%),linear-gradient(110deg,#07060b_18%,rgba(7,6,11,0.8)_54%,rgba(7,6,11,0.45))]" />
      <Container className="relative flex min-h-[58svh] items-end py-12 sm:min-h-[64svh] sm:py-20">
        <div className="max-w-4xl">
          <Link href="/tournaments" className="text-sm text-slate-300 underline-offset-4 transition hover:text-white hover:underline motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300">Back to tournaments</Link>
          <div className="mt-8 flex flex-wrap items-center gap-3"><Badge className="border-purple-300/30 bg-purple-300/10 text-purple-100">Quest event</Badge><span className="text-sm font-semibold text-slate-200" aria-label={`Event status: ${status.label}`}>{status.label}</span></div>
          <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[0.95] text-white sm:text-7xl">{event.title}</h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">{event.shortDescription || event.subtitle || event.description}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {countdown ? <p className="border-l-2 border-fuchsia-300 pl-4 text-sm text-slate-200"><span className="block text-xs uppercase tracking-[0.2em] text-fuchsia-200">{countdown.label}</span><strong className="mt-1 block text-xl text-white">{formatEventCountdown(countdown.date)}</strong></p> : null}
            <Link href="#tournaments" className={buttonClassName({ size: "lg", className: "border-purple-300/30 bg-purple-400/15 hover:bg-purple-400/25 motion-reduce:transition-none" })}>Explore games <span aria-hidden="true">↓</span></Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
