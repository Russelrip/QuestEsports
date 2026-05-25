"use client";

import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import {
  Tournament,
  getTournamentRegistrationLabel,
  getTournamentStatusLabel,
} from "@/lib/tournaments";
import { formatDisplayDate } from "@/lib/utils";

const heroStats = (tournament: Tournament) => [
  { label: "Prize Pool", value: tournament.prizePool, icon: TrophyIcon },
  { label: "Format", value: tournament.format, icon: GridIcon },
  { label: "Team Size", value: `${tournament.teamSize}v${tournament.teamSize}`, icon: UsersIcon },
  {
    label: "Dates",
    value: `${formatDisplayDate(tournament.startDate)} - ${formatDisplayDate(tournament.endDate)}`,
    icon: CalendarIcon,
  },
  { label: "Deadline", value: formatDisplayDate(tournament.registrationDeadline), icon: ClockIcon },
  { label: "Slots", value: `${tournament.registrationCount} / ${tournament.maxTeams}`, icon: LayersIcon },
  { label: "Tournament", value: toTitleCase(getTournamentStatusLabel(tournament.status)), icon: SignalIcon },
];

export default function TournamentDetailsContent({ tournament }: { tournament: Tournament }) {
  const description =
    tournament.fullDescription ||
    tournament.shortDescription ||
    "Tournament information will be updated soon.";

  return (
    <Section className="pt-6">
      <div className="space-y-6">
        <Card className="overflow-hidden p-4 sm:p-5 xl:p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
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
                    <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">{tournament.game}</p>
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="p-6">
            <p className="text-[11px] tracking-[0.12em] text-slate-500">Rules & Notes</p>
            <h3 className="mt-3 text-2xl text-white">Format requirements and tournament expectations</h3>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">
              {tournament.rules || "Rules will be shared by the admins soon."}
            </p>
          </Card>

          <Card className="p-6">
            <p className="text-[11px] tracking-[0.12em] text-slate-500">Resources</p>
            <h3 className="mt-3 text-2xl text-white">Brackets, support, and quick links</h3>
            <div className="mt-5 flex flex-wrap gap-3">
              {tournament.bracketLink ? (
                <a
                  href={tournament.bracketLink}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName({ variant: "secondary" })}
                >
                  View Bracket
                </a>
              ) : null}
              {tournament.contactLink ? (
                <a
                  href={tournament.contactLink}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName({ variant: "secondary" })}
                >
                  Discord / Contact
                </a>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

function StatsPanel({ tournament }: { tournament: Tournament }) {
  const items = heroStats(tournament);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="grid md:grid-cols-4">
        {items.slice(0, 4).map((item, index) => (
          <StatItem
            key={item.label}
            label={item.label}
            value={item.value}
            icon={<item.icon />}
            className={index < 3 ? "border-b border-white/8 p-5 md:border-b-0 md:border-r" : "border-b border-white/8 p-5 md:border-b-0"}
          />
        ))}
      </div>
      <div className="grid md:grid-cols-3">
        {items.slice(4).map((item, index) => (
          <StatItem
            key={item.label}
            label={item.label}
            value={item.value}
            icon={<item.icon />}
            className={index < 2 ? "border-b border-white/8 p-5 md:border-b-0 md:border-r" : "p-5"}
          />
        ))}
      </div>
    </section>
  );
}

function StatItem({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-slate-400">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/6 text-cyan-200/90">
          {icon}
        </span>
        <p className="text-[11px] tracking-[0.08em] text-slate-400">{label}</p>
      </div>
      <p className="mt-4 text-base font-semibold text-white sm:text-lg">{value}</p>
    </div>
  );
}

function RegistrationPanel({ tournament }: { tournament: Tournament }) {
  const registrationLabel = getTournamentRegistrationLabel(tournament);
  const filledPercentage = Math.min(
    100,
    Math.round((tournament.registrationCount / Math.max(tournament.maxTeams, 1)) * 100)
  );

  return (
    <section className="rounded-[28px] border border-fuchsia-400/18 bg-[linear-gradient(180deg,rgba(35,12,61,0.42),rgba(12,14,24,0.88))] p-5 shadow-[0_20px_50px_rgba(61,9,115,0.22)]">
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
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,rgba(168,85,247,0.95),rgba(34,211,238,0.85))]"
          style={{ width: `${filledPercentage}%` }}
        />
      </div>

      <p className="mt-3 text-sm text-slate-400">
        {registrationLabel === "Registration Open"
          ? "Registration is open for eligible rosters. Complete signup early to secure your slot."
          : "Registration is not currently accepting new teams for this event."}
      </p>
    </section>
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

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function TrophyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d="M6 3h8v3a4 4 0 0 1-8 0V3Z" />
      <path d="M6 5H4a2 2 0 0 0 2 3" />
      <path d="M14 5h2a2 2 0 0 1-2 3" />
      <path d="M10 10v3" />
      <path d="M7 17h6" />
      <path d="M8 13h4v4H8z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="3.5" y="11.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="11.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d="M7 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M13.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M3.5 15a3.5 3.5 0 0 1 7 0" />
      <path d="M11.5 15a2.8 2.8 0 0 1 5 0" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d="M5 3v3" />
      <path d="M15 3v3" />
      <path d="M4 6h12" />
      <rect x="3" y="4.5" width="14" height="12" rx="2.5" />
      <path d="M6.5 10h2" />
      <path d="M11.5 10h2" />
      <path d="M6.5 13.5h2" />
      <path d="M11.5 13.5h2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5v4l2.5 1.5" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d="m10 3 6 3.2-6 3.2-6-3.2L10 3Z" />
      <path d="m4 10 6 3.2 6-3.2" />
      <path d="m4 13.8 6 3.2 6-3.2" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <path d="M4 13.5a6 6 0 0 1 12 0" />
      <path d="M6.5 13.5a3.5 3.5 0 0 1 7 0" />
      <path d="M10 13.5h.01" />
    </svg>
  );
}
