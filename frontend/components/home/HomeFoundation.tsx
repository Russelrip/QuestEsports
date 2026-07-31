import Image from "next/image";
import Link from "next/link";
import HomeHero from "@/components/home/HomeHero";
import MatchCard from "@/components/matches/MatchCard";
import MatchCountdown from "@/components/matches/MatchCountdown";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { buildApiUrl } from "@/lib/api";
import { videoSections } from "@/lib/media";
import type { HomeFeed, HomeTournament } from "@/lib/matches";

function Heading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200">{eyebrow}</p><h2 className="mt-2 text-3xl text-white sm:text-4xl">{title}</h2></div>{action}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="border-dashed p-6 text-sm text-slate-400">{children}</Card>;
}

function TournamentCard({ tournament }: { tournament: HomeTournament }) {
  const registrationOpen = tournament.registrationOpen;
  return <Card className="group flex min-w-0 flex-col overflow-hidden">
    <Link href={`/tournaments/${tournament.slug}`} className="relative block aspect-[16/9] overflow-hidden bg-[#090b12]">
      {tournament.bannerUrl ? <Image src={buildApiUrl(tournament.bannerUrl)} alt={`${tournament.title} tournament`} fill sizes="(min-width:1024px) 33vw, 100vw" className="object-cover transition duration-300 group-hover:scale-[1.02]" /> : <div className="absolute inset-0 bg-[#121828]" />}
      <span className="absolute left-4 top-4 border border-white/15 bg-black/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">{tournament.game}</span>
    </Link>
    <div className="flex flex-1 flex-col p-5">
      <p className={`text-xs font-semibold ${registrationOpen ? "text-emerald-300" : "text-slate-500"}`}>{registrationOpen ? "Registration open" : "Registration closed"}</p>
      <h3 className="overflow-wrap-anywhere mt-2 text-2xl text-white">{tournament.title}</h3>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-white/8 py-4 text-xs"><div><p className="text-slate-500">Prize pool</p><p className="mt-1 text-white">{tournament.prizePool || "TBA"}</p></div><div><p className="text-slate-500">Starts</p><p className="mt-1 text-white">{tournament.startDate ? new Date(tournament.startDate).toLocaleDateString() : "TBA"}</p></div></div>
      <Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ className: "mt-5 w-full" })}>View tournament</Link>
    </div>
  </Card>;
}

export default function HomeFoundation({ feed, serverNow, failed = false }: { feed: HomeFeed; serverNow: string; failed?: boolean }) {
  const featuredVideo = videoSections[0]?.videos.slice(0, 3) || [];
  const sponsors = Array.from(new Map(feed.featuredTournaments.flatMap((event) => event.sponsors).map((item) => [item.id, item])).values()).slice(0, 8);
  const registrationEvents = feed.featuredTournaments.filter((event) => event.registrationOpen);
  return <>
    <HomeHero nextMatch={feed.nextMatch} />

    <Section className="border-b border-white/8 bg-[#090b12]">
      <Heading eyebrow="Live operations" title="Next match" action={<Link href="/tournaments" className={buttonClassName({ variant: "secondary", size: "sm" })}>All fixtures</Link>} />
      {failed ? <Empty>Live match data is temporarily unavailable. Tournament pages and registration remain available.</Empty> : <Card className="p-5 sm:p-7"><MatchCountdown match={feed.nextMatch} serverNow={serverNow} /></Card>}
    </Section>

    <Section>
      <Heading eyebrow="Enter the competition" title="Registration status" />
      {registrationEvents.length ? <div className="grid gap-4 md:grid-cols-3">{registrationEvents.map((event) => <Link key={event.id} href={`/tournaments/${event.slug}`} className="border-l-2 border-emerald-300 bg-emerald-400/[0.06] p-5 transition hover:bg-emerald-400/10"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Accepting entries</p><h3 className="overflow-wrap-anywhere mt-2 text-xl text-white">{event.title}</h3><p className="mt-2 text-xs text-slate-400">{event.registrationDeadline ? `Closes ${new Date(event.registrationDeadline).toLocaleString()}` : "Deadline to be announced"}</p></Link>)}</div> : <Empty>No registration window is open right now. Check back for the next event announcement.</Empty>}
    </Section>

    <Section className="border-y border-white/8 bg-[#090b12]">
      <Heading eyebrow="Priority events" title="Featured tournaments" action={<Link href="/tournaments" className={buttonClassName({ variant: "secondary", size: "sm" })}>View all</Link>} />
      {feed.featuredTournaments.length ? <div className="grid gap-5 lg:grid-cols-3">{feed.featuredTournaments.map((event) => <TournamentCard key={event.id} tournament={event} />)}</div> : <Empty>New tournaments are being prepared. Browse the events archive in the meantime.</Empty>}
    </Section>

    <Section>
      <Heading eyebrow="Final scores" title="Recent results" />
      {feed.recentResults.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{feed.recentResults.map((match) => <MatchCard key={match.id} match={match} />)}</div> : <Empty>Completed match results will appear here.</Empty>}
    </Section>

    <Section className="border-y border-white/8 bg-[#090b12]">
      <Heading eyebrow="Coming up" title="Upcoming matches" />
      {feed.upcomingMatches.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{feed.upcomingMatches.map((match) => <MatchCard key={match.id} match={match} />)}</div> : <Empty>No upcoming fixtures have been scheduled.</Empty>}
    </Section>

    <Section>
      <Heading eyebrow="Community" title="Featured competitors" />
      {feed.featuredCompetitors.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{feed.featuredCompetitors.map((competitor) => <Link key={competitor.id} href={`/tournaments/${competitor.tournament.slug}`} className="min-w-0 border border-white/10 bg-[#11131b] p-4 text-center transition hover:border-blue-300/35"><div className="relative mx-auto size-16 overflow-hidden rounded-full border border-white/15 bg-[#171b27]">{competitor.logoUrl ? <Image src={buildApiUrl(competitor.logoUrl)} alt="" fill sizes="64px" className="object-cover" /> : <span className="flex h-full items-center justify-center text-xl font-bold text-slate-300">{competitor.displayName.slice(0, 2).toUpperCase()}</span>}</div><p className="overflow-wrap-anywhere mt-3 text-sm font-semibold text-white">{competitor.displayName}</p><p className="mt-1 truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{competitor.tournament.game}</p></Link>)}</div> : <Empty>Approved competitors will be featured here as event rosters are confirmed.</Empty>}
    </Section>

    <Section className="border-y border-white/8 bg-[#090b12]">
      <Heading eyebrow="Quest broadcast" title="Match videos" action={<Link href="/match-videos" className={buttonClassName({ variant: "secondary", size: "sm" })}>Video archive</Link>} />
      <div className="grid gap-4 md:grid-cols-3">{featuredVideo.map((video) => <a key={video.youtubeId} href={video.href} target="_blank" rel="noreferrer" className="group overflow-hidden border border-white/10 bg-[#11131b]"><div className="relative aspect-video"><Image src={`https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg`} alt={video.alt} fill sizes="(min-width:768px) 33vw, 100vw" className="object-cover transition duration-300 group-hover:scale-[1.02]" /></div><div className="p-4"><h3 className="overflow-wrap-anywhere text-lg text-white">{video.title}</h3><p className="mt-1 text-xs text-slate-400">{video.subtitle}</p></div></a>)}</div>
    </Section>

    <Section>
      <Heading eyebrow="Event partners" title="Sponsors" />
      {sponsors.length ? <div className="grid grid-cols-2 border-l border-t border-white/10 sm:grid-cols-4">{sponsors.map((sponsor) => { const content = <div className="flex min-h-32 flex-col items-center justify-center border-b border-r border-white/10 p-5 text-center">{sponsor.logoUrl ? <Image src={buildApiUrl(sponsor.logoUrl)} alt={sponsor.name} width={140} height={64} className="h-12 w-32 object-contain" /> : <strong className="text-lg text-white">{sponsor.name}</strong>}<span className="mt-3 text-[9px] uppercase tracking-[0.15em] text-slate-500">{sponsor.partnershipLabel || "Event partner"}</span></div>; return sponsor.websiteUrl ? <a key={sponsor.id} href={sponsor.websiteUrl} target="_blank" rel="noreferrer">{content}</a> : <div key={sponsor.id}>{content}</div>; })}</div> : <Empty>Partner announcements will appear alongside upcoming events.</Empty>}
    </Section>

    <Section className="border-t border-white/8 bg-[#101522] text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200">Ready for the lobby?</p><h2 className="mx-auto mt-3 max-w-3xl text-4xl text-white sm:text-5xl">Your next tournament starts here.</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-400">Create your account, assemble a team, and keep every registration and match time in one place.</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/register" className={buttonClassName({ size: "lg" })}>Create account</Link><Link href="/tournaments" className={buttonClassName({ size: "lg", variant: "secondary" })}>Browse events</Link></div>
    </Section>
  </>;
}
