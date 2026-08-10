import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import TicketCheckout from "@/components/tickets/TicketCheckout";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PageTransition } from "@/components/ui/page-transition";
import { fetchPublicEventSeriesBySlug } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";
import { buildNoIndexMetadata, buildPageMetadata } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const series = await fetchPublicEventSeriesBySlug(slug);
    return buildPageMetadata({
      title: series.title,
      description: series.description,
      path: `/tournaments/series/${slug}`,
      image: series.heroUrl || undefined,
      keywords: [
        series.title,
        "e-sports tournament series",
        "Sri Lanka gaming events",
      ],
    });
  } catch {
    return buildNoIndexMetadata(
      "Event Not Found",
      "This event series could not be found.",
      "/tournaments"
    );
  }
}

export default async function EventSeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let series;
  try { series = await fetchPublicEventSeriesBySlug(slug); }
  catch (error) { if (error instanceof ApiRequestError && error.status === 404) notFound(); throw error; }

  return (
    <PageTransition>
      <section className="relative isolate min-h-[52svh] overflow-hidden border-b border-white/10">
        <TournamentBannerImage
          bannerUrl={series.heroUrl || series.tournaments[0]?.bannerUrl}
          title={series.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-[#07060b]/60 to-black/15" />
        <Container className="relative flex min-h-[52svh] items-end py-12 sm:py-16">
          <div className="max-w-4xl">
            <Link href="/tournaments" className="text-sm text-slate-300 transition hover:text-white">Back to tournaments</Link>
            <p className="mt-8 text-xs uppercase tracking-[0.32em] text-purple-200">Quest E-sports Event</p>
            <h1 className="mt-4 text-5xl leading-none text-white sm:text-7xl">{series.title}</h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-200 sm:text-base">{series.description}</p>
          </div>
        </Container>
      </section>

      {series.ticketEvent ? (
        <section className="border-b border-white/10 bg-white/[0.02] py-10 sm:py-14">
          <Container>
            <div className="mb-7 max-w-3xl border-l-2 border-purple-300 pl-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-200">
                LAN entrance fee
              </p>
              <h2 className="mt-3 text-3xl text-white">Get your event entrance pass</h2>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                This fee is for entry to {series.title}. Tournament registration is handled separately for each game below.
              </p>
            </div>
            <TicketCheckout event={series.ticketEvent} />
          </Container>
        </section>
      ) : null}

      <section className="py-10 sm:py-14">
        <Container>
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Tournament Titles</p>
            <h2 className="mt-3 text-3xl text-white">Choose a game and view its registration page.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {series.tournaments.map((tournament) => (
              <article key={tournament.id} className={`group overflow-hidden rounded-[30px] border bg-[#0d0c13] ${tournament.isRegistrationOpen ? "border-white/10" : "border-rose-500/45"}`}>
                <Link href={`/tournaments/${tournament.slug}`} prefetch={false} className="block">
                  <div className="aspect-[4/3] overflow-hidden bg-black/30">
                    <TournamentBannerImage bannerUrl={tournament.bannerUrl} title={tournament.title} className="h-full w-full object-contain" />
                  </div>
                  <div className="p-5">
                    <p className="text-xs uppercase tracking-[0.22em] text-purple-200/80">{tournament.game}</p>
                    <h3 className="mt-2 text-2xl text-white transition-colors group-hover:text-[var(--interactive-text)]">{tournament.title}</h3>
                    <p className={`mt-2 text-sm font-semibold ${tournament.isRegistrationOpen ? "text-emerald-300" : "text-rose-300"}`}>{tournament.isRegistrationOpen ? "Registration Open" : tournament.isSlotsFull ? "Slots Full" : "Registration Closed"}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-400">
                      <span><strong className="block text-white">{tournament.prizePool}</strong>Prize pool</span>
                      <span><strong className="block text-white">{formatTournamentDate(tournament.startDate, tournament.startDateStatus)}</strong>Starts</span>
                    </div>
                  </div>
                </Link>
                <div className="px-5 pb-5">
                  <Link href={tournament.isRegistrationOpen ? `/tournaments/${tournament.slug}/register` : `/tournaments/${tournament.slug}`} prefetch={false} className={buttonClassName({ className: "w-full justify-center" })}>{tournament.isRegistrationOpen ? "Register" : "View Details"}</Link>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </PageTransition>
  );
}
