const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");

// Versioned, layered rulebooks.
//
// A published version is IMMUTABLE. A tournament pins the version that governed
// it, so an edit two seasons later must not change what a team agreed to.
// Editing published rules means publishing a new version, never rewriting a
// row — every function here is built around that.

const MAX_DEPTH = 8;

const mapVersion = (version) =>
  version && {
    id: version.id,
    version: version.version,
    content: version.content,
    changeSummary: version.changeSummary,
    effectiveFrom: version.effectiveFrom,
    publishedAt: version.publishedAt,
    isPublished: Boolean(version.publishedAt),
  };

const listVersions = async (rulebookId) =>
  (
    await prisma.rulebookVersion.findMany({
      where: { rulebookId },
      orderBy: { version: "desc" },
    })
  ).map(mapVersion);

// The version in force right now: highest published version whose
// effectiveFrom has passed. A version dated in the future is scheduled, not
// live, so publishing next season's rules early does not change this season's.
const getEffectiveVersion = async (rulebookId, at = new Date()) => {
  const version = await prisma.rulebookVersion.findFirst({
    where: {
      rulebookId,
      publishedAt: { not: null },
      effectiveFrom: { lte: at },
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  return mapVersion(version);
};

// Publishing never mutates an existing version. The next number is derived
// inside a transaction so two admins publishing at once cannot collide on the
// unique (rulebookId, version).
const publishVersion = async ({
  rulebookId,
  content,
  changeSummary = null,
  effectiveFrom = null,
  publish = true,
}) => {
  if (!content || !String(content).trim()) {
    throw new HttpError(400, "Rulebook content is required.");
  }

  return prisma.$transaction(async (tx) => {
    const rulebook = await tx.rulebook.findUnique({
      where: { id: rulebookId },
      select: { id: true },
    });
    if (!rulebook) throw new HttpError(404, "Rulebook not found.");

    const latest = await tx.rulebookVersion.findFirst({
      where: { rulebookId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const now = new Date();
    return tx.rulebookVersion.create({
      data: {
        id: crypto.randomUUID(),
        rulebookId,
        version: (latest?.version ?? 0) + 1,
        content: String(content),
        changeSummary: changeSummary ? String(changeSummary).trim() || null : null,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : now,
        publishedAt: publish ? now : null,
      },
    });
  });
};

// Pin a tournament to a specific version. Refuses a draft: a tournament must
// never be governed by text nobody has published, and refuses a version
// belonging to a different rulebook, which is the copy-paste mistake an admin
// UI makes.
const pinVersionToTournament = async ({ tournamentId, rulebookVersionId }) => {
  const version = await prisma.rulebookVersion.findUnique({
    where: { id: rulebookVersionId },
    select: { id: true, rulebookId: true, publishedAt: true },
  });
  if (!version) throw new HttpError(404, "Rulebook version not found.");
  if (!version.publishedAt) {
    throw new HttpError(400, "A tournament can only be pinned to a published rulebook version.");
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, rulebookId: true },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  if (tournament.rulebookId && tournament.rulebookId !== version.rulebookId) {
    throw new HttpError(
      400,
      "That version belongs to a different rulebook than the one attached to this tournament.",
    );
  }

  return prisma.tournament.update({
    where: { id: tournamentId },
    data: { rulebookVersionId: version.id, rulebookId: version.rulebookId },
  });
};

// Walk policy -> game -> tournament, outermost first, so a reader sees the
// standing rules before the event-specific ones that qualify them.
//
// Depth-capped rather than trusting the data: the one-step self-reference is
// blocked by a CHECK, but a longer cycle would otherwise hang a request.
const resolveHierarchy = async (rulebookId, at = new Date()) => {
  const chain = [];
  const seen = new Set();
  let currentId = rulebookId;

  while (currentId && chain.length < MAX_DEPTH) {
    if (seen.has(currentId)) {
      throw new HttpError(409, "Rulebook hierarchy contains a cycle.");
    }
    seen.add(currentId);

    const rulebook = await prisma.rulebook.findUnique({
      where: { id: currentId },
      select: { id: true, slug: true, title: true, layer: true, parentId: true },
    });
    if (!rulebook) break;

    chain.push({
      id: rulebook.id,
      slug: rulebook.slug,
      title: rulebook.title,
      layer: rulebook.layer,
      effectiveVersion: await getEffectiveVersion(rulebook.id, at),
    });
    currentId = rulebook.parentId;
  }

  // Collected child-first; return outermost-first.
  return chain.reverse();
};

module.exports = {
  MAX_DEPTH,
  listVersions,
  getEffectiveVersion,
  publishVersion,
  pinVersionToTournament,
  resolveHierarchy,
};
