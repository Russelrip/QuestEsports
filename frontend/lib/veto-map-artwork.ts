// Official map splash art bundled with the site (public/images/maps), used
// whenever a map has no uploaded artwork. Slugs match the catalog seeded in
// backend/prisma/migrations/20260814120000_add_valorant_veto_rooms.
const BUNDLED_MAP_ARTWORK = new Set([
  "abyss", "ascent", "bind", "breeze", "corrode", "fracture",
  "haven", "icebox", "lotus", "pearl", "split", "sunset",
]);

export function vetoMapArtwork(map: { slug: string; artworkUrl?: string | null }): string | null {
  if (map.artworkUrl) return map.artworkUrl;
  return BUNDLED_MAP_ARTWORK.has(map.slug) ? `/images/maps/${map.slug}.webp` : null;
}
