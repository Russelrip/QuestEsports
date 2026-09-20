"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import LeaderboardSearchForm, {
  Highlight,
  LEADERBOARD_SEARCH_DEBOUNCE_MS,
  effectiveLeaderboardQuery,
  normalizeLeaderboardQuery,
} from "@/components/valorant/LeaderboardSearchForm";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";
import { formatSriLankaDate } from "@/lib/date-time";
import {
  buildValorantTrackerProfileUrl,
  type ValorantPlayerLeaderboardEntry,
  type ValorantPlayerLeaderboardSearchEntry,
} from "@/lib/valorant";

type ValorantLeaderboardProps = {
  entries: ValorantPlayerLeaderboardEntry[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  query: string;
  searchResults: ValorantPlayerLeaderboardSearchEntry[];
};

const TOP_N = 10;
const BASE_PATH = "/valorant-leaderboard";
const buildSearchHref = (query: string) =>
  query ? `${BASE_PATH}?q=${encodeURIComponent(query)}` : BASE_PATH;

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

const LeaderboardRow = ({
  entry,
  rank,
  term = "",
}: {
  entry: ValorantPlayerLeaderboardEntry;
  rank: number | null;
  term?: string;
}) => {
  const isTopTen = rank !== null && rank <= TOP_N;
  const trackerUrl = buildValorantTrackerProfileUrl(entry.name, entry.tag);
  const rankTone =
    rank === 1 ? "text-amber-300"
    : rank === 2 ? "text-zinc-300"
    : rank === 3 ? "text-orange-300/90"
    : null;

  return (
    <tr className={cn(
      "border-b border-white/5 last:border-0 transition hover:bg-white/5",
      isTopTen && "bg-fuchsia-400/[0.05]",
    )}>
      <td className={cn("px-4 py-4 font-semibold text-white", rankTone)}>{rank ?? "—"}</td>
      <td className="px-4 py-4 text-slate-200">
        <span className="font-medium text-white">
          <Highlight text={`${entry.name}#${entry.tag}`} term={term} />
        </span>
        {trackerUrl ? (
          <a
            href={trackerUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${entry.name}#${entry.tag} on Tracker`}
            title="View profile on Tracker"
            className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs text-slate-400 transition hover:bg-white/10 hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <span aria-hidden="true">↗</span>
          </a>
        ) : null}
        {entry.discordUsername ? (
          <span className="ml-2 text-xs text-slate-500">
            <Highlight text={entry.discordUsername} term={term} />
          </span>
        ) : null}
      </td>
      <td className="px-4 py-4">
        {entry.currentTier ? <Badge>{entry.currentTier}</Badge> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-4 py-4 whitespace-nowrap font-semibold text-white">{entry.elo ?? "—"}</td>
      <td className="px-4 py-4 whitespace-nowrap text-slate-300">
        {entry.peakRank ? `${entry.peakRank}${entry.peakSeason ? ` · ${entry.peakSeason}` : ""}` : "—"}
      </td>
      <td className="px-4 py-4 whitespace-nowrap text-right text-slate-400">
        {formatSriLankaDate(entry.lastPlayed)}
      </td>
    </tr>
  );
};

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

const RegisterCta = () => (
  <div className="flex justify-center pt-2">
    <Link
      href="/profile?tab=account#valorant-account"
      className={buttonClassName({ variant: "primary", size: "md" })}
    >
      Register your account
    </Link>
  </div>
);

export default function ValorantLeaderboard({
  entries,
  page,
  perPage,
  total,
  totalPages,
  query,
  searchResults,
}: ValorantLeaderboardProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [isPending, startTransition] = useTransition();
  // The query currently reflected in the URL. Keeps the debounce from
  // re-navigating to where we already are, and lets the sync effect below tell a
  // back/forward navigation apart from one we made ourselves.
  const navigatedQuery = useRef(query);

  const navigate = useCallback((next: string) => {
    navigatedQuery.current = next;
    startTransition(() => router.replace(buildSearchHref(next), { scroll: false }));
  }, [router, startTransition]);

  // Search as you type: one debounced navigation instead of a button press.
  useEffect(() => {
    const target = effectiveLeaderboardQuery(search);
    if (target === navigatedQuery.current) return;
    const timer = setTimeout(() => navigate(target), LEADERBOARD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [navigate, search]);

  // Back/forward changes the query under us — follow it into the input.
  useEffect(() => {
    if (query !== navigatedQuery.current) {
      navigatedQuery.current = query;
      const timer = window.setTimeout(() => setSearch(query), 0);
      return () => window.clearTimeout(timer);
    }
  }, [query]);

  // Submitting flushes the pending debounce instead of waiting it out.
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(effectiveLeaderboardQuery(search));
  };

  const clearSearch = () => {
    setSearch("");
    navigate("");
  };

  const goToPage = (next: number) => router.push(`${BASE_PATH}?page=${next}`);

  const searchForm = (
    <LeaderboardSearchForm
      search={search}
      setSearch={setSearch}
      onSubmit={submitSearch}
      onClear={clearSearch}
      busy={isPending}
    />
  );

  if (query) {
    const term = normalizeLeaderboardQuery(query);
    return (
      <Container className="space-y-6">
        {searchForm}
        {searchResults.length > 0 ? (
          <section
            aria-label={`Search results for ${query}`}
            className={cn("space-y-3 transition-opacity", isPending && "opacity-60")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-400">
                {searchResults.length} {searchResults.length === 1 ? "player" : "players"} matching{" "}
                <span className="text-slate-200">&ldquo;{query}&rdquo;</span>
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className={buttonClassName({ variant: "ghost", size: "sm" })}
              >
                Back to leaderboard
              </button>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <LeaderboardTableHeader />
                  <tbody>
                    {searchResults.map((entry) => (
                      <LeaderboardRow key={`${entry.name}#${entry.tag}`} entry={entry} rank={entry.rank} term={term} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        ) : (
          <EmptyState
            title="No player found"
            description={`No player matches "${query}". Searches cover Discord usernames and Riot IDs, including partial matches — check the spelling, or register the account to appear here.`}
          />
        )}
        <RegisterCta />
      </Container>
    );
  }

  return (
    <Container className="space-y-6">
      {searchForm}

      {entries.length > 0 ? (
        <>
          <section
            aria-label="Full leaderboard"
            className={cn("transition-opacity", isPending && "opacity-60")}
          >
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <LeaderboardTableHeader />
                  <tbody>
                    {entries.map((entry, index) => (
                      <LeaderboardRow
                        key={`${entry.name}#${entry.tag}`}
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

      <RegisterCta />
    </Container>
  );
}
