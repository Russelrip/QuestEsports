"use client";

import { buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The leaderboard search box, shared by the public leaderboard and the admin
// Leaderboard Players tab so both search the same way: as you type, from two
// characters, with a clear button, Escape to clear, and the match highlighted.

// Below this the backends decline to search, so don't spend a round trip on it.
export const LEADERBOARD_MIN_QUERY_LENGTH = 2;
export const LEADERBOARD_SEARCH_DEBOUNCE_MS = 350;

// Discord handles are often pasted with a leading @; the backends strip it too,
// so strip it here as well or the highlight would never line up.
export const normalizeLeaderboardQuery = (value: string) => value.trim().replace(/^@+/, "");

// The query to actually search for: the normalized input once it is long
// enough, otherwise nothing.
export const effectiveLeaderboardQuery = (value: string) => {
  const next = normalizeLeaderboardQuery(value);
  return next.length >= LEADERBOARD_MIN_QUERY_LENGTH ? next : "";
};

export const Highlight = ({ text, term }: { text: string; term: string }) => {
  const index = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-fuchsia-400/25 px-0.5 text-fuchsia-100">
        {text.slice(index, index + term.length)}
      </mark>
      {text.slice(index + term.length)}
    </>
  );
};

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 3.5 3.5" strokeLinecap="round" />
  </svg>
);

export default function LeaderboardSearchForm({
  search,
  setSearch,
  onSubmit,
  onClear,
  busy,
  label = "Search by Discord username or Riot ID",
  hint = "Partial matches work — try a Discord name, a Riot name, a tag, or a full name#tag.",
  hintId = "leaderboard-search-hint",
}: {
  search: string;
  setSearch: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  busy: boolean;
  label?: string;
  hint?: string;
  hintId?: string;
}) {
  return (
    <form onSubmit={onSubmit} role="search" className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full max-w-sm">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
            <SearchIcon />
          </span>
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.preventDefault();
                onClear();
              }
            }}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={label}
            aria-label={label}
            aria-describedby={hintId}
            className="max-w-full pl-11 pr-10 [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        <button type="submit" className={buttonClassName({ variant: "secondary", size: "md" })}>
          Search
        </button>
      </div>
      <p id={hintId} aria-live="polite" className="text-xs text-slate-500">
        {busy ? "Searching…" : hint}
      </p>
    </form>
  );
}
