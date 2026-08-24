import Link from "next/link";
import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { ApiRequestError } from "@/lib/api";
import { formatSriLankaDateTime } from "@/lib/date-time";
import {
  fetchPlayerProfile,
  formatGame,
  formatRiotId,
  formatVerification,
  type PlayerProfile,
  type PlayerRanking,
} from "@/lib/players";
import { buildPageMetadata } from "@/lib/site";

type PlayerPageProps = { params: Promise<{ publicId: string }> };

export async function generateMetadata({ params }: PlayerPageProps) {
  try {
    const { publicId } = await params;
    const player = await fetchPlayerProfile(publicId);
    return buildPageMetadata({
      title: `${player.displayName} — Player Profile`,
      description: `Quest E-sports player profile for ${player.displayName}: teams, tournament history, and competitive rankings.`,
      path: `/players/${player.publicId}`,
    });
  } catch {
    return {};
  }
}

const formatDate = (value: string | null) =>
  value ? formatSriLankaDateTime(value, { dateStyle: "medium" }) : "TBD";

const StatTile = ({ label, value }: { label: string; value: string | number }) => (
  <Card className="px-5 py-4">
    <p className="font-mono text-2xl font-bold tabular-nums text-white">{value}</p>
    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
  </Card>
);

// A ranking is a cached read of an external service, so it always renders with
// the time it was taken. The cache exists precisely so this page survives that
// service being unreachable, which makes "possibly stale" the ordinary case.
const RankingRow = ({ ranking }: { ranking: PlayerRanking }) => (
  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/10 py-3 first:border-t-0">
    <span className="text-sm font-semibold text-white">{formatGame(ranking.game)}</span>
    {ranking.position !== null ? (
      <span className="font-mono text-sm tabular-nums text-emerald-300">
        Sri Lanka #{ranking.position}
      </span>
    ) : (
      <span className="text-sm text-slate-500">Unranked</span>
    )}
    {ranking.tier ? <span className="text-sm text-slate-300">{ranking.tier}</span> : null}
    {ranking.elo !== null ? (
      <span className="font-mono text-sm tabular-nums text-slate-400">{ranking.elo} ELO</span>
    ) : null}
    {ranking.peakTier ? (
      <span className="text-xs text-slate-500">
        Peak {ranking.peakTier}
        {ranking.peakSeason ? ` (${ranking.peakSeason})` : ""}
      </span>
    ) : null}
    <span className="ml-auto text-[11px] text-slate-500">
      as of {formatSriLankaDateTime(ranking.syncedAt, { dateStyle: "medium" })}
    </span>
  </div>
);

export default async function PlayerProfilePage({ params }: PlayerPageProps) {
  let player: PlayerProfile;

  try {
    const { publicId } = await params;
    player = await fetchPlayerProfile(publicId);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const primaryAccount = player.gameAccounts[0];
  const primaryRiotId = primaryAccount ? formatRiotId(primaryAccount) : null;

  return (
    <PageLayout title={player.displayName} description="Quest E-sports player profile">
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="font-mono tracking-[0.18em]">{player.publicId}</Badge>
          {primaryRiotId ? <Badge>{primaryRiotId}</Badge> : null}
          {player.discordLinked ? <Badge>Discord linked</Badge> : null}
          <span className="text-xs text-slate-500">
            Member since {formatDate(player.memberSince)}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Tournaments played" value={player.stats.tournamentsPlayed} />
          <StatTile label="Games" value={player.stats.gamesPlayed} />
          <StatTile label="Teams" value={player.teams.length} />
          <StatTile label="Accounts" value={player.gameAccounts.length} />
        </div>
      </Section>

      {player.rankings.length > 0 ? (
        <Section className="pt-0">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Rankings
          </h2>
          <Card className="px-5 py-2">
            {player.rankings.map((ranking) => (
              <RankingRow key={ranking.game} ranking={ranking} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section className="pt-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
          Game accounts
        </h2>
        {player.gameAccounts.length === 0 ? (
          <Card className="px-5 py-4">
            <p className="text-sm text-slate-400">No game accounts connected yet.</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {player.gameAccounts.map((account) => (
              <Card key={account.game} className="px-5 py-4">
                <p className="text-sm font-semibold text-white">{formatGame(account.game)}</p>
                <p className="mt-1 font-mono text-sm text-slate-300">
                  {formatRiotId(account) ?? "—"}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {account.region ? (
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {account.region}
                    </span>
                  ) : null}
                  {/* Says what was proven and no more: Quest cannot prove that
                      the signed-in player holds a resolved account. */}
                  <span className="text-[11px] text-slate-500">
                    {formatVerification(account.verificationStatus)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {player.teams.length > 0 ? (
        <Section className="pt-0">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Teams
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {player.teams.map((team) => (
              <Card key={`${team.name}-${team.role}`} className="px-5 py-4">
                <p className="text-sm font-semibold text-white">
                  {team.name}
                  {team.tag ? (
                    <span className="ml-2 font-mono text-xs text-slate-500">[{team.tag}]</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {team.role}
                  {team.game ? ` · ${formatGame(team.game)}` : ""}
                </p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      <Section className="pt-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
          Tournament history
        </h2>
        {player.tournaments.length === 0 ? (
          <Card className="px-5 py-4">
            <p className="text-sm text-slate-400">
              No tournament appearances yet. Approved entries in published events show up here.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {player.tournaments.map((entry) => (
              <Card key={`${entry.tournamentSlug}-${entry.teamName}`} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/tournaments/${entry.tournamentSlug}`}
                    className="text-sm font-semibold text-white underline-offset-4 hover:underline"
                  >
                    {entry.tournamentTitle}
                  </Link>
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {entry.status}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">
                    {formatDate(entry.startDate)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {entry.teamName}
                  <span className="ml-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    {entry.role}
                  </span>
                </p>
                {/* The name committed to THIS tournament, from the frozen roster
                    snapshot, so a later rename cannot rewrite history. Shown
                    only when it differs from the account today. */}
                {entry.playedAs?.username &&
                formatRiotId(entry.playedAs) !== primaryRiotId ? (
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    played as {formatRiotId(entry.playedAs)}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Section>
    </PageLayout>
  );
}
