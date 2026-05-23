"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import TournamentInfoList from "@/components/tournaments/TournamentInfoList";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { Tournament, getTournamentRegistrationLabel, getTournamentStatusLabel } from "@/lib/tournaments";
import { formatDisplayDate } from "@/lib/utils";

const gameOptions = [
  { value: "all", label: "All Games" },
  { value: "valorant", label: "Valorant" },
  { value: "pubg-mobile", label: "PUBG Mobile" },
  { value: "cod-mobile", label: "Call of Duty: Mobile" },
  { value: "free-fire", label: "Free Fire" },
  { value: "dota-2", label: "Dota 2" },
  { value: "mobile-legends", label: "Mobile Legends" },
  { value: "ea-fc", label: "EA FC" },
];

export default function TournamentsContent({ tournaments }: { tournaments: Tournament[] }) {
  const [gameFilter, setGameFilter] = useState("all");

  const filteredTournaments = useMemo(() => {
    if (gameFilter === "all") {
      return tournaments;
    }

    return tournaments.filter((tournament) => tournament.game === gameFilter);
  }, [gameFilter, tournaments]);

  return (
    <Section className="pt-6">
      <div className="mb-8 flex flex-col gap-4 rounded-[28px] border border-white/8 bg-white/5 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Tournament board</p>
          <h2 className="mt-2 text-2xl text-white">Browse events by title, status, and registration window.</h2>
        </div>
        <div className="w-full max-w-xs">
          <label htmlFor="gameFilter" className="mb-2 block text-sm font-medium text-slate-300">
            Filter by game
          </label>
          <Select id="gameFilter" value={gameFilter} onChange={(event) => setGameFilter(event.target.value)}>
            {gameOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filteredTournaments.length > 0 ? (
        <div className="grid gap-6">
          {filteredTournaments.map((tournament) => (
            <article
              key={tournament.id}
              className="group grid gap-7 overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,30,0.94),rgba(7,7,14,0.98))] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.3)] transition duration-300 hover:border-fuchsia-300/20 hover:shadow-[0_34px_90px_rgba(27,15,69,0.55)] lg:grid-cols-[380px_1fr] lg:p-6"
            >
              <Link href={`/tournaments/${tournament.slug}`} className="relative block overflow-hidden rounded-[28px]">
                <TournamentBannerImage
                  bannerUrl={tournament.bannerUrl}
                  title={tournament.title}
                  className="h-full min-h-[320px] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,7,12,0.08),rgba(6,7,12,0.35)_42%,rgba(6,7,12,0.88))]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
                  <div className="max-w-[78%] rounded-[20px] bg-[linear-gradient(180deg,rgba(6,7,12,0.1),rgba(6,7,12,0.58))] px-1 py-1">
                    <p className="text-[10px] tracking-[0.08em] text-cyan-100/80">{tournament.game}</p>
                    <p className="mt-1 font-display text-xl text-white">{tournament.title}</p>
                    <p className="mt-2 text-xs text-slate-300">
                      {formatDisplayDate(tournament.startDate)} - {formatDisplayDate(tournament.endDate)}
                    </p>
                  </div>
                </div>
              </Link>

              <div className="flex flex-col justify-between gap-7">
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">{tournament.game}</p>
                    <Badge className="border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100">
                      {getRegistrationBadgeLabel(tournament)}
                    </Badge>
                  </div>

                  <div className="max-w-4xl">
                    <Link href={`/tournaments/${tournament.slug}`}>
                      <h3 className="text-3xl text-white sm:text-[2.25rem] sm:leading-[1.05]">{tournament.title}</h3>
                    </Link>
                    <p className="mt-2 text-sm text-slate-400">
                      Tournament: {toTitleCase(getTournamentStatusLabel(tournament.status))}
                    </p>
                    <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                      {tournament.shortDescription || "Tournament schedule, roster requirements, and registration details."}
                    </p>
                  </div>

                  <TournamentInfoList tournament={tournament} variant="compact" />
                </div>

                <div className="flex flex-col gap-4 border-t border-white/8 pt-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] tracking-[0.08em] text-slate-500">Registration Summary</p>
                    <p className="mt-2 text-base font-semibold text-white">
                      {tournament.registrationCount} / {tournament.maxTeams} teams registered
                    </p>
                    <p className="mt-1 text-sm text-slate-400">{getRegistrationHelperText(tournament)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/tournaments/${tournament.slug}`}
                      className={buttonClassName({
                        variant: "secondary",
                        className: "border-white/14 bg-transparent hover:border-white/20 hover:bg-white/6",
                      })}
                    >
                      View Details
                    </Link>
                    <RegisterTournamentButton tournament={tournament} closedAsButton />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tournaments match this filter"
          description="Try switching the selected game or check back soon for the next Quest Esports announcement."
        />
      )}
    </Section>
  );
}

function getRegistrationBadgeLabel(tournament: Tournament) {
  if (tournament.registrationState === "registration_open") {
    return "Open";
  }

  if (tournament.registrationState === "slots_full") {
    return "Full";
  }

  return "Closed";
}

function getRegistrationHelperText(tournament: Tournament) {
  const registrationLabel = getTournamentRegistrationLabel(tournament);
  const tournamentState = toTitleCase(getTournamentStatusLabel(tournament.status));
  return `Registration: ${registrationLabel}. Tournament: ${tournamentState}.`;
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
