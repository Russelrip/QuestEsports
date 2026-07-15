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
    <Section className="pt-6">
      <div className="space-y-8 tournament-print-root">
        <Link href="/tournaments" className="inline-flex text-sm text-slate-400 transition hover:text-white">
          Back to Tournaments
        </Link>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#0d0c13] p-2" aria-label="Tournament sections">
          {(["overview", "rules", "schedule", "bracket", "participants"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-xl px-4 py-3 text-sm font-semibold capitalize transition ${activeTab === tab ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab === "overview" ? <div className="space-y-6"><section className={`relative min-h-[520px] overflow-hidden rounded-[34px] border bg-black ${tournament.isRegistrationOpen ? "border-white/10" : "border-rose-500/45"}`}>
          <TournamentBannerImage bannerUrl={tournament.heroUrl || tournament.bannerUrl} title={tournament.title} className="absolute inset-0 h-full w-full object-cover opacity-80" />
          <span className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/20" />
          <div className="relative z-10 flex min-h-[520px] max-w-3xl flex-col justify-end p-6 sm:p-10">
            <div className="flex items-center gap-4">{tournament.gameCategory?.logoUrl ? <Image src={resolveMediaUrl(tournament.gameCategory.logoUrl)} alt={`${tournament.gameCategory.displayName} logo`} width={96} height={64} className="h-14 w-24 object-contain" /> : null}<p className="text-xs uppercase tracking-[0.3em] text-cyan-200">{tournament.gameCategory?.displayName || toTitleCase(tournament.game)}</p></div>
            <h2 className="mt-4 text-4xl leading-tight text-white sm:text-6xl">{tournament.title}</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">{tournament.shortDescription}</p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300"><b className="text-white">{tournament.prizePool}</b><span>{tournament.organizer}</span><span>{tournament.country} · {tournament.location}</span><span className={tournament.isRegistrationOpen ? "text-emerald-300" : "text-rose-300"}>{toTitleCase(tournament.registrationState.replace(/_/g, " "))}</span></div>
            <div className="mt-6"><RegisterTournamentButton tournament={tournament} closedAsButton /></div>
          </div>
        </section>
        {tournament.sponsors?.length ? <Card className="p-5"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">Official sponsors</p><div className="mt-4 flex flex-wrap items-center gap-6">{tournament.sponsors.map((sponsor) => { const logo = sponsor.logoUrl ? <Image src={resolveMediaUrl(sponsor.logoUrl)} alt={sponsor.name} width={140} height={64} className="h-14 w-32 object-contain" /> : <span className="font-semibold text-white">{sponsor.name}</span>; return sponsor.websiteUrl ? <a key={sponsor.id} href={sponsor.websiteUrl} target="_blank" rel="noreferrer" aria-label={`Visit ${sponsor.name}`}>{logo}</a> : <div key={sponsor.id}>{logo}</div>; })}</div></Card> : null}
        <Card className="p-6 sm:p-8"><p className="whitespace-pre-line text-sm leading-8 text-slate-300 sm:text-base">{tournament.fullDescription || tournament.shortDescription}</p><div className="mt-8"><StatsGrid tournament={tournament} /></div></Card></div> : null}

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
          <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-3xl text-white">Brackets</h3>{tournament.bracketLink ? <a href={tournament.bracketLink} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })}>Open on Challonge</a> : null}</div><div className="overflow-hidden rounded-2xl border border-white/10 bg-white"><iframe src={tournament.challongeEmbedUrl} title={`${tournament.title} Challonge bracket`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" className="h-[760px] w-full" /></div></section>
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

function StatsGrid({ tournament }: { tournament: Tournament }) {
  const stats = getTournamentDetailStats(tournament);

  return (
    <div className="grid min-w-0 gap-x-10 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <p className="text-[11px] tracking-[0.14em] text-slate-400">{stat.label}</p>
          <p className="mt-3 break-words text-lg font-semibold text-white [overflow-wrap:anywhere]">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function getTournamentDetailStats(tournament: Tournament) {
  return [
    { label: "Prize Pool", value: tournament.prizePool },
    { label: "Format", value: tournament.format },
    { label: "Entry", value: getTournamentRegistrationModeLabel(tournament) },
    {
      label: tournament.entryType === "solo" ? "Entry Type" : "Roster",
      value:
        tournament.entryType === "solo"
          ? "Solo player"
          : `${tournament.minRosterSize || tournament.teamSize}-${(tournament.maxRosterSize || tournament.teamSize) + (tournament.maxSubstitutes || 0)} players`,
    },
    {
      label: "Registration Fee",
      value:
        tournament.registrationFee?.amount > 0
          ? tournament.registrationFeeTiers?.length
            ? `${tournament.registrationFee.currency} ${Math.min(...tournament.registrationFeeTiers.map((tier) => tier.amount)).toFixed(2)}–${Math.max(...tournament.registrationFeeTiers.map((tier) => tier.amount)).toFixed(2)} by slot`
            : `${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toFixed(2)}`
          : "Free",
    },
    { label: "Registration Deadline", value: formatDateTime(tournament.registrationDeadline, tournament.registrationDeadlineStatus) },
    {
      label: "Bracket Release",
      value: tournament.bracketSummary?.lastUpdatedAt
        ? formatDateTime(tournament.bracketSummary.lastUpdatedAt)
        : "To be announced",
    },
    { label: "Tournament Start", value: formatDateTime(tournament.startDate, tournament.startDateStatus) },
  ];
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
          <div key={team.id} className="rounded-xl border border-blue-300/20 bg-[#0d1626] p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-white text-sm font-bold text-black">
                {team.avatarUrl || team.logoUrl ? (
                  <Image
                    src={resolveMediaUrl(team.avatarUrl || team.logoUrl || "")}
                    alt={team.displayName}
                    width={48}
                    height={48}
                    sizes="48px"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  team.shortCode
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{team.displayName}</p>
                <p className="text-xs text-slate-400">
                  {isSolo ? "Solo player" : `Captain ${team.captainName} · ${team.memberCount} members`}
                </p>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
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
