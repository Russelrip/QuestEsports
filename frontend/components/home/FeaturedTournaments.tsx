import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { formatDisplayDate } from "@/lib/utils";
import {
  fetchPublicTournaments,
  getFeaturedTournaments,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

export default async function FeaturedTournaments() {
  const tournaments = await fetchPublicTournaments();
  const featuredTournaments = getFeaturedTournaments(tournaments);

  return (
    <Section>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Featured Events</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Active campaigns and upcoming competition drops.</h2>
        </div>
        <Link href="/tournaments" className={`${buttonClassName({ variant: "secondary" })} hidden sm:inline-flex`}>
          View all
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {featuredTournaments.length > 0 ? (
          featuredTournaments.map((tournament) => (
            <Card key={tournament.id} className="group overflow-hidden">
              <div className="relative">
                <TournamentBannerImage
                  bannerUrl={tournament.bannerUrl}
                  title={tournament.title}
                  className="h-64 w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
                <div className="absolute left-4 top-4">
                  <Badge className="bg-black/45 text-white">{getTournamentStatusLabel(tournament.status)}</Badge>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">{tournament.game}</p>
                  <h3 className="mt-2 text-2xl text-white">{tournament.title}</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm text-slate-400">
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
                <Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ className: "w-full" })}>
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
