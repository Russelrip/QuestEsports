"use client";
/* eslint-disable @next/next/no-img-element */

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
  const [teamPage, setTeamPage] = useState(1);
  const registeredTeams = tournament.registeredTeams || [];
  const teamPageCount = Math.max(1, Math.ceil(registeredTeams.length / TEAMS_PER_PAGE));
  const visibleTeams = registeredTeams.slice(
    (teamPage - 1) * TEAMS_PER_PAGE,
    teamPage * TEAMS_PER_PAGE
  );

  return (
    <Section className="pt-6">
      <div className="space-y-8 tournament-print-root">
        <Link href="/tournaments" className="inline-flex text-sm text-slate-400 transition hover:text-white">
          Back to Tournaments
        </Link>

        <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(18,18,27,0.94),rgba(8,8,15,0.96))] p-4 sm:p-6 xl:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#100817]">
              <TournamentBannerImage
                bannerUrl={tournament.bannerUrl}
                title={tournament.title}
                className="h-full min-h-[340px] w-full object-cover sm:min-h-[520px]"
              />
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div className="space-y-6">
                <header>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.32em] text-fuchsia-200/80">
                      {toTitleCase(tournament.game)}
                    </p>
                  </div>
                  <h2 className="mt-4 text-4xl leading-tight text-white sm:text-5xl">
                    {tournament.title}
                  </h2>
                  <p className="mt-4 text-sm text-slate-400">
                    Tournament status: {toTitleCase(tournament.status.replace(/_/g, " "))}
                  </p>
                  <p className="mt-6 max-w-4xl text-base leading-8 text-slate-300">
                    {tournament.fullDescription || tournament.shortDescription || "Tournament information will be updated soon."}
                  </p>
                </header>

                <StatsGrid tournament={tournament} />
              </div>

              <footer className="flex flex-wrap gap-3 border-t border-white/10 pt-6">
                  <Link
                    href="/rulebook"
                    className={buttonClassName({
                      variant: "secondary",
                      className: "border-white/14 bg-transparent hover:border-white/20 hover:bg-white/6",
                    })}
                  >
                    Rulebook
                  </Link>
                  <RegisterTournamentButton tournament={tournament} closedAsButton />
              </footer>
            </div>
          </div>
        </Card>

        {registeredTeams.length > 0 ? (
          <TeamsPanel
            teams={visibleTeams}
            totalTeams={registeredTeams.length}
            page={teamPage}
            pageCount={teamPageCount}
            onPageChange={setTeamPage}
          />
        ) : null}

        {tournament.bracketData ? (
          <section className="space-y-5">
            <h3 className="text-3xl text-white">Brackets</h3>
            <LiveBracketView bracketData={tournament.bracketData} />
          </section>
        ) : null}
      </div>
    </Section>
  );
}

function StatsGrid({ tournament }: { tournament: Tournament }) {
  const stats = getTournamentDetailStats(tournament);

  return (
    <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <p className="text-[11px] tracking-[0.14em] text-slate-400">{stat.label}</p>
          <p className="mt-3 text-lg font-semibold text-white">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function getTournamentDetailStats(tournament: Tournament) {
  return [
    { label: "Prize Pool", value: tournament.prizePool },
    { label: "Format", value: tournament.format },
    { label: "Team Size", value: `${tournament.teamSize}v${tournament.teamSize}` },
    { label: "Registration Deadline", value: formatDateTime(tournament.registrationDeadline) },
    {
      label: "Bracket Release",
      value: tournament.bracketSummary?.lastUpdatedAt
        ? formatDateTime(tournament.bracketSummary.lastUpdatedAt)
        : "To be announced",
    },
    { label: "Tournament Start", value: formatDateTime(tournament.startDate) },
  ];
}

function TeamsPanel({
  teams,
  totalTeams,
  page,
  pageCount,
  onPageChange,
}: {
  teams: Tournament["registeredTeams"];
  totalTeams: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-3xl text-white">Registered Teams</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams?.map((team) => (
          <div key={team.id} className="rounded-xl border border-blue-300/20 bg-[#0d1626] p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-white text-sm font-bold text-black">
                {team.logoUrl ? (
                  <img src={resolveMediaUrl(team.logoUrl)} alt={team.teamName} className="h-full w-full object-cover" />
                ) : (
                  team.shortCode
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{team.teamName}</p>
                <p className="text-xs text-slate-400">
                  {team.shortCode} - {team.memberCount} members
                </p>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {(page - 1) * TEAMS_PER_PAGE + 1}-{Math.min(page * TEAMS_PER_PAGE, totalTeams)} of {totalTeams} teams
        </span>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-white/10 px-4 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </button>
          <span className="font-semibold text-white">Page {page} / {pageCount}</span>
          <button className="rounded-lg border border-white/10 px-4 py-2 disabled:opacity-40" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
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
      <div className="flex items-center justify-between border-y border-[#454545] bg-[#383838] text-[11px] font-bold text-slate-200">
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

      <div className="max-h-[820px] overflow-auto bg-[#303030] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.075)_1px,transparent_0)] p-5 [background-size:6px_6px]">
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

function formatDateTime(value?: string | null) {
  if (!value) {
    return "To be announced";
  }

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
