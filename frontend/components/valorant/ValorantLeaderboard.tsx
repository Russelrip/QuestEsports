"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  VALORANT_SL_REGISTER_URL,
  type ValorantPlayerLeaderboardEntry,
} from "@/lib/valorant";

type ValorantLeaderboardProps = {
  entries: ValorantPlayerLeaderboardEntry[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  query: string;
  searchResult: ValorantPlayerLeaderboardEntry | null;
};

const TOP_N = 10;

const LeaderboardTableHeader = () => (
  <thead>
    <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
      <th scope="col" className="px-4 py-3">#</th>
      <th scope="col" className="px-4 py-3">Player</th>
      <th scope="col" className="px-4 py-3">Tier</th>
      <th scope="col" className="px-4 py-3">ELO</th>
      <th scope="col" className="px-4 py-3">Peak</th>
      <th scope="col" className="px-4 py-3 text-right">Last played</th>
    </tr>
  </thead>
);

const LeaderboardRow = ({ entry, rank }: { entry: ValorantPlayerLeaderboardEntry; rank: number | null }) => (
  <tr className="border-b border-white/5 last:border-0 transition hover:bg-white/5">
    <td className="px-4 py-4 font-semibold text-white">{rank ?? "—"}</td>
    <td className="px-4 py-4 text-slate-200">
      <span className="font-medium text-white">{entry.name}#{entry.tag}</span>
      <span className="ml-2 text-xs text-slate-500">{entry.discordUsername}</span>
    </td>
    <td className="px-4 py-4">
      {entry.currentTier ? <Badge>{entry.currentTier}</Badge> : <span className="text-slate-500">—</span>}
    </td>
    <td className="px-4 py-4 whitespace-nowrap font-semibold text-white">{entry.elo ?? "—"}</td>
    <td className="px-4 py-4 whitespace-nowrap text-slate-300">
      {entry.peakRank ? `${entry.peakRank}${entry.peakSeason ? ` · ${entry.peakSeason}` : ""}` : "—"}
    </td>
    <td className="px-4 py-4 whitespace-nowrap text-right text-slate-400">
      {entry.lastPlayed ? new Date(entry.lastPlayed).toLocaleDateString() : "—"}
    </td>
  </tr>
);

const SearchForm = ({
  search,
  setSearch,
  onSubmit,
}: {
  search: string;
  setSearch: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) => (
  <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
    <Input
      type="search"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      placeholder="Search by Discord username"
      aria-label="Search by Discord username"
      className="max-w-sm"
    />
    <button type="submit" className={buttonClassName({ variant: "secondary", size: "md" })}>
      Search
    </button>
  </form>
);

const Pagination = ({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) => (
  <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
    <p className="text-sm text-slate-400">{total} players</p>
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={buttonClassName({ variant: "ghost", size: "sm" })}
      >
        Previous
      </button>
      <span className="text-sm text-slate-300">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={buttonClassName({ variant: "ghost", size: "sm" })}
      >
        Next
      </button>
    </div>
  </div>
);

export default function ValorantLeaderboard({
  entries,
  page,
  perPage,
  total,
  totalPages,
  query,
  searchResult,
}: ValorantLeaderboardProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = search.trim();
    if (q) {
      router.push(`/valorant-leaderboard?q=${encodeURIComponent(q)}`);
    } else {
      router.push("/valorant-leaderboard");
    }
  };

  const goToPage = (next: number) => router.push(`/valorant-leaderboard?page=${next}`);

  if (query) {
    return (
      <div className="space-y-6">
        <SearchForm search={search} setSearch={setSearch} onSubmit={submitSearch} />
        {searchResult ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <LeaderboardTableHeader />
                <tbody>
                  <LeaderboardRow entry={searchResult} rank={null} />
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No player found"
            description={`No player matches "${query}". Searches match a player's exact Discord username.`}
          />
        )}
      </div>
    );
  }

  const topEntries = entries.slice(0, TOP_N);

  return (
    <div className="space-y-6">
      <SearchForm search={search} setSearch={setSearch} onSubmit={submitSearch} />

      {entries.length > 0 ? (
        <>
          {page === 1 && topEntries.length > 0 ? (
            <section aria-label="Top 10 players">
              <h2 className="text-lg font-semibold text-white">Top 10</h2>
              <Card className="mt-3 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <LeaderboardTableHeader />
                    <tbody>
                      {topEntries.map((entry, index) => (
                        <LeaderboardRow key={entry.puuid} entry={entry} rank={index + 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          ) : null}

          <section aria-label="Full leaderboard">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <LeaderboardTableHeader />
                  <tbody>
                    {entries.map((entry, index) => (
                      <LeaderboardRow
                        key={entry.puuid}
                        entry={entry}
                        rank={(page - 1) * perPage + index + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <Pagination page={page} totalPages={totalPages} total={total} onPage={goToPage} />
        </>
      ) : (
        <EmptyState
          title="Leaderboard unavailable"
          description="The leaderboard is temporarily unavailable. Please try again shortly."
        />
      )}

      <div className="flex justify-center pt-2">
        <a
          href={VALORANT_SL_REGISTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: "primary", size: "md" })}
        >
          Register your account
        </a>
      </div>
    </div>
  );
}
