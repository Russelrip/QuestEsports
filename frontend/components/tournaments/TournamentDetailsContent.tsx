"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { resolveMediaUrl } from "@/lib/media";
import {
  BracketMatch,
  BracketParticipant,
  Tournament,
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

export default function TournamentDetailsContent({ tournament }: { tournament: Tournament }) {
  const [teamPagination, setTeamPagination] = useState({ tournamentId: tournament.id, page: 1 });
  const teamPage = teamPagination.tournamentId === tournament.id ? teamPagination.page : 1;
  const [activeTab, setActiveTab] = useState<"overview" | "rules" | "schedule" | "bracket" | "participants">("overview");
  const participants = tournament.registeredParticipants || [];
  const teamPageCount = Math.max(1, Math.ceil(participants.length / TEAMS_PER_PAGE));
  const visibleParticipants = participants.slice(
    (teamPage - 1) * TEAMS_PER_PAGE,
    teamPage * TEAMS_PER_PAGE
  );

  return (
    <Section className="pt-5 sm:pt-7">
      <div className="space-y-5 tournament-print-root">
        <Link href="/tournaments" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-cyan-200">
          <span aria-hidden="true">&larr;</span>
          Back to Tournaments
        </Link>

        <section className="relative h-52 overflow-hidden border border-white/10 bg-black sm:h-auto sm:aspect-[16/5]">
          <h1 className="sr-only">{tournament.title}</h1>
          <TournamentBannerImage
            bannerUrl={tournament.heroUrl || tournament.bannerUrl}
            title={tournament.title}
            rounded={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </section>

        <nav className="flex gap-0 overflow-x-auto border border-white/10 bg-[#0d0c13]" aria-label="Tournament sections">
          {(["overview", "rules", "schedule", "bracket", "participants"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={`whitespace-nowrap border-r border-white/8 px-5 py-3 text-xs font-semibold capitalize transition sm:px-7 ${activeTab === tab ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <Card className="p-5 sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">Tournament overview</p>
                <h2 className="mt-3 text-3xl leading-tight text-white sm:text-4xl">{tournament.title}</h2>
                <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-300 sm:text-base sm:leading-8">
                  {tournament.fullDescription || tournament.shortDescription || "Tournament details will be announced soon."}
                </p>
              </Card>

              {tournament.sponsors?.length ? <SponsorsPanel tournament={tournament} /> : null}
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

        {activeTab === "bracket" && tournament.challongeEmbedUrl ? (
          <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-3xl text-white">Brackets</h3>{tournament.bracketLink ? <a href={tournament.bracketLink} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })}>Open on Challonge</a> : null}</div><div className="overflow-hidden bg-[#242424]"><iframe src={tournament.challongeEmbedUrl} title={`${tournament.title} Challonge bracket`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" className="block h-[760px] w-full border-0" /></div></section>
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
              className="h-16 w-36 object-contain"
            />
          ) : (
            <span className="text-center font-semibold text-white">{sponsor.name}</span>
          );

          const className = "flex min-h-32 items-center justify-center border-r border-b border-white/8 p-5 transition hover:bg-white/5 sm:min-h-40";
          return sponsor.websiteUrl ? (
            <a key={sponsor.id} href={sponsor.websiteUrl} target="_blank" rel="noreferrer" aria-label={`Visit ${sponsor.name}`} className={className}>
              {logo}
            </a>
          ) : (
            <div key={sponsor.id} className={className}>{logo}</div>
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
    { label: "Slots", value: `${tournament.registrationCount} / ${tournament.maxTeams}` },
    { label: "Start date", value: formatDateTime(tournament.startDate, tournament.startDateStatus) },
    { label: "End date", value: formatDateTime(tournament.endDate, tournament.endDateStatus) },
    { label: "Registration opens", value: formatDateTime(tournament.registrationOpenAt) },
    { label: "Registration closes", value: formatDateTime(tournament.registrationDeadline, tournament.registrationDeadlineStatus) },
    {
      label: "Bracket",
      value: tournament.bracketData || tournament.challongeEmbedUrl || tournament.bracketLink ? "Published" : "To be announced",
    },
  ];

  return (
    <aside className="border border-white/10 bg-[#11131d] lg:sticky lg:top-24">
      <div className="border-b border-white/10 bg-[#0d0c13] px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">Tournament information</p>
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
        <p className={`mb-3 text-xs font-semibold ${tournament.isRegistrationOpen ? "text-emerald-300" : "text-rose-300"}`}>
          {toTitleCase(tournament.registrationState.replace(/_/g, " "))}
        </p>
        <RegisterTournamentButton tournament={tournament} closedAsButton className="w-full [&_button]:w-full" />
      </div>
    </aside>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="border-l-2 border-cyan-300 pl-3 text-xl uppercase tracking-[0.08em] text-white sm:text-2xl">
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
            <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_40%,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,#171126,#0a0d16)]">
              <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:28px_28px]" />
              <div className="relative flex size-24 items-center justify-center overflow-hidden border border-white/10 bg-black/30 text-2xl font-bold text-white shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
                {team.avatarUrl || team.logoUrl ? (
                  <Image
                    src={resolveMediaUrl(team.avatarUrl || team.logoUrl || "")}
                    alt={team.displayName}
                    fill
                    sizes="96px"
                    className="object-contain p-2"
                  />
                ) : (
                  team.shortCode
                )}
              </div>
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
    <section className="space-y-4">
      <div>
        <h3 className="text-3xl text-white">Schedule</h3>
        <p className="mt-2 text-sm text-slate-400">{schedule.sheetName}</p>
      </div>
      <div className="overflow-x-auto rounded-[24px] border border-white/10 bg-[#111827]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#263451] text-xs uppercase tracking-[0.12em] text-white">
            <tr>{schedule.headers.map((header) => <th key={header} className="whitespace-nowrap px-4 py-4">{header}</th>)}</tr>
          </thead>
          <tbody>
            {schedule.rows.map((row, index) => (
              <tr key={index} className="border-t border-white/8 odd:bg-white/[0.025]">
                {schedule.headers.map((header) => <td key={header} className="whitespace-nowrap px-4 py-3 text-slate-300">{row[header] || "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RulesPanel({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="p-6 sm:p-8">
      <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Competition Rules</p>
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
    <div className="overflow-hidden rounded-sm border border-[#454545] bg-[#303030] text-white shadow-[0_20px_70px_rgba(0,0,0,0.35)] tournament-print-bracket">
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
      <div className="overflow-hidden rounded-[2px] shadow-[0_2px_0_rgba(0,0,0,0.25)]">
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

  return new Date(value).toLocaleString(undefined, {
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
