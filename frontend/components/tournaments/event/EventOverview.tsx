import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { getEventRegistrationSummary } from "@/lib/event-utils";
import type { EventSeries } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";

export default function EventOverview({ event }: { event: EventSeries }) {
  const summary = getEventRegistrationSummary(event);
  return <Section className="pt-10 sm:pt-16"><div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
    <Card className="relative overflow-hidden p-6 sm:p-8"><div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-purple-500/10 blur-3xl" /><p className="relative text-xs uppercase tracking-[0.3em] text-purple-200">The brief</p><h2 className="relative mt-3 font-display text-3xl text-white sm:text-4xl">One arena. Every game.</h2><p className="relative mt-4 max-w-2xl text-sm leading-7 text-slate-300">{event.description}</p><dl className="relative mt-8 grid grid-cols-2 gap-5 border-t border-white/10 pt-6 text-sm sm:grid-cols-4"><div><dt className="text-slate-500">Dates</dt><dd className="mt-1 font-semibold text-white">{formatTournamentDate(event.startDate || null, "scheduled")}<span className="block text-xs font-normal text-slate-500">to {formatTournamentDate(event.endDate || null, "scheduled")}</span></dd></div><div><dt className="text-slate-500">Venue</dt><dd className="mt-1 font-semibold text-white">{event.venue || event.location || "To be announced"}</dd></div><div><dt className="text-slate-500">Games</dt><dd className="mt-1 font-semibold text-white">{summary.games}</dd></div><div><dt className="text-slate-500">Players</dt><dd className="mt-1 font-semibold text-white">{summary.players}</dd></div></dl></Card>
    <Card className="p-6 sm:p-8"><p className="text-xs uppercase tracking-[0.3em] text-purple-200">Registration pulse</p><h2 className="mt-3 font-display text-3xl text-white">Find your bracket.</h2><div className="mt-6 space-y-4 text-sm"><div className="flex items-center justify-between border-b border-white/10 pb-4"><span className="text-slate-400">Teams in the arena</span><strong className="text-white">{summary.teams}</strong></div><div className="flex items-center justify-between border-b border-white/10 pb-4"><span className="text-slate-400">Available capacity</span><strong className={summary.isOpen ? "text-emerald-300" : "text-slate-200"}>{summary.slots}</strong></div><p className="pt-1 text-xs leading-5 text-slate-500">Each game has its own format, rules, and registration page.</p></div></Card>
  </div></Section>;
}
