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
export function redirectRenamedTournament(slug: string, segment = ""): void {
  const renamed = renamedTournamentSlug(slug);
  if (renamed) permanentRedirect(`/tournaments/${renamed}${segment}`);
}
