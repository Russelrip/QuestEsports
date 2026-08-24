const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/rulebooks/rulebook-version.service.js",
);
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260825010000_add_rulebook_versioning/migration.sql",
);

const load = (prisma) => loadModuleWithMocks(servicePath, {
  [prismaModulePath]: { prisma },
});

const stub = ({ rulebooks = [], versions = [], tournaments = [] } = {}) => {
  const created = [];
  const updated = [];
  const db = {
    rulebook: {
      findUnique: async ({ where }) => rulebooks.find((r) => r.id === where.id) ?? null,
    },
    rulebookVersion: {
      findMany: async ({ where }) =>
        versions.filter((v) => v.rulebookId === where.rulebookId),
      findUnique: async ({ where }) => versions.find((v) => v.id === where.id) ?? null,
      findFirst: async ({ where, orderBy }) => {
        let rows = versions.filter((v) => v.rulebookId === where.rulebookId);
        if (where.publishedAt?.not === null) rows = rows.filter((v) => v.publishedAt);
        if (where.effectiveFrom?.lte) {
          rows = rows.filter((v) => v.effectiveFrom <= where.effectiveFrom.lte);
        }
        rows = [...rows].sort((a, b) => b.version - a.version);
        if (Array.isArray(orderBy)) {
          rows.sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.version - a.version);
        }
        return rows[0] ?? null;
      },
      create: async ({ data }) => { created.push(data); return data; },
    },
    tournament: {
      findUnique: async ({ where }) => tournaments.find((t) => t.id === where.id) ?? null,
      update: async (args) => { updated.push(args); return args.data; },
    },
    $transaction: async (fn) => fn(db),
  };
  return { prisma: db, created, updated };
};

test("publishing creates the next version and never mutates an existing one", async () => {
  const { prisma, created } = stub({
    rulebooks: [{ id: "rb1" }],
    versions: [
      { id: "v1", rulebookId: "rb1", version: 1, publishedAt: new Date("2026-01-01") },
      { id: "v2", rulebookId: "rb1", version: 2, publishedAt: new Date("2026-05-01") },
    ],
  });
  const { module: service, restore } = load(prisma);
  try {
    await service.publishVersion({ rulebookId: "rb1", content: "new rules" });
    assert.equal(created.length, 1);
    assert.equal(created[0].version, 3);
    assert.equal(created[0].content, "new rules");
    assert.ok(created[0].publishedAt instanceof Date);
  } finally {
    restore();
  }
});

test("an unpublished version is a draft", async () => {
  const { prisma, created } = stub({ rulebooks: [{ id: "rb1" }], versions: [] });
  const { module: service, restore } = load(prisma);
  try {
    await service.publishVersion({ rulebookId: "rb1", content: "draft", publish: false });
    assert.equal(created[0].version, 1);
    assert.equal(created[0].publishedAt, null);
  } finally {
    restore();
  }
});

test("publishing requires content and a real rulebook", async () => {
  const { prisma } = stub({ rulebooks: [{ id: "rb1" }] });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(() => service.publishVersion({ rulebookId: "rb1", content: "   " }),
      /content is required/i);
    await assert.rejects(() => service.publishVersion({ rulebookId: "nope", content: "x" }),
      /not found/i);
  } finally {
    restore();
  }
});

// Publishing next season's rules early must not change this season's.
test("a future effectiveFrom is scheduled, not live", async () => {
  const now = new Date("2026-06-01");
  const { prisma } = stub({
    versions: [
      { id: "v1", rulebookId: "rb1", version: 1, content: "old", publishedAt: new Date("2026-01-01"), effectiveFrom: new Date("2026-01-01") },
      { id: "v2", rulebookId: "rb1", version: 2, content: "future", publishedAt: new Date("2026-05-01"), effectiveFrom: new Date("2026-12-01") },
    ],
  });
  const { module: service, restore } = load(prisma);
  try {
    const effective = await service.getEffectiveVersion("rb1", now);
    assert.equal(effective.content, "old");
  } finally {
    restore();
  }
});

test("a draft is never the effective version", async () => {
  const { prisma } = stub({
    versions: [
      { id: "v1", rulebookId: "rb1", version: 1, content: "live", publishedAt: new Date("2026-01-01"), effectiveFrom: new Date("2026-01-01") },
      { id: "v2", rulebookId: "rb1", version: 2, content: "draft", publishedAt: null, effectiveFrom: new Date("2026-02-01") },
    ],
  });
  const { module: service, restore } = load(prisma);
  try {
    assert.equal((await service.getEffectiveVersion("rb1")).content, "live");
  } finally {
    restore();
  }
});

// A tournament governed by text nobody published is the failure this prevents.
test("a tournament cannot be pinned to a draft", async () => {
  const { prisma } = stub({
    versions: [{ id: "v9", rulebookId: "rb1", version: 9, publishedAt: null }],
    tournaments: [{ id: "t1", rulebookId: "rb1" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      () => service.pinVersionToTournament({ tournamentId: "t1", rulebookVersionId: "v9" }),
      /only be pinned to a published/i,
    );
  } finally {
    restore();
  }
});

test("a tournament cannot be pinned to another rulebook's version", async () => {
  const { prisma } = stub({
    versions: [{ id: "v1", rulebookId: "OTHER", version: 1, publishedAt: new Date() }],
    tournaments: [{ id: "t1", rulebookId: "rb1" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(
      () => service.pinVersionToTournament({ tournamentId: "t1", rulebookVersionId: "v1" }),
      /different rulebook/i,
    );
  } finally {
    restore();
  }
});

test("pinning a published version records it on the tournament", async () => {
  const { prisma, updated } = stub({
    versions: [{ id: "v1", rulebookId: "rb1", version: 1, publishedAt: new Date() }],
    tournaments: [{ id: "t1", rulebookId: "rb1" }],
  });
  const { module: service, restore } = load(prisma);
  try {
    await service.pinVersionToTournament({ tournamentId: "t1", rulebookVersionId: "v1" });
    assert.equal(updated[0].data.rulebookVersionId, "v1");
    assert.equal(updated[0].data.rulebookId, "rb1");
  } finally {
    restore();
  }
});

test("hierarchy resolves policy -> game -> tournament, outermost first", async () => {
  const { prisma } = stub({
    rulebooks: [
      { id: "policy", slug: "policy", title: "Quest Competition Policy", layer: "policy", parentId: null },
      { id: "game", slug: "val", title: "VALORANT Rules", layer: "game", parentId: "policy" },
      { id: "event", slug: "lus", title: "Level Up Series", layer: "tournament", parentId: "game" },
    ],
    versions: [
      { id: "pv", rulebookId: "policy", version: 1, content: "conduct", publishedAt: new Date("2026-01-01"), effectiveFrom: new Date("2026-01-01") },
      { id: "gv", rulebookId: "game", version: 1, content: "maps", publishedAt: new Date("2026-01-01"), effectiveFrom: new Date("2026-01-01") },
      { id: "ev", rulebookId: "event", version: 1, content: "eligibility", publishedAt: new Date("2026-01-01"), effectiveFrom: new Date("2026-01-01") },
    ],
  });
  const { module: service, restore } = load(prisma);
  try {
    const chain = await service.resolveHierarchy("event");
    assert.deepEqual(chain.map((c) => c.layer), ["policy", "game", "tournament"]);
    assert.deepEqual(chain.map((c) => c.effectiveVersion.content), ["conduct", "maps", "eligibility"]);
  } finally {
    restore();
  }
});

// A longer cycle than the CHECK constraint blocks must not hang a request.
test("a hierarchy cycle is rejected rather than looping forever", async () => {
  const { prisma } = stub({
    rulebooks: [
      { id: "a", slug: "a", title: "A", layer: "tournament", parentId: "b" },
      { id: "b", slug: "b", title: "B", layer: "game", parentId: "a" },
    ],
  });
  const { module: service, restore } = load(prisma);
  try {
    await assert.rejects(() => service.resolveHierarchy("a"), /cycle/i);
  } finally {
    restore();
  }
});

test("migration is expand-only and preserves the legacy content column", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.doesNotMatch(sql, /DROP\s+(COLUMN|TABLE)/i);
  assert.doesNotMatch(sql, /ALTER TABLE "rulebooks"[\s\S]{0,80}DROP/i);
  // content is COPIED into v1, never moved out of rulebooks.
  assert.match(sql, /SELECT gen_random_uuid\(\), r\."id", 1, r\."content"/);
  // Existing tournaments keep resolving to the same text after cutover.
  assert.match(sql, /UPDATE "tournaments" t/);
  assert.match(sql, /SET "rulebook_version_id" = v\."id"/);
});

test("migration dates v1 from the rulebook, not from migration time", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  // Strip `--` comments first: the prose here explains why now() is wrong, and
  // a naive scan matches the explanation rather than the SQL.
  const statements = sql.replace(/^\s*--.*$/gm, "");
  assert.match(statements, /r\."created_at", r\."created_at"/);
  assert.doesNotMatch(statements, /effective_from[^;]*\bnow\(\)/i);
});

test("migration hardens rulebook_versions against the Supabase Data API", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /ALTER TABLE public\."rulebook_versions" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\."rulebook_versions" FROM PUBLIC/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
});

test("migration blocks a self-parented rulebook in the database", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /rulebooks_parent_not_self_check/);
  assert.match(sql, /"parent_id" IS NULL OR "parent_id" <> "id"/);
});
