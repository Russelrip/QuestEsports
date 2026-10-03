import { notFound, permanentRedirect } from "next/navigation";

// A tournament's slug is its public URL, and nothing in the platform records the
// one it used to have. Renaming a tournament therefore breaks every link already
// shared for it -- a Discord post, a bookmark, a tab somebody left open
// mid-registration -- with no way to tell it happened. Anything renamed is listed
// here, keyed by the slug that used to work, so the old URL keeps resolving.
// A Map rather than an object literal: the key is whatever the URL happened to
// contain, and an object would answer "constructor" or "toString" with something
// off Object.prototype, turning a 404 into a redirect to a stringified function.
const RENAMED_TOURNAMENT_SLUGS = new Map<string, string>([
  // 2026-10-03: "acension" was a misspelling of "ascension".
  ["quest-acension-valorant-dm", "quest-ascension-valorant-dm"],
]);

export const renamedTournamentSlug = (slug: string): string | null =>
  RENAMED_TOURNAMENT_SLUGS.get(slug) ?? null;

// Stands in for notFound() on the routes that take a tournament slug, and is
// reached only once that slug has already failed to resolve. An entry can
// therefore be added before the rename lands: while the old slug still answers,
// nothing gets here, and the moment it stops the old URL redirects instead of
// going dark. `segment` carries the rest of the path, such as "/register".
// Declared, not an arrow const: TypeScript only lets a call narrow control flow
// as never-returning when the callee is a function declaration or an explicitly
// annotated const, and callers rely on that exactly as they did on notFound().
export function redirectRenamedTournament(slug: string, segment = ""): never {
  const renamed = renamedTournamentSlug(slug);
  if (renamed) permanentRedirect(`/tournaments/${renamed}${segment}`);
  notFound();
}
