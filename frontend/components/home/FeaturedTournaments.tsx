import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { formatTournamentDateRange } from "@/lib/utils";
import {
  fetchPublicTournaments,
  getFeaturedTournaments,
  type Tournament,
} from "@/lib/tournaments";

export default async function FeaturedTournaments() {
  let tournaments: Tournament[] = [];

  try {
    tournaments = await fetchPublicTournaments();
  } catch (error) {
    console.error("Unable to load featured tournaments:", error);
  }

  const featuredTournaments = getFeaturedTournaments(tournaments);

  return (
    <Section>
      <div className="mb-8 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div className="max-w-3xl">
          <h2 className="text-3xl text-white sm:text-4xl">Featured Events</h2>
        </div>
        <Link href="/tournaments" className={`${buttonClassName({ variant: "secondary" })} hidden sm:inline-flex`}>
          View all
        </Link>
      </div>

      <div className="mx-auto grid max-w-[76rem] gap-5 lg:grid-cols-3">
        {featuredTournaments.length > 0 ? (
          featuredTournaments.map((tournament) => (
            <Card key={tournament.id} className={`group mx-auto flex h-full w-full max-w-[25rem] flex-col overflow-hidden rounded-none ${tournament.isRegistrationOpen ? "" : "border-rose-500/45"}`}>
              <Link href={`/tournaments/${tournament.slug}`} prefetch={false} className="relative block aspect-[4/3] overflow-hidden bg-[#09080e] p-3">
                  <TournamentBannerImage
                    bannerUrl={tournament.bannerUrl}
                    title={tournament.title}
                    rounded={false}
                    className="h-full w-full object-contain"
                  />
              </Link>
              <div className="flex flex-1 flex-col p-5">
                <div>
                  <Link href={`/tournaments/${tournament.slug}`} prefetch={false} className="block">
                    <h3 className="text-2xl text-white transition-colors group-hover:text-[var(--interactive-text)]">{tournament.title}</h3>
                  </Link>
                </div>

                <div className="mt-auto pt-5">
                  <div className="grid min-h-[3.75rem] grid-cols-2 gap-3 text-left text-sm text-slate-400">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Prize pool</p>
                      <p className="mt-1 text-white">{tournament.prizePool}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Event dates</p>
                      <p className="mt-1 text-white">
                        {formatTournamentDateRange(tournament)}
                      </p>
                    </div>
                  </div>

                  <Link
                    href={`/tournaments/${tournament.slug}`}
                    prefetch={false}
                    className={buttonClassName({ className: "mt-6 w-full justify-center" })}
                  >
                    View tournament
                  </Link>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <Card className="p-8 lg:col-span-3">
            <h3 className="text-2xl text-white">More events are on the way.</h3>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Quest E-sports is preparing the next tournament cycle. Check the full listing for announcements and registration windows.
            </p>
            <div className="mt-6">
              <Link href="/tournaments" className={buttonClassName({})}>
                Browse tournaments
              </Link>
            </div>
          </Card>
        )}
      </div>
    </Section>
  );
}
