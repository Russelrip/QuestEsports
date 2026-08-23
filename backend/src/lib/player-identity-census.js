const crypto = require("crypto");
const { prisma } = require("./prisma");

// Sizes the duplicate-identity surface before any player backfill is designed.
//
// Read-only, and aggregate-only. The whole point is to decide how risky an
// automated merge would be, which needs counts, not people: no email, Riot ID,
// name, or user id ever leaves this module. Values are bucketed by a salted
// digest so collisions can be counted without the values being recoverable.
//
// The backfill this informs is deliberately probabilistic — userId, then
// emailNormalized, then a normalized Riot ID as a CANDIDATE only — so the
// number that matters is how many rows land in the manual merge queue.

// A per-run salt means the digests cannot be matched against a rainbow table or
// correlated across runs. Grouping only has to work within one report.
const RUN_SALT = crypto.randomBytes(16).toString("hex");

const bucket = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(`${RUN_SALT}:${normalized}`).digest("hex");
};

// Riot IDs are typed by humans across three different forms, so they arrive
// with stray whitespace, mixed case, and occasionally a missing tag. Normalize
// the same way a backfill would, so the collision count reflects what a
// backfill would actually see.
const normalizeRiotId = (value) => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  const separator = raw.lastIndexOf("#");
  if (separator <= 0 || separator === raw.length - 1) return null;
  return raw;
};

const countCollisions = (values) => {
  const seen = new Map();
  for (const value of values) {
    if (!value) continue;
    seen.set(value, (seen.get(value) || 0) + 1);
  }
  let colliding = 0;
  let extraRows = 0;
  for (const count of seen.values()) {
    if (count > 1) {
      colliding += 1;
      extraRows += count - 1;
    }
  }
  return { distinct: seen.size, colliding, extraRows };
};

const summarizeRows = (rows) => {
  const withUser = rows.filter((row) => row.userId).length;
  const withEmail = rows.filter((row) => row.emailBucket).length;
  const withRiotId = rows.filter((row) => row.riotBucket).length;
  const unmatchable = rows.filter(
    (row) => !row.userId && !row.emailBucket && !row.riotBucket,
  ).length;

  return {
    rows: rows.length,
    withUserId: withUser,
    withoutUserId: rows.length - withUser,
    withEmail,
    withRiotId,
    // Rows no strategy can key on. These are the ones a backfill must leave
    // alone rather than guess at.
    unmatchableByAnyKey: unmatchable,
    emailCollisions: countCollisions(rows.map((row) => row.emailBucket)),
    riotIdCollisions: countCollisions(rows.map((row) => row.riotBucket)),
  };
};

const collectIdentityRows = async () => {
  const [savedTeamMembers, registrationMembers, registrations, users] = await Promise.all([
    prisma.savedTeamMember.findMany({
      select: { userId: true, emailNormalized: true, riotId: true },
    }),
    prisma.registrationMember.findMany({
      select: { userId: true, emailNormalized: true, riotId: true },
    }),
    prisma.teamRegistration.findMany({
      select: { userId: true, captainEmail: true, captainRiotId: true },
    }),
    prisma.user.findMany({ select: { id: true, emailNormalized: true } }),
  ]);

  return {
    savedTeamMembers: savedTeamMembers.map((row) => ({
      userId: row.userId,
      emailBucket: bucket(row.emailNormalized),
      riotBucket: bucket(normalizeRiotId(row.riotId)),
    })),
    registrationMembers: registrationMembers.map((row) => ({
      userId: row.userId,
      emailBucket: bucket(row.emailNormalized),
      riotBucket: bucket(normalizeRiotId(row.riotId)),
    })),
    registrations: registrations.map((row) => ({
      userId: row.userId,
      emailBucket: bucket(row.captainEmail),
      riotBucket: bucket(normalizeRiotId(row.captainRiotId)),
    })),
    users: users.map((row) => ({
      userId: row.id,
      emailBucket: bucket(row.emailNormalized),
      riotBucket: null,
    })),
  };
};

const previewPlayerIdentityCensus = async () => {
  const sources = await collectIdentityRows();
  const rosterRows = [
    ...sources.savedTeamMembers,
    ...sources.registrationMembers,
    ...sources.registrations,
  ];

  // How many distinct people the roster rows plausibly represent, and how many
  // of them a machine can identify without guessing.
  const linkableByUser = new Set(rosterRows.filter((row) => row.userId).map((row) => row.userId));
  const emailOnly = new Set(
    rosterRows.filter((row) => !row.userId && row.emailBucket).map((row) => row.emailBucket),
  );
  const riotOnly = new Set(
    rosterRows
      .filter((row) => !row.userId && !row.emailBucket && row.riotBucket)
      .map((row) => row.riotBucket),
  );
  const unmatchable = rosterRows.filter(
    (row) => !row.userId && !row.emailBucket && !row.riotBucket,
  ).length;

  const riotCollisions = countCollisions(rosterRows.map((row) => row.riotBucket));

  return {
    generatedAt: new Date().toISOString(),
    note:
      "Aggregate counts only. No email, Riot ID, name, or user id appears in this report; " +
      "values are bucketed with a per-run salt so collisions are countable but not recoverable.",
    sources: {
      users: summarizeRows(sources.users),
      savedTeamMembers: summarizeRows(sources.savedTeamMembers),
      registrationMembers: summarizeRows(sources.registrationMembers),
      teamRegistrations: summarizeRows(sources.registrations),
    },
    backfillProjection: {
      rosterRows: rosterRows.length,
      // Strategy 1: exact, safe.
      identifiedByUserId: linkableByUser.size,
      // Strategy 2: safe if email is unique per person, which the users table
      // enforces but roster rows do not.
      identifiedByEmailOnly: emailOnly.size,
      // Strategy 3: CANDIDATE only. A normalized Riot ID is not proof of
      // identity — this is the number that should make anyone nervous.
      candidateByRiotIdOnly: riotOnly.size,
      unmatchableByAnyKey: unmatchable,
    },
    mergeQueue: {
      // Riot IDs appearing on rows that no stronger key resolves are exactly
      // the rows a human has to look at.
      collidingRiotIds: riotCollisions.colliding,
      extraRowsBehindCollisions: riotCollisions.extraRows,
      estimatedManualReviews: riotCollisions.colliding + unmatchable,
    },
  };
};

module.exports = {
  previewPlayerIdentityCensus,
  normalizeRiotId,
  countCollisions,
  summarizeRows,
};
