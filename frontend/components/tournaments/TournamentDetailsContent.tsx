"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { resolveMediaUrl } from "@/lib/media";
import {
  Tournament,
  TournamentScheduleData,
  getTournamentRegistrationLabel,
  getTournamentStatusLabel,
} from "@/lib/tournaments";
import { formatDisplayDate } from "@/lib/utils";

const heroStats = (tournament: Tournament) => [
  { label: "Prize Pool", value: tournament.prizePool },
  { label: "Format", value: tournament.format },
  { label: "Team Size", value: `${tournament.teamSize}v${tournament.teamSize}` },
  {
    label: "Dates",
    value: `${formatDisplayDate(tournament.startDate)} - ${formatDisplayDate(tournament.endDate)}`,
  },
  { label: "Deadline", value: formatDisplayDate(tournament.registrationDeadline) },
  { label: "Slots", value: `${tournament.registrationCount} / ${tournament.maxTeams}` },
];

export default function TournamentDetailsContent({ tournament }: { tournament: Tournament }) {
  const description =
    tournament.fullDescription ||
    tournament.shortDescription ||
    "Tournament information will be updated soon.";
  const bracketEmbedUrl = getChallongeEmbedUrl(tournament.bracketLink);

  return (
    <Section className="pt-6">
      <div className="space-y-6">
        <Card className="overflow-hidden p-4 sm:p-5 xl:p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/30">
              <TournamentBannerImage
                bannerUrl={tournament.bannerUrl}
                title={tournament.title}
                className="h-full min-h-[340px] w-full object-cover sm:min-h-[420px] xl:min-h-[100%]"
              />
            </div>

            <div className="flex flex-col justify-between gap-6">
              <div className="space-y-6">
                <header className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/80">{tournament.game}</p>
                    <StatusBadge tournament={tournament} />
                  </div>

                  <div className="max-w-4xl">
                    <h2 className="text-3xl leading-tight text-white sm:text-[2.7rem] sm:leading-[1.02]">
                      {tournament.title}
                    </h2>
                    <p className="mt-3 text-sm text-slate-400">
                      Tournament status: {toTitleCase(getTournamentStatusLabel(tournament.status))}
                    </p>
                    <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                      {description}
                    </p>
                  </div>
                </header>

                <StatsPanel tournament={tournament} />

                <RegistrationPanel tournament={tournament} />
              </div>

              <footer className="flex flex-col gap-4 border-t border-white/8 pt-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] tracking-[0.1em] text-slate-500">Registration Summary</p>
                  <p className="mt-2 text-base font-semibold text-white">
                    {tournament.registrationCount} / {tournament.maxTeams} teams registered
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {getTournamentRegistrationLabel(tournament)}. Capacity is{" "}
                    {Math.min(100, Math.round((tournament.registrationCount / Math.max(tournament.maxTeams, 1)) * 100))}% full.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/tournaments"
                    className={buttonClassName({
                      variant: "secondary",
                      className: "border-white/14 bg-transparent hover:border-white/20 hover:bg-white/6",
                    })}
                  >
                    Back to Tournaments
                  </Link>
                  <RegisterTournamentButton tournament={tournament} closedAsButton />
                </div>
              </footer>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
          <TeamsPanel tournament={tournament} />
          <SchedulePanel scheduleData={tournament.scheduleData} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
          <BracketPanel bracketLink={tournament.bracketLink} bracketEmbedUrl={bracketEmbedUrl} />
          <Card className="p-6">
            <p className="text-[11px] tracking-[0.12em] text-slate-500">Rules & Notes</p>
            <h3 className="mt-3 text-2xl text-white">Format requirements and tournament expectations</h3>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">
              {tournament.rules || "Rules will be shared by the admins soon."}
            </p>
          </Card>
        </div>

        {tournament.isCompleted ? <CompletedShowcase tournament={tournament} /> : null}
      </div>
    </Section>
  );
}

function StatsPanel({ tournament }: { tournament: Tournament }) {
  const items = heroStats(tournament);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="grid gap-px bg-white/5 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="bg-[#0c0a14] p-5">
            <p className="text-[11px] tracking-[0.08em] text-slate-400">{item.label}</p>
            <p className="mt-3 text-base font-semibold text-white sm:text-lg">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RegistrationPanel({ tournament }: { tournament: Tournament }) {
  const registrationLabel = getTournamentRegistrationLabel(tournament);
  const filledPercentage = Math.min(
    100,
    Math.round((tournament.registrationCount / Math.max(tournament.maxTeams, 1)) * 100)
  );

  return (
    <section className="rounded-[28px] border border-fuchsia-400/18 bg-[#120d1d] p-5 shadow-[0_20px_50px_rgba(61,9,115,0.18)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] tracking-[0.08em] text-slate-400">Registration</p>
          <p className="text-lg font-semibold text-white">{registrationLabel}</p>
          <p className="text-sm text-slate-300">
            {tournament.registrationCount} / {tournament.maxTeams} teams registered
          </p>
        </div>

        <div className="min-w-44 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 lg:text-right">
          <p className="text-[11px] tracking-[0.08em] text-slate-400">Capacity</p>
          <p className="mt-1 text-2xl font-semibold text-white">{filledPercentage}%</p>
        </div>
      </div>

      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${filledPercentage}%` }} />
      </div>

      <p className="mt-3 text-sm text-slate-400">
        {registrationLabel === "Registration Open"
          ? "Registration is open for eligible rosters. Complete signup early to secure your slot."
          : "Registration is not currently accepting new teams for this event."}
      </p>
    </section>
  );
}

function TeamsPanel({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="p-6">
      <p className="text-[11px] tracking-[0.12em] text-slate-500">Registered Teams</p>
      <h3 className="mt-3 text-2xl text-white">Qualified lineups and submitted rosters</h3>
      {tournament.registeredTeams && tournament.registeredTeams.length > 0 ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {tournament.registeredTeams.map((team) => (
            <div key={team.id} className="rounded-[24px] border border-white/8 bg-white/5 p-4 transition hover:border-fuchsia-400/25 hover:bg-white/7">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-black/30">
                  {team.logoUrl ? (
                    <img src={resolveMediaUrl(team.logoUrl)} alt={team.teamName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500">No Logo</span>
                  )}
                </div>
                <div>
                  <p className="text-base font-semibold text-white">{team.teamName}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{team.status}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">Approved teams will appear here once registrations are confirmed.</p>
      )}
    </Card>
  );
}

function SchedulePanel({ scheduleData }: { scheduleData: TournamentScheduleData | null }) {
  return (
    <Card className="p-6">
      <p className="text-[11px] tracking-[0.12em] text-slate-500">Schedule</p>
      <h3 className="mt-3 text-2xl text-white">Spreadsheet-driven event timeline</h3>
      {scheduleData?.rows?.length ? (
        <div className="mt-5 overflow-hidden rounded-[22px] border border-white/8">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5">
                <tr>
                  {scheduleData.headers.map((header) => (
                    <th key={header} className="px-4 py-3 font-medium uppercase tracking-[0.12em] text-slate-400">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleData.rows.map((row, index) => (
                  <tr key={`${scheduleData.sheetName}-${index}`} className="border-t border-white/8 bg-[#0c0a14]">
                    {scheduleData.headers.map((header) => (
                      <td key={`${header}-${index}`} className="px-4 py-3 text-slate-200">
                        {String(row[header] || "-")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">A schedule spreadsheet has not been published for this tournament yet.</p>
      )}
    </Card>
  );
}

function BracketPanel({
  bracketLink,
  bracketEmbedUrl,
}: {
  bracketLink: string | null;
  bracketEmbedUrl: string | null;
}) {
  return (
    <Card className="p-6">
      <p className="text-[11px] tracking-[0.12em] text-slate-500">Bracket</p>
      <h3 className="mt-3 text-2xl text-white">Live bracket and match progression</h3>
      {bracketEmbedUrl ? (
        <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8 bg-black/30">
          <iframe
            src={bracketEmbedUrl}
            title="Tournament bracket"
            className="h-[520px] w-full"
            loading="lazy"
          />
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">Bracket embed will appear here once a Challonge bracket is connected.</p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {bracketLink ? (
          <a href={bracketLink} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })}>
            View on Challonge
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function CompletedShowcase({ tournament }: { tournament: Tournament }) {
  const items = [
    { label: "Official Tournament Poster", imageUrl: tournament.showcase.posterUrl },
    { label: "1st Place Winners", imageUrl: tournament.showcase.firstPlaceUrl },
    { label: "2nd Place Winners", imageUrl: tournament.showcase.secondPlaceUrl },
    { label: "3rd Place Winners", imageUrl: tournament.showcase.thirdPlaceUrl },
  ].filter((item) => item.imageUrl);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-200/80">Completed Showcase</p>
        <h3 className="mt-2 text-3xl text-white">Posters, podium moments, and final campaign assets.</h3>
      </div>

      {items.map((item, index) => (
        <Card
          key={item.label}
          className="overflow-hidden border-fuchsia-400/10 bg-[#09080f] transition duration-300 hover:border-fuchsia-300/25"
        >
          <div className="grid gap-6 p-5 lg:grid-cols-[280px_1fr] lg:p-6">
            <div className="overflow-hidden rounded-[24px] border border-white/8 bg-black/30">
              <img src={resolveMediaUrl(item.imageUrl || "")} alt={item.label} className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase tracking-[0.24em] text-fuchsia-200/75">Showcase {index + 1}</p>
              <h4 className="mt-3 text-3xl text-white">{item.label}</h4>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                Published as part of the completed tournament presentation for {tournament.title}.
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ tournament }: { tournament: Tournament }) {
  const label = getShortRegistrationLabel(tournament);
  const toneClassName =
    label === "Open"
      ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
      : label === "Full"
        ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
        : "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] ${toneClassName}`.trim()}
    >
      {label}
    </span>
  );
}

function getShortRegistrationLabel(tournament: Tournament) {
  if (tournament.registrationState === "registration_open") {
    return "Open";
  }

  if (tournament.registrationState === "slots_full") {
    return "Full";
  }

  return "Closed";
}

function getChallongeEmbedUrl(bracketLink: string | null) {
  if (!bracketLink) {
    return null;
  }

  try {
    const parsed = new URL(bracketLink);

    if (!parsed.hostname.includes("challonge.com")) {
      return null;
    }

    const slug = parsed.pathname.replace(/^\/+|\/+$/g, "");

    if (!slug) {
      return null;
    }

    return `https://challonge.com/${slug}/module?show_final_results=1&show_standings=1&theme=7670`;
  } catch {
    return null;
  }
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
