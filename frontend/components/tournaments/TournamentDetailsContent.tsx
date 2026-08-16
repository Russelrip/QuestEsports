"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import MediaModal from "@/components/posters/MediaModal";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { resolveMediaUrl } from "@/lib/media";
import { formatSriLankaDateTime } from "@/lib/date-time";
import {
  BracketMatch,
  BracketParticipant,
  Tournament,
  TournamentEventMedia,
  TournamentBracketData,
  getTournamentRegistrationModeLabel,
} from "@/lib/tournaments";

const TEAMS_PER_PAGE = 10;
const MATCH_STATUS_LABELS: Record<number, string> = {
  0: "Locked",
  1: "Waiting",
  2: "Upcoming",
  3: "Live",
  4: "Completed",
  5: "Completed",
  6: "Paused",
};

export default function TournamentDetailsContent({ tournament, paymentCancelled = false }: { tournament: Tournament; paymentCancelled?: boolean }) {
  const [teamPagination, setTeamPagination] = useState({ tournamentId: tournament.id, page: 1 });
  const teamPage = teamPagination.tournamentId === tournament.id ? teamPagination.page : 1;
  const [activeTab, setActiveTab] = useState<"overview" | "rules" | "schedule" | "bracket" | "participants">("overview");
  const [loadedChallongeUrl, setLoadedChallongeUrl] = useState<string | null>(null);
  const isChallongeBracketLoaded = loadedChallongeUrl === tournament.challongeEmbedUrl;
  const participants = tournament.registeredParticipants || [];
  const teamPageCount = Math.max(1, Math.ceil(participants.length / TEAMS_PER_PAGE));
  const visibleParticipants = participants.slice(
    (teamPage - 1) * TEAMS_PER_PAGE,
    teamPage * TEAMS_PER_PAGE
  );

  return (
    <Section className="pt-5 sm:pt-7">
      <div className="space-y-5 tournament-print-root">
        <Link href="/tournaments" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-purple-200">
          <span aria-hidden="true">&larr;</span>
          Back to Tournaments
        </Link>

        {paymentCancelled ? (
          <Card className="border-amber-300/25 bg-amber-400/8 p-5">
            <p className="font-semibold text-amber-100">Online payment was cancelled.</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">Your tournament entry is not confirmed yet. Use the payment button below to retry while your reservation is still active.</p>
          </Card>
        ) : null}

        <section className="relative h-52 overflow-hidden border border-white/10 bg-black sm:h-auto sm:aspect-[16/5]">
          <h1 className="sr-only">{tournament.title}</h1>
          <TournamentBannerImage
            bannerUrl={tournament.heroUrl || tournament.bannerUrl}
            title={tournament.title}
            rounded={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </section>

        {tournament.isCompleted ? <CompletedTournamentShowcase tournament={tournament} /> : null}

        <nav className="relative flex gap-1 overflow-x-auto border border-white/10 bg-[#101118] p-1.5" aria-label="Tournament sections">
          {(["overview", "rules", "schedule", "bracket", "participants"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={`relative whitespace-nowrap border px-5 py-3 text-xs font-semibold capitalize transition sm:px-7 ${activeTab === tab ? "border-purple-300 bg-purple-300 text-[#120a1d]" : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white"}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <Card className="p-5 sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-purple-200">Tournament overview</p>
                <h2 className="mt-3 break-words text-3xl leading-tight text-white [overflow-wrap:anywhere] sm:text-4xl">{tournament.title}</h2>
                <p className="mt-5 whitespace-pre-line break-words text-sm leading-7 text-slate-300 [overflow-wrap:anywhere] sm:text-base sm:leading-8">
                  {tournament.fullDescription || tournament.shortDescription || "Tournament details will be announced soon."}
                </p>
              </Card>

              {tournament.sponsors?.length ? <SponsorsPanel tournament={tournament} /> : null}
              {tournament.eventMedia?.length ? <TournamentMediaPanel media={tournament.eventMedia} tournamentTitle={tournament.title} /> : null}
              {tournament.eventAlbums?.length ? <TournamentAlbumsPanel tournament={tournament} /> : null}
            </div>

            <TournamentOverviewSidebar tournament={tournament} />
          </div>
        ) : null}

        {activeTab === "participants" && participants.length > 0 ? (
          <TeamsPanel
            teams={visibleParticipants}
            totalTeams={participants.length}
            title={tournament.entryType === "solo" ? "Registered Players" : "Registered Teams"}
            isSolo={tournament.entryType === "solo"}
            page={teamPage}
            pageCount={teamPageCount}
            onPageChange={(page) => setTeamPagination({ tournamentId: tournament.id, page })}
          />
        ) : activeTab === "participants" ? (
          <Card className="p-6 sm:p-8"><h3 className="text-3xl text-white">Participants</h3><p className="mt-3 text-sm text-slate-400">Approved participants will appear here.</p></Card>
        ) : null}

        {tournament.challongeEmbedUrl ? (
          <section
            aria-hidden={activeTab !== "bracket"}
            className={activeTab === "bracket" ? "space-y-5" : "hidden"}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-3xl text-white">Brackets</h3>
              {tournament.bracketLink ? <a href={tournament.bracketLink} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })}>Open on Challonge</a> : null}
            </div>
            <div className="relative min-h-[760px] overflow-hidden bg-[#242424]">
              {!isChallongeBracketLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center" role="status">
                  <div className="flex items-center gap-3 text-sm font-semibold text-slate-300">
                    <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-purple-300" aria-hidden="true" />
                    Loading bracket...
                  </div>
                </div>
              ) : null}
              <iframe
                src={tournament.challongeEmbedUrl}
                title={`${tournament.title} Challonge bracket`}
                loading="eager"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setLoadedChallongeUrl(tournament.challongeEmbedUrl || null)}
                className={`block h-[760px] w-full border-0 transition-opacity duration-200 ${isChallongeBracketLoaded ? "opacity-100" : "opacity-0"}`}
              />
            </div>
          </section>
        ) : activeTab === "bracket" && tournament.bracketData ? (
          <section className="space-y-5">
            <h3 className="text-3xl text-white">Brackets</h3>
            <LiveBracketView bracketData={tournament.bracketData} />
          </section>
        ) : activeTab === "bracket" ? (
          <Card className="p-6 sm:p-8"><h3 className="text-3xl text-white">Bracket</h3><p className="mt-3 text-sm text-slate-400">The bracket will appear after it is published.</p></Card>
        ) : null}

        {activeTab === "schedule" ? <SchedulePanel tournament={tournament} /> : null}
        {activeTab === "rules" ? <RulesPanel tournament={tournament} /> : null}
      </div>
    </Section>
  );
}

function SponsorsPanel({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4 sm:px-7">
        <SectionHeading>Event sponsors</SectionHeading>
      </div>
      <div className="grid min-h-32 grid-cols-2 bg-[#17223c] sm:min-h-40 sm:grid-cols-3">
        {tournament.sponsors.map((sponsor) => {
          const logo = sponsor.logoUrl ? (
            <Image
              src={resolveMediaUrl(sponsor.logoUrl)}
              alt={sponsor.name}
              width={160}
              height={80}
              unoptimized
              className="h-16 w-36 object-contain"
            />
          ) : (
            <span className="text-2xl font-bold text-white">{sponsor.name.slice(0, 2).toUpperCase()}</span>
          );

          const content = (
            <>
              <p className="w-full text-center font-display text-sm font-bold uppercase tracking-[0.12em] text-white">
                {sponsor.partnershipLabel || "Official Sponsor"}
              </p>
              <div className="flex flex-1 items-center justify-center py-5">{logo}</div>
              <p className="w-full text-center font-display text-base font-bold uppercase tracking-[0.1em] text-white">{sponsor.name}</p>
            </>
          );
          const className = "flex min-h-48 flex-col border-r border-b border-white/8 p-4 text-center transition hover:bg-white/5";
          return sponsor.websiteUrl ? (
            <a key={sponsor.id} href={sponsor.websiteUrl} target="_blank" rel="noreferrer" aria-label={`Visit ${sponsor.name}`} className={className}>
              {content}
            </a>
          ) : (
            <div key={sponsor.id} className={className}>{content}</div>
          );
        })}
      </div>
    </Card>
  );
}

function TournamentOverviewSidebar({ tournament }: { tournament: Tournament }) {
  const rows = [
    { label: "Game", value: tournament.gameCategory?.displayName || toTitleCase(tournament.game) },
    { label: "Play type", value: tournament.format },
    { label: "Country", value: tournament.country || "TBD" },
    { label: "Location", value: tournament.location || "TBD" },
    { label: "Organizer", value: tournament.organizer },
    { label: "Prize pool", value: tournament.prizePool },
    { label: "Entry", value: getTournamentRegistrationModeLabel(tournament) },
    { label: "Registration fee", value: getRegistrationFee(tournament) },
    { label: "Slots", value: `${tournament.capacityUsed ?? tournament.registrationCount} / ${tournament.maxTeams}` },
    { label: "Start date", value: formatDateTime(tournament.startDate, tournament.startDateStatus) },
    { label: "End date", value: formatDateTime(tournament.endDate, tournament.endDateStatus) },
    { label: "Registration opens", value: formatDateTime(tournament.registrationOpenAt) },
    { label: "Registration closes", value: formatDateTime(tournament.registrationDeadline, tournament.registrationDeadlineStatus) },
    {
      label: "Bracket",
      value: (tournament.bracketSource && tournament.bracketSource !== "none") || tournament.bracketData || tournament.bracketLink ? "Published" : "To be announced",
    },
  ];

  return (
    <aside className="border border-white/10 bg-[#11131d] lg:sticky lg:top-24">
      <div className="border-b border-white/10 bg-[#0d0c13] px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-purple-200">Tournament information</p>
      </div>
      <dl className="p-2">
        {rows.map((row, index) => (
          <div key={row.label} className={`grid grid-cols-[118px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-[11px] ${index % 2 === 0 ? "bg-[#181b28]" : "bg-[#131621]"}`}>
            <dt className="uppercase tracking-[0.08em] text-slate-500">{row.label}</dt>
            <dd className="min-w-0 break-words font-semibold text-slate-200">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-white/10 p-4">
        {tournament.isCompleted ? (
          <div className="border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">Tournament Completed</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">Final results and the completed bracket are available above.</p>
          </div>
        ) : (
          <>
        <p className={`mb-3 text-xs font-semibold ${tournament.isRegistrationOpen ? "text-emerald-300" : "text-rose-300"}`}>
          {toTitleCase(tournament.registrationState.replace(/_/g, " "))}
        </p>
        <RegisterTournamentButton tournament={tournament} closedAsButton className="w-full [&_button]:w-full" />
          </>
        )}
      </div>
    </aside>
  );
}

function TournamentMediaPanel({ media, tournamentTitle }: { media: TournamentEventMedia[]; tournamentTitle: string }) {
  const [selected, setSelected] = useState<TournamentEventMedia | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/10 p-5 sm:p-6">
        <SectionHeading>Event media</SectionHeading>
        <p className="mt-2 text-sm text-slate-400">Official posters, schedules, results, and promotional artwork.</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/10 lg:grid-cols-3">
        {media.map((item) => (
          <button key={item.id} type="button" onClick={() => setSelected(item)} className="group min-w-0 bg-[#0b0a0f] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300">
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image src={resolveMediaUrl(item.imageUrl)} alt={item.title} fill sizes="(min-width: 1024px) 20vw, 45vw" className="object-contain p-2 transition duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" />
            </div>
            <p className="truncate border-t border-white/10 px-3 py-3 text-xs font-semibold uppercase tracking-[0.05em] text-slate-200">{item.title}</p>
          </button>
        ))}
      </div>
      {selected ? (
        <MediaModal ariaLabel={`${selected.title} preview`} onClose={() => setSelected(null)}>
          <div className="relative min-h-0 flex-1">
            <Image src={resolveMediaUrl(selected.imageUrl)} alt={selected.title} fill sizes="90vw" className="object-contain" />
          </div>
          <div className="mt-4 shrink-0">
            <p className="text-xl font-semibold text-white">{selected.title}</p>
            {selected.description ? <p className="mt-2 text-sm text-slate-400">{selected.description}</p> : null}
            <p className="mt-2 text-xs text-slate-500">{tournamentTitle}</p>
          </div>
        </MediaModal>
      ) : null}
    </Card>
  );
}

function TournamentAlbumsPanel({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading>Event photos</SectionHeading>
      <p className="mt-2 text-sm text-slate-400">Browse photography from this tournament.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {tournament.eventAlbums.map((album) => (
          <Link key={album.id} href={`/gallery/${album.slug}`} className="group overflow-hidden border border-white/10 bg-black/20 outline-none transition hover:border-purple-300/35 focus-visible:ring-2 focus-visible:ring-purple-300">
            <div className="grid aspect-[16/9] grid-cols-2 gap-px bg-white/10">
              {album.photos.slice(0, 2).map((photo) => (
                <div key={photo.id} className="relative overflow-hidden bg-black">
                  <Image src={resolveMediaUrl(photo.imageUrl)} alt={photo.caption || `${album.title} event photo`} fill sizes="(min-width: 640px) 25vw, 50vw" className="object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <p className="min-w-0 truncate font-semibold text-white">{album.title}</p>
              <span className="shrink-0 text-xs text-purple-200">{album.photoCount} photos</span>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function CompletedTournamentShowcase({ tournament }: { tournament: Tournament }) {
  const standings = new Map((tournament.resultSummary?.standings || []).map((standing) => [standing.rank, standing]));
  const champion = standings.get(1);
  const podium = [
    { rank: 1, label: "Champion", imageUrl: tournament.showcase.firstPlaceUrl, standing: standings.get(1) },
    { rank: 2, label: "Runner-up", imageUrl: tournament.showcase.secondPlaceUrl, standing: standings.get(2) },
    { rank: 3, label: "Third place", imageUrl: tournament.showcase.thirdPlaceUrl, standing: standings.get(3) },
  ].filter((place) => place.imageUrl || place.standing);

  return (
    <section className="overflow-hidden border border-amber-300/20 bg-[#100d13]" aria-labelledby="tournament-results-heading">
      <div className={`grid ${tournament.showcase.posterUrl ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)]" : ""}`}>
        <div className="relative flex min-h-64 flex-col justify-center overflow-hidden p-6 sm:p-9">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(251,191,36,0.16),transparent_38%),linear-gradient(120deg,rgba(168,85,247,0.1),transparent_55%)]" />
          <div className="relative">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-200">Tournament completed</p>
            <h2 id="tournament-results-heading" className="mt-3 text-3xl uppercase text-white sm:text-5xl">The tournament is over</h2>
            {champion ? (
              <div className="mt-7 flex min-w-0 items-center gap-4">
                <ResultLogo name={champion.name} logoUrl={champion.logoUrl} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">Champion</p>
                  <p className="mt-1 break-words text-2xl font-bold text-white sm:text-3xl">{champion.name}</p>
                </div>
              </div>
            ) : (
              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300">Final results have been recorded. View the bracket for every completed match.</p>
            )}
          </div>
        </div>
        {tournament.showcase.posterUrl ? (
          <div className="relative min-h-72 border-t border-white/10 lg:border-l lg:border-t-0">
            <Image src={resolveMediaUrl(tournament.showcase.posterUrl)} alt={`${tournament.title} completed tournament poster`} fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
          </div>
        ) : null}
      </div>

      {podium.length ? (
        <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3">
          {podium.map((place) => (
            <article key={place.rank} className="min-w-0 bg-[#121018]">
              {place.imageUrl ? (
                <div className="relative aspect-square overflow-hidden">
                  <Image src={resolveMediaUrl(place.imageUrl)} alt={`${place.label}${place.standing ? ` - ${place.standing.name}` : ""}`} fill sizes="(min-width: 640px) 33vw, 100vw" className="object-cover" />
                </div>
              ) : null}
              <div className="flex min-w-0 items-center gap-3 p-4 sm:p-5">
                <span className={`flex size-10 shrink-0 items-center justify-center border font-bold ${place.rank === 1 ? "border-amber-300/40 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-300"}`}>{place.rank}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{place.label}</p>
                  <p className="mt-1 break-words font-semibold text-white">{place.standing?.name || "Official result"}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ResultLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden border border-amber-300/30 bg-black/30 sm:size-20">
      {logoUrl ? <Image src={resolveMediaUrl(logoUrl)} alt="" fill sizes="80px" className="object-cover" /> : <span className="text-xl font-bold text-amber-100">{name.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="border-l-2 border-purple-300 pl-3 text-xl uppercase tracking-[0.08em] text-white sm:text-2xl">
      {children}
    </h3>
  );
}

function getRegistrationFee(tournament: Tournament) {
  if (!tournament.registrationFee?.amount) return "Free";
  if (!tournament.registrationFeeTiers?.length) {
    return `${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toFixed(2)}`;
  }

  const amounts = tournament.registrationFeeTiers.map((tier) => tier.amount);
  return `${tournament.registrationFee.currency} ${Math.min(...amounts).toFixed(2)}-${Math.max(...amounts).toFixed(2)}`;
}

function TeamsPanel({
  teams,
  totalTeams,
  title,
  page,
  pageCount,
  onPageChange,
  isSolo,
}: {
  teams: Tournament["registeredParticipants"];
  totalTeams: number;
  title: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  isSolo: boolean;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-3xl text-white">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams?.map((team) => (
          <div key={team.id} className="overflow-hidden border border-white/10 bg-[#12141d]">
            <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-[#171922]">
              {team.avatarUrl || team.logoUrl ? (
                <Image
                  src={resolveMediaUrl(team.avatarUrl || team.logoUrl || "")}
                  alt={team.displayName}
                  fill
                  sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <div className="relative flex size-24 items-center justify-center overflow-hidden border border-white/10 bg-[#20222c] text-2xl font-bold text-white">
                  {team.shortCode}
                </div>
              )}
            </div>
            <div className="border-t border-white/10 bg-[#20232f] px-4 py-3">
              <p className="truncate text-center text-sm font-bold uppercase text-white">{team.displayName}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {(page - 1) * TEAMS_PER_PAGE + 1}-{Math.min(page * TEAMS_PER_PAGE, totalTeams)} of {totalTeams} {isSolo ? "players" : "teams"}
        </span>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
          <button className="rounded-lg border border-white/10 px-4 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </button>
          <span className="whitespace-nowrap text-center font-semibold text-white">Page {page} / {pageCount}</span>
          <button className="rounded-lg border border-white/10 px-4 py-2 disabled:opacity-40" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function SchedulePanel({ tournament }: { tournament: Tournament }) {
  const schedule = tournament.scheduleData;
  if (!schedule || schedule.headers.length === 0 || schedule.rows.length === 0) {
    return (
      <Card className="p-6 sm:p-8">
        <h3 className="text-3xl text-white">Schedule</h3>
        <p className="mt-3 text-sm text-slate-400">The match schedule will be published here when it is ready.</p>
      </Card>
    );
  }

  return (
    <details open className="group overflow-hidden border border-white/10 bg-[#101118]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-white/10 bg-[#171821] px-4 py-4 text-white [&::-webkit-details-marker]:hidden sm:px-5">
        <span className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center border border-white/10 bg-[#22242d] text-slate-300" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
            </svg>
          </span>
          <span>
            <span className="block text-xs font-bold uppercase tracking-[0.18em] text-white sm:text-sm">Match Schedule</span>
            <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">Tournament schedule</span>
          </span>
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center border border-white/10 bg-[#101118] text-slate-400 transition duration-200 group-open:rotate-180" aria-hidden="true">
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 7.5 5 5 5-5" /></svg>
        </span>
      </summary>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#13141c] px-4 py-3 sm:px-5">
        <p className="truncate text-sm font-semibold text-slate-200">{schedule.sheetName}</p>
        <span className="border border-white/10 bg-[#1c1e27] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {schedule.rows.length} {schedule.rows.length === 1 ? "match" : "matches"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs sm:text-sm">
          <caption className="sr-only">{schedule.sheetName}</caption>
          <thead className="bg-[#1b1c24] text-[10px] uppercase tracking-[0.12em] text-slate-300 sm:text-[11px]">
            <tr>
              {schedule.headers.map((header) => (
                <th key={header} scope="col" className="whitespace-nowrap border-b border-white/10 px-4 py-3.5 font-bold first:pl-5 last:pr-5">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.055]">
            {schedule.rows.map((row, index) => (
              <tr key={index} className="bg-[#101118] transition-colors odd:bg-[#14151d] hover:bg-[#1a1b24]">
                {schedule.headers.map((header, headerIndex) => (
                  <td key={header} className={`whitespace-nowrap px-4 py-3 text-slate-300 first:pl-5 last:pr-5 ${headerIndex === 0 ? "font-semibold text-white" : ""}`}>
                    {row[header] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 bg-[#13141c] px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-slate-500 sm:hidden">
        <span>Swipe to view</span>
        <span aria-hidden="true">← →</span>
      </div>
    </details>
  );
}

function RulesPanel({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="p-6 sm:p-8">
      <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Competition Rules</p>
      <h3 className="mt-3 text-3xl text-white">{tournament.rulebook?.title || `${tournament.title} rules`}</h3>
      <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-300">
        {tournament.rules || "Use the official tournament rulebook for eligibility, match procedure, conduct, and dispute rules."}
      </p>
      {tournament.rulebook ? (
        <Link href={`/rulebooks/${tournament.rulebook.slug}`} className={buttonClassName({ variant: "secondary", className: "mt-6" })}>
          Open full rulebook
        </Link>
      ) : null}
    </Card>
  );
}

function LiveBracketView({
  bracketData,
}: {
  bracketData: TournamentBracketData;
}) {
  const participants = new Map(bracketData.participant.map((participant) => [participant.id, participant]));
  const groupedRounds = bracketData.group.map((group) => {
    const groupRounds = bracketData.round
      .filter((round) => round.group_id === group.id)
      .sort((left, right) => left.number - right.number)
      .map((round) => ({
        ...round,
        matches: bracketData.match
          .filter((match) => match.round_id === round.id)
          .sort((left, right) => left.number - right.number),
      }))
      .filter((round) => round.matches.length > 0);

    return {
      group,
      label: getGroupLabel(group.number),
      tone: getGroupTone(group.number),
      rounds: groupRounds,
    };
  }).filter((group) => group.rounds.length > 0);

  return (
    <div className="overflow-hidden rounded-sm border border-[#454545] bg-[#303030] text-white tournament-print-bracket">
      <div className="overflow-x-auto border-y border-[#454545] bg-[#383838] text-[11px] font-bold text-slate-200">
        <div className="flex min-w-max items-center justify-between">
        <div className="flex min-w-0 flex-1">
          {groupedRounds[0]?.rounds.slice(0, 6).map((round) => (
            <div key={round.id} className="w-[210px] shrink-0 border-r border-[#444] px-3 py-2 text-center">
              {getRoundLabel(groupedRounds[0].group.number, round.number)}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-l border-[#444] px-3 py-2 text-slate-300">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> LIVE</span>
          <span>FULL BRACKET</span>
        </div>
        </div>
      </div>

      <div className="max-h-[70vh] touch-pan-x overflow-auto bg-[#303030] p-4 sm:max-h-[820px] sm:p-5">
        <div
          className="grid origin-top-left gap-12"
          style={{
            transform: "scale(0.85)",
            width: `${10000 / 85}%`,
          }}
        >
          {groupedRounds.map((group) => (
            <div key={group.group.id} className="min-w-[900px]">
              <div className={`mb-3 border-t-2 pt-2 text-sm font-bold ${group.tone.border} ${group.tone.text}`}>
                {group.label}
              </div>
              <div className="flex items-start gap-8">
                {group.rounds.map((round) => (
                  <div key={round.id} className="w-[210px] shrink-0">
                    <p className="mb-4 bg-[#3a3a3a] px-3 py-2 text-center text-[11px] font-bold text-slate-200">
                      {getRoundLabel(group.group.number, round.number)}
                    </p>
                    <div className="grid gap-7">
                      {round.matches.map((match) => (
                        <MatchCard key={match.id} match={match} participants={participants} groupNumber={group.group.number} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  participants,
  groupNumber,
}: {
  match: BracketMatch;
  participants: Map<number, BracketParticipant>;
  groupNumber: number;
}) {
  const tone = getGroupTone(groupNumber);
  const status = MATCH_STATUS_LABELS[match.status] || "Pending";

  return (
    <div className="relative pl-5">
      <span className="absolute left-0 top-7 text-[11px] text-slate-400">{match.id + 1}</span>
      <div className="absolute left-[calc(100%+2px)] top-1/2 hidden h-px w-8 bg-[#9a9a9a] xl:block" />
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-slate-300">
        <span>{status}</span>
        <span className={tone.text}>{getGroupLabel(groupNumber)}</span>
      </div>
      <div className="overflow-hidden rounded-[2px]">
        <OpponentRow opponent={match.opponent1} participants={participants} />
        <OpponentRow opponent={match.opponent2} participants={participants} />
      </div>
    </div>
  );
}

function OpponentRow({
  opponent,
  participants,
}: {
  opponent: BracketMatch["opponent1"];
  participants: Map<number, BracketParticipant>;
}) {
  const participant = opponent?.id !== null && opponent?.id !== undefined ? participants.get(opponent.id) : null;
  const won = opponent?.result === "win";

  return (
    <div className={`flex h-7 items-center text-[11px] ${won ? "bg-[#777]" : "bg-[#666]"}`}>
      <span className="min-w-0 flex-1 truncate px-2 font-semibold text-white">{participant?.name || "TBD"}</span>
      <span className={`${won ? "bg-[#ff8a45] text-[#222]" : "bg-[#8a8a8a] text-white"} flex h-full w-8 items-center justify-center font-bold`}>
        {opponent?.score ?? ""}
      </span>
    </div>
  );
}

function getGroupLabel(groupNumber: number) {
  if (groupNumber === 1) return "Winners Bracket";
  if (groupNumber === 2) return "Elimination Bracket";
  return "Finals Route";
}

function getGroupTone(groupNumber: number) {
  if (groupNumber === 1) {
    return { text: "text-orange-300", border: "border-orange-400" };
  }
  if (groupNumber === 2) {
    return { text: "text-red-300", border: "border-red-400" };
  }
  return { text: "text-yellow-200", border: "border-yellow-300" };
}

function getRoundLabel(groupNumber: number, roundNumber: number) {
  if (groupNumber === 3) {
    return roundNumber > 1 ? "Reset Final" : "Grand Final";
  }

  return `Round ${roundNumber}`;
}

function formatDateTime(value?: string | null, status: Tournament["startDateStatus"] = "scheduled") {
  if (status === "tba") return "TBA";
  if (status === "tbd") return "TBD";
  if (!value) return "TBD";

  return formatSriLankaDateTime(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
