import Link from "next/link";
import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { ApiRequestError } from "@/lib/api";
import { formatSriLankaDateTime } from "@/lib/date-time";
import { buildPageMetadata } from "@/lib/site";
import {
  fetchTournamentResults,
  formatSeriesFormat,
  teamLabel,
  type TournamentResult,
  type TournamentResults,
} from "@/lib/valorant-results";

type ResultsPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ResultsPageProps) {
  try {
    const { slug } = await params;
    const data = await fetchTournamentResults(slug);
    return buildPageMetadata({
      title: `${data.tournament.title} — Results`,
      description: `Completed VALORANT matches for ${data.tournament.title}: scorelines, maps and full scoreboards.`,
      path: `/tournaments/${data.tournament.slug}/results`,
    });
  } catch {
    return {};
  }
}

const formatDate = (value: string | null) =>
  value ? formatSriLankaDateTime(value, { dateStyle: "medium" }) : "Date unknown";

// One completed series. The scoreline and per-map scores are enough for a list;
// the full scoreboard lives one click away, because a 16-team event would
// otherwise ship several hundred player rows to render this page.
const ResultRow = ({ result }: { result: TournamentResult }) => {
  const teamAWon = result.winner === "a";
  const teamBWon = result.winner === "b";

  return (
    <Card className="px-5 py-4 transition-colors hover:border-white/20">
      <Link href={`/matches/${result.id}`} className="block">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {formatSeriesFormat(result.format)}
          </span>
          <span className="ml-auto text-xs text-slate-500">{formatDate(result.playedAt)}</span>
        </div>

        <div className="mt-3 flex items-center gap-4">
          <span
            className={`flex-1 text-sm font-semibold ${teamAWon ? "text-white" : "text-slate-400"}`}
          >
            {teamLabel(result.teams.a)}
          </span>
          <span className="flex shrink-0 items-baseline gap-2 font-mono text-xl tabular-nums">
            <span className={teamAWon ? "text-emerald-300" : "text-slate-500"}>
              {result.mapsWon.a}
            </span>
            <span className="text-slate-600">:</span>
            <span className={teamBWon ? "text-emerald-300" : "text-slate-500"}>
              {result.mapsWon.b}
            </span>
          </span>
          <span
            className={`flex-1 text-right text-sm font-semibold ${
              teamBWon ? "text-white" : "text-slate-400"
            }`}
          >
            {teamLabel(result.teams.b)}
          </span>
        </div>

        {result.maps.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3">
            {result.maps.map((map) => (
              <span key={map.gameNumber} className="text-[11px] text-slate-500">
                <span className="uppercase tracking-[0.14em]">{map.mapName ?? "Unknown"}</span>{" "}
                <span className="font-mono tabular-nums text-slate-400">
                  {map.teamAScore ?? "—"}-{map.teamBScore ?? "—"}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </Link>
    </Card>
  );
};

export default async function TournamentResultsPage({ params }: ResultsPageProps) {
  let data: TournamentResults;

  try {
    const { slug } = await params;
    data = await fetchTournamentResults(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  return (
    <PageLayout title={`${data.tournament.title} — Results`} description="Completed VALORANT matches">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{data.results.length} match{data.results.length === 1 ? "" : "es"}</Badge>
          <Link
            href={`/tournaments/${data.tournament.slug}`}
            className="text-xs uppercase tracking-[0.18em] text-slate-400 underline-offset-4 hover:underline"
          >
            Tournament overview
          </Link>
        </div>

        {data.results.length === 0 ? (
          <Card className="mt-6 px-5 py-4">
            {/* Only finalized series appear. A match mid-import is admin
                bookkeeping, and publishing a number staff have not stood behind
                is worse than publishing nothing. */}
            <p className="text-sm text-slate-400">
              No completed matches yet. Results appear here once staff finalize them.
            </p>
          </Card>
        ) : (
          <div className="mt-6 grid gap-3">
            {data.results.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </div>
        )}
      </Section>
    </PageLayout>
  );
}
