"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import {
  Tournament,
  getTournamentRegistrationShortLabel,
  getTournamentStatusLabel,
} from "@/lib/tournaments";
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
    const base =
      gameFilter === "all"
        ? tournaments
        : tournaments.filter((tournament) => tournament.game === gameFilter);

    return {
      active: base.filter((tournament) => !tournament.isCompleted),
      completed: base.filter((tournament) => tournament.isCompleted),
    };
  }, [gameFilter, tournaments]);

  return (
    <Section className="pt-6">
      <div className="mb-8 flex flex-col gap-4 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,27,0.9),rgba(9,9,18,0.96))] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.2)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Tournament Board</p>
          <h2 className="mt-2 text-2xl text-white">Track live events, registrations, and completed campaigns.</h2>
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

      {filteredTournaments.active.length > 0 ? (
        <div className="grid gap-6">
          {filteredTournaments.active.map((tournament) => (
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
              </Link>

              <div className="flex flex-col justify-between gap-7">
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">{tournament.game}</p>
                    <Badge className="border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100">
                      {getTournamentRegistrationShortLabel(tournament)}
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

                  <div className="grid gap-6 sm:grid-cols-3">
                    <InfoChip label="Prize Pool" value={tournament.prizePool} />
                    <InfoChip label="Registration Deadline" value={formatDisplayDate(tournament.registrationDeadline)} />
                    <InfoChip label="Tournament Start" value={formatDisplayDate(tournament.startDate)} />
                  </div>
                </div>

                <div className="flex flex-col gap-4 border-t border-white/8 pt-6 sm:flex-row sm:items-end sm:justify-end">
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
          title="No active tournaments match this filter"
          description="Try another game selection or check the completed showcase below."
        />
      )}

      <div className="mt-12">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Completed Showcase</p>
          <h3 className="mt-2 text-3xl text-white">Finished tournaments, podium visuals, and event posters.</h3>
        </div>

        {filteredTournaments.completed.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {filteredTournaments.completed.map((tournament) => (
              <Card key={tournament.id} className="overflow-hidden border-white/10">
                <div className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
                  <div className="overflow-hidden rounded-[24px] border border-white/8 bg-black/40">
                    <TournamentBannerImage
                      bannerUrl={tournament.showcase.posterUrl || tournament.bannerUrl}
                      title={tournament.title}
                      className="h-full min-h-[240px] w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">{tournament.game}</p>
                      <h4 className="mt-2 text-2xl text-white">{tournament.title}</h4>
                      <p className="mt-2 text-sm text-slate-400">
                        Completed on {formatDisplayDate(tournament.endDate)}
                      </p>
                      <p className="mt-4 text-sm leading-7 text-slate-300">{tournament.shortDescription}</p>
                    </div>
                    <div className="flex justify-end">
                      <Link
                        href={`/tournaments/${tournament.slug}`}
                        className={buttonClassName({
                          variant: "secondary",
                          className: "border-white/14 bg-transparent hover:border-white/20 hover:bg-white/6",
                        })}
                      >
                        View Showcase
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState description="Completed tournaments will appear here once Quest Esports publishes the showcase assets." />
        )}
      </div>
    </Section>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
