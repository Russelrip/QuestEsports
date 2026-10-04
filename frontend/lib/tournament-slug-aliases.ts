import { permanentRedirect } from "next/navigation";

// A tournament's slug is its public URL, and nothing in the platform records the
// one it used to have. Renaming a tournament therefore breaks every link already
// shared for it -- a Discord post, a bookmark, a tab somebody left open
// mid-registration -- with no way to tell it happened. Anything renamed is listed
// here, keyed by the slug that used to work, so the old URL keeps resolving.
//
// A Map rather than an object literal: the key is whatever the URL happened to
// contain, and an object would answer "constructor" or "toString" with something
// off Object.prototype, turning a 404 into a redirect to a stringified function.
// The platform records retired slugs itself now, and the API resolves them: a
// request for one answers with the tournament, carrying its current slug, which
// `redirectToCanonicalSlug` below acts on. This map is only the rename that
// predates that table, applied directly to the database with no row to show for
// it. Nothing new belongs here -- rename through the admin and it is recorded.
const RENAMED_TOURNAMENT_SLUGS = new Map<string, string>([
  // 2026-10-03: "acension" was a misspelling of "ascension".
  ["quest-acension-valorant-dm", "quest-ascension-valorant-dm"],
]);

export const renamedTournamentSlug = (slug: string): string | null =>
  RENAMED_TOURNAMENT_SLUGS.get(slug) ?? null;

// Called before the tournament is looked up, and deliberately not on the 404
// path. Reacting to the 404 reads better -- the entry stays inert until the old
// slug really stops resolving -- but it does not work: these routes fetch with
// `next: { revalidate }`, and Next's Data Cache serves a stale entry while
// revalidating without evicting it when that revalidation fails. After a rename
// every refresh 404s, the eviction never comes, and a warm entry serves the old
// page indefinitely, so the redirect never engages. Checking first depends on no
// cache state at all.
//
// The cost is ordering: an entry here redirects immediately, so it must be
// deployed only once the new slug exists. Rename first, then deploy this --
// the old URL 404s in between, rather than redirecting somewhere that is not
// there yet. `segment` carries the rest of the path, such as "/register".
// Next hands a page every query parameter it was called with, whatever the page
// declares, so the whole object is rebuilt rather than the one key a route reads.
// Dropping the query would land somebody on the right page missing the state the
// link carried -- the detail route reads `payment` to confirm a payment came back.
type TournamentQuery = Record<string, string | string[] | undefined>;

const toQueryString = (query?: TournamentQuery): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  const search = params.toString();
  return search ? `?${search}` : "";
};

// Separated from the redirect so the path can be asserted without standing up
// Next's navigation machinery.
export const renamedTournamentPath = (
  slug: string,
  segment = "",
  query?: TournamentQuery,
): string | null => {
  const renamed = renamedTournamentSlug(slug);
  return renamed ? `/tournaments/${renamed}${segment}${toQueryString(query)}` : null;
};

export function redirectRenamedTournament(
  slug: string,
  segment = "",
  query?: TournamentQuery,
): void {
  const target = renamedTournamentPath(slug, segment, query);
  if (target) permanentRedirect(target);
}

// The API answers a retired slug with the tournament that now owns it, so a
// mismatch between what was asked for and what came back is the rename showing
// through. Unlike the map above this needs no deploy per rename, and unlike
// reacting to a 404 it is not defeated by a stale cache entry: the fetch
// succeeds, so the entry refreshes and carries the new slug with it.
export function redirectToCanonicalSlug(
  requestedSlug: string,
  canonicalSlug: string,
  segment = "",
  query?: TournamentQuery,
): void {
  if (requestedSlug === canonicalSlug) return;
  permanentRedirect(`/tournaments/${canonicalSlug}${segment}${toQueryString(query)}`);
}
