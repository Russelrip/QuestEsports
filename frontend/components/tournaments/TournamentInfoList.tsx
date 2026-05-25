import { Badge } from "@/components/ui/badge";
import { formatDisplayDate } from "@/lib/utils";
import {
  Tournament,
  getTournamentRegistrationLabel,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

type TournamentInfoListVariant = "default" | "compact";

const infoItems = (tournament: Tournament) => [
  { label: "Game", value: tournament.game },
  { label: "Prize Pool", value: tournament.prizePool },
  { label: "Format", value: tournament.format },
  { label: "Team Size", value: `${tournament.teamSize}v${tournament.teamSize}` },
  { label: "Slots", value: `${tournament.registrationCount} / ${tournament.maxTeams}` },
  { label: "Registration Deadline", value: formatDisplayDate(tournament.registrationDeadline) },
  { label: "Event Dates", value: `${formatDisplayDate(tournament.startDate)} - ${formatDisplayDate(tournament.endDate)}` },
];

const compactItems = (tournament: Tournament) => [
  { label: "Prize Pool", value: tournament.prizePool, icon: TrophyIcon },
  { label: "Format", value: tournament.format, icon: GridIcon },
  { label: "Team Size", value: `${tournament.teamSize}v${tournament.teamSize}`, icon: UsersIcon },
  {
    label: "Dates",
    value: `${formatDisplayDate(tournament.startDate)} - ${formatDisplayDate(tournament.endDate)}`,
    icon: CalendarIcon,
  },
  { label: "Deadline", value: formatDisplayDate(tournament.registrationDeadline), icon: ClockIcon },
  { label: "Slots", value: `${tournament.registrationCount} / ${tournament.maxTeams}`, icon: UsersIcon },
  { label: "Tournament", value: toTitleCase(getTournamentStatusLabel(tournament.status)), icon: SignalIcon },
];

export default function TournamentInfoList({
  tournament,
  variant = "default",
}: {
  tournament: Tournament;
  variant?: TournamentInfoListVariant;
}) {
  if (variant === "compact") {
    const filledPercentage = Math.min(
      100,
      Math.round((tournament.registrationCount / Math.max(tournament.maxTeams, 1)) * 100)
    );
    const registrationLabel = getTournamentRegistrationLabel(tournament);

    return (
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0c0a14] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="grid md:grid-cols-4">
            {compactItems(tournament).slice(0, 4).map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.label} className="border-b border-white/8 p-5 md:border-b-0 md:border-r md:border-white/8">
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/6 text-cyan-200/90">
                      <Icon />
                    </span>
                    <p className="text-[11px] tracking-[0.08em] text-slate-400">{item.label}</p>
                  </div>
                  <p className="mt-4 text-base font-semibold text-white sm:text-lg">{item.value}</p>
                </div>
              );
            })}
          </div>

          <div className="grid md:grid-cols-3">
            {compactItems(tournament).slice(4).map((item, index) => {
              const Icon = item.icon;
              const edgeClassName =
                index < 2 ? "border-b border-white/8 md:border-b-0 md:border-r md:border-white/8" : "";

              return (
                <div key={item.label} className={`p-5 ${edgeClassName}`.trim()}>
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/6 text-fuchsia-200">
                      <Icon />
                    </span>
                    <p className="text-[11px] tracking-[0.08em] text-slate-400">{item.label}</p>
                  </div>
                  <p className="mt-4 text-base font-semibold text-white sm:text-lg">{item.value}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[26px] border border-fuchsia-400/18 bg-[#120d1d] p-5 shadow-[0_18px_45px_rgba(61,9,115,0.22)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-[11px] tracking-[0.08em] text-slate-400">Registration</p>
                <p className="mt-1 text-lg font-semibold text-white">{registrationLabel}</p>
              </div>
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
              className="h-full rounded-full bg-fuchsia-500"
              style={{ width: `${filledPercentage}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-slate-400">
            {registrationLabel === "Registration Open"
              ? "Registration is live for eligible teams."
              : "Registration is currently unavailable for this tournament."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {infoItems(tournament).map((item) => (
        <div key={item.label} className="rounded-[24px] border border-white/8 bg-white/5 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{item.label}</p>
          <p className="mt-2 text-sm font-medium text-white">{item.value}</p>
        </div>
      ))}
      <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Status</p>
        <div className="mt-2">
          <Badge>{getTournamentStatusLabel(tournament.status)}</Badge>
        </div>
      </div>
      <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Registration</p>
        <div className="mt-2">
          <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
            {getTournamentRegistrationLabel(tournament)}
          </Badge>
        </div>
      </div>
    </div>
  );
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

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5v4l2.5 1.5" />
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

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
