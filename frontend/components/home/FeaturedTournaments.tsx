import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { formatDisplayDate } from "@/lib/utils";
import {
  fetchPublicTournaments,
  getFeaturedTournaments,
} from "@/lib/tournaments";

export default async function FeaturedTournaments() {
  const tournaments = await fetchPublicTournaments();
  const featuredTournaments = getFeaturedTournaments(tournaments);

  return (
    <Section>
      <div className="mb-8 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Featured Events</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Active campaigns and upcoming competition drops.</h2>
        </div>
        <Link href="/tournaments" className={`${buttonClassName({ variant: "secondary" })} hidden sm:inline-flex`}>
          View all
        </Link>
      </div>

      <div className="mx-auto grid max-w-[76rem] gap-5 lg:grid-cols-3">
        {featuredTournaments.length > 0 ? (
          featuredTournaments.map((tournament) => (
            <Card key={tournament.id} className="group mx-auto flex h-full w-full max-w-[25rem] flex-col overflow-hidden">
              <div className="relative">
                <TournamentBannerImage
                  bannerUrl={tournament.bannerUrl}
                  title={tournament.title}
                  className="h-64 w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">{tournament.game}</p>
                  <h3 className="mt-2 text-2xl text-white">{tournament.title}</h3>
                </div>

                <p className="mt-4 min-h-[3.5rem] text-sm leading-6 text-slate-400">
                  {tournament.shortDescription || "Tournament schedule, roster requirements, and registration details."}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3 text-left text-sm text-slate-400">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Prize pool</p>
                    <p className="mt-1 text-white">{tournament.prizePool}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Event dates</p>
                    <p className="mt-1 text-white">
                      {formatDisplayDate(tournament.startDate)} - {formatDisplayDate(tournament.endDate)}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/tournaments/${tournament.slug}`}
                  className={buttonClassName({ className: "mt-6 w-full justify-center" })}
                >
                  View tournament
                </Link>
              </div>
            </Card>
          ))
        ) : (
          <Card className="p-8 lg:col-span-3">
            <h3 className="text-2xl text-white">More events are on the way.</h3>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Quest Esports is preparing the next tournament cycle. Check the full listing for announcements and registration windows.
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
