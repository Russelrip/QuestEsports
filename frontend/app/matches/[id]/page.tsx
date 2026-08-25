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
  fetchPublicMatch,
  formatDuration,
  formatRiotName,
  formatSeriesFormat,
  statValue,
  teamLabel,
  type MatchMap,
  type PublicMatch,
  type ScoreboardPlayer,
  type TeamSlot,
} from "@/lib/valorant-results";

// A "match" here is the SERIES, as it is on VLR — a bo1/bo3/bo5 with one
// scoreboard per map. The route id is the series id, not a Quest bracket match
// id; nothing joins the two yet.
type MatchPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: MatchPageProps) {
  try {
    const { id } = await params;
    const match = await fetchPublicMatch(id);
    const title = `${teamLabel(match.teams.a)} vs ${teamLabel(match.teams.b)}`;
    return buildPageMetadata({
      title: `${title} — Match`,
      description: `VALORANT scoreboard for ${title}${
        match.tournament ? ` at ${match.tournament.title}` : ""
      }: per-map scores, ACS, ADR and headshot percentage.`,
      path: `/matches/${match.id}`,
    });
  } catch {
    return {};
  }
}

const formatDate = (value: string | null) =>
  value ? formatSriLankaDateTime(value, { dateStyle: "medium", timeStyle: "short" }) : "Date unknown";

const TeamScore = ({
  label,
  tag,
  score,
  won,
  align,
}: {
  label: string;
  tag: string | null;
  score: number;
  won: boolean;
  align: "left" | "right";
}) => (
  <div className={align === "right" ? "text-right" : "text-left"}>
    <p className={`text-base font-semibold ${won ? "text-white" : "text-slate-400"}`}>
      {label}
      {tag ? <span className="ml-2 font-mono text-xs text-slate-500">[{tag}]</span> : null}
    </p>
    <p
      className={`font-mono text-4xl font-bold tabular-nums ${
        won ? "text-emerald-300" : "text-slate-500"
      }`}
    >
      {score}
    </p>
  </div>
);

// One scoreboard row. A player Quest knows links to their profile — that link
// is what turns a scoreboard into a profile network — and everyone else renders
// as the name they played under, which is all the public data there is.
const ScoreboardRow = ({ player }: { player: ScoreboardPlayer }) => {
  const name = formatRiotName(player);
  return (
    <tr className="border-t border-white/10">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          {player.profile ? (
            <Link
              href={`/players/${player.profile.publicId}`}
              className="text-sm font-medium text-white underline-offset-4 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="text-sm text-slate-300">{name}</span>
          )}
          {player.profile ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-400/70">
              Quest
            </span>
          ) : null}
        </div>
        {player.agentName ? (
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {player.agentName}
          </p>
        ) : null}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-white">
        {statValue(player.acs)}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-300">
        {statValue(player.kills)}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-300">
        {statValue(player.deaths)}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-300">
        {statValue(player.assists)}
      </td>
      <td
        className={`py-2.5 text-right font-mono text-sm tabular-nums ${
          player.plusMinus === null
            ? "text-slate-500"
            : player.plusMinus > 0
              ? "text-emerald-300"
              : player.plusMinus < 0
                ? "text-rose-300"
                : "text-slate-400"
        }`}
      >
        {player.plusMinus === null
          ? "—"
          : player.plusMinus > 0
            ? `+${player.plusMinus}`
            : player.plusMinus}
      </td>
      <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-300">
        {statValue(player.adr)}
      </td>
      <td className="py-2.5 pl-3 text-right font-mono text-sm tabular-nums text-slate-300">
        {statValue(player.headshotPercent, "%")}
      </td>
    </tr>
  );
};

const Scoreboard = ({ players }: { players: ScoreboardPlayer[] }) => (
  // Wide on purpose, so it scrolls inside its own container rather than making
  // the whole page scroll sideways on a phone.
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] border-collapse">
      <thead>
        <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <th className="pb-2 text-left font-medium">Player</th>
          <th className="pb-2 text-right font-medium">ACS</th>
          <th className="pb-2 text-right font-medium">K</th>
          <th className="pb-2 text-right font-medium">D</th>
          <th className="pb-2 text-right font-medium">A</th>
          <th className="pb-2 text-right font-medium">+/−</th>
          <th className="pb-2 text-right font-medium">ADR</th>
          <th className="pb-2 pl-3 text-right font-medium">HS%</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <ScoreboardRow key={`${player.displayName}-${player.tagline}-${player.agentName}`} player={player} />
        ))}
      </tbody>
    </table>
  </div>
);

const MapCard = ({ map, match }: { map: MatchMap; match: PublicMatch }) => {
  const duration = formatDuration(map.durationMs);
  const teamAWon = map.winner === "a";
  const teamBWon = map.winner === "b";

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
          Map {map.gameNumber}
        </span>
        <h3 className="text-base font-semibold text-white">{map.mapName ?? "Unknown map"}</h3>
        <div className="ml-auto flex items-baseline gap-2 font-mono text-lg tabular-nums">
          <span className={teamAWon ? "text-emerald-300" : "text-slate-400"}>
            {map.teamAScore ?? "—"}
          </span>
          <span className="text-slate-600">:</span>
          <span className={teamBWon ? "text-emerald-300" : "text-slate-400"}>
            {map.teamBScore ?? "—"}
          </span>
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {teamLabel(match.teams.a)} vs {teamLabel(match.teams.b)}
        {duration ? ` · ${duration}` : ""}
      </p>

      {map.scoreboardAvailable ? (
        <div className="mt-4">
          <Scoreboard players={map.players} />
        </div>
      ) : (
        // Honest about the gap. The series records this map as played, but no
        // scoreboard was ever imported for it, and inventing zeroes would be a
        // lie a reader cannot detect.
        <p className="mt-4 text-sm text-slate-500">
          No scoreboard was imported for this map.
        </p>
      )}
    </Card>
  );
};

const winnerName = (match: PublicMatch, slot: TeamSlot | null) => {
  if (slot === "a") return teamLabel(match.teams.a);
  if (slot === "b") return teamLabel(match.teams.b);
  return null;
};

export default async function MatchPage({ params }: MatchPageProps) {
  let match: PublicMatch;

  try {
    const { id } = await params;
    match = await fetchPublicMatch(id);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const winner = winnerName(match, match.winner);

  return (
    <PageLayout
      title={`${teamLabel(match.teams.a)} vs ${teamLabel(match.teams.b)}`}
      description="VALORANT match scoreboard"
    >
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{formatSeriesFormat(match.format)}</Badge>
          {match.tournament ? (
            <Link
              href={`/tournaments/${match.tournament.slug}/results`}
              className="text-xs uppercase tracking-[0.18em] text-slate-400 underline-offset-4 hover:underline"
            >
              {match.tournament.title}
            </Link>
          ) : null}
          <span className="ml-auto text-xs text-slate-500">{formatDate(match.playedAt)}</span>
        </div>

        <Card className="mt-6 px-6 py-6">
          <div className="flex items-center justify-between gap-6">
            <TeamScore
              align="left"
              label={teamLabel(match.teams.a)}
              tag={match.teams.a.tag}
              score={match.mapsWon.a}
              won={match.winner === "a"}
            />
            <span className="text-xs uppercase tracking-[0.18em] text-slate-600">vs</span>
            <TeamScore
              align="right"
              label={teamLabel(match.teams.b)}
              tag={match.teams.b.tag}
              score={match.mapsWon.b}
              won={match.winner === "b"}
            />
          </div>
          {winner ? (
            <p className="mt-4 border-t border-white/10 pt-3 text-center text-xs uppercase tracking-[0.18em] text-slate-500">
              {winner} won
            </p>
          ) : null}
        </Card>
      </Section>

      <Section className="pt-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
          Maps
        </h2>
        {match.maps.length === 0 ? (
          <Card className="px-5 py-4">
            <p className="text-sm text-slate-400">No maps were recorded for this match.</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {match.maps.map((map) => (
              <MapCard key={map.gameNumber} map={map} match={match} />
            ))}
          </div>
        )}
      </Section>

      {/* Round timeline and economy are deliberately absent. They live in the
          upstream's raw_payload, which is not exposed to Quest yet — that is an
          open decision, not an oversight, and showing a half-built timeline
          would be worse than showing none. */}
    </PageLayout>
  );
}
