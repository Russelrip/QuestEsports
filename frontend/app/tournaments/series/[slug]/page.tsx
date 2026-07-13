import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PageTransition } from "@/components/ui/page-transition";
import { fetchPublicEventSeriesBySlug } from "@/lib/tournaments";
import { formatDisplayDate } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const series = await fetchPublicEventSeriesBySlug(slug);
    return { title: series.title, description: series.description };
  } catch {
    return { title: "Event Not Found", robots: { index: false, follow: false } };
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
            <p className="mt-8 text-xs uppercase tracking-[0.32em] text-cyan-200">Quest E-sports Event</p>
            <h1 className="mt-4 text-5xl leading-none text-white sm:text-7xl">{series.title}</h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-200 sm:text-base">{series.description}</p>
          </div>
        </Container>
      </section>

      <section className="py-10 sm:py-14">
        <Container>
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Tournament Titles</p>
            <h2 className="mt-3 text-3xl text-white">Choose a game and view its registration page.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {series.tournaments.map((tournament) => (
              <article key={tournament.id} className="group overflow-hidden rounded-[30px] border border-white/10 bg-[#0d0c13] transition hover:-translate-y-1 hover:border-fuchsia-300/25">
                <Link href={`/tournaments/${tournament.slug}`} className="block">
                  <div className="aspect-[4/3] overflow-hidden bg-black/30">
                    <TournamentBannerImage bannerUrl={tournament.bannerUrl} title={tournament.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />
                  </div>
                  <div className="p-5">
                    <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">{tournament.game}</p>
                    <h3 className="mt-2 text-2xl text-white">{tournament.title}</h3>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-400">
                      <span><strong className="block text-white">{tournament.prizePool}</strong>Prize pool</span>
                      <span><strong className="block text-white">{formatDisplayDate(tournament.startDate)}</strong>Starts</span>
                    </div>
                  </div>
                </Link>
                <div className="px-5 pb-5">
                  <Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ className: "w-full justify-center" })}>View tournament</Link>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </PageTransition>
  );
}
