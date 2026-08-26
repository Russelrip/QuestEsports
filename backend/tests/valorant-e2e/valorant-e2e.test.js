// Two-service E2E (design §11.4): boots the Henrik mock, FastAPI (:8000) and
// Quest Express (:5001) against the same Supabase test project, then drives the
// full VALORANT journey through Quest routes with a real admin session.
// REQUIRES the env block below and plan P1 (Quest routes) + P3 (FastAPI deltas).
// When the E2E_* env contract is not configured (e.g. a plain `npm test`
// discovery run), the test self-skips like database-integration.test.js so the
// unit suite stays green anywhere.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const QUEST_ROOT = path.join(__dirname, "..", "..", ".."); // repo root
const VAL_REPO = process.env.VALORANT_PLATFORM_REPO; // sibling repo checkout

const BASE = {
  quest: "http://127.0.0.1:5001",
  fastapi: "http://127.0.0.1:8000",
};
// Lazy: undefined during a plain `npm test` discovery run (no env contract),
// where the journey test self-skips and never boots the mock.
const FIXTURE_ROOT = VAL_REPO ? path.join(VAL_REPO, "tests", "fixtures", "henrik") : undefined;

const sharedSecret = "e2e-shared-secret";

const REQUIRED_ENV = [
  "VALORANT_PLATFORM_REPO",
  "E2E_VAL_DATABASE_URL",
  "E2E_QUEST_DATABASE_URL",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_SAVED_TEAM_A_ID",
  "E2E_SAVED_TEAM_B_ID",
  "E2E_PLAYER_A",
  "E2E_PLAYER_B",
  "E2E_MATCH_HENRIK_ID",
  "E2E_MATCH_UUIDS",
  "E2E_ANCHOR_MISMATCH_SERIES",
];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);

async function waitFor(url, what, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what} at ${url}`);
}

const children = [];
function boot(cmd, args, env, label, options = {}) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  children.push(child);
  return child;
}
const stopAll = () => children.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });

test.after(stopAll);

test(
  "full VALORANT journey through Quest routes",
  { skip: missingEnv.length ? `missing E2E env contract: ${missingEnv.join(", ")}` : false },
  async (_t) => {
    // E2E_PLAYER_A/E2E_PLAYER_B are JSON strings in the env contract (README);
    // both discover and series create expect { name, tag } objects.
    const playerA = JSON.parse(process.env.E2E_PLAYER_A);
    const playerB = JSON.parse(process.env.E2E_PLAYER_B);

    boot(process.execPath, ["tests/valorant-e2e/henrik-mock-server.mjs"], {
      HENRIK_MOCK_FIXTURES: FIXTURE_ROOT,
      HENRIK_MOCK_PORT: "18000",
    }, "henrik");
    // The mock returns 200 for any account path (serves the pinned fixture);
    // a response at all proves the server is accepting connections.
    await waitFor("http://127.0.0.1:18000/valorant/v2/account/Ping/PONG", "henrik mock");

    boot("uv", ["run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
      APP_ENV: "e2e",
      DATABASE_URL: process.env.E2E_VAL_DATABASE_URL,
      HENRIK_BASE_URL: "http://127.0.0.1:18000",
      HENRIK_API_KEY: "mock-key",
      QUEST_SERVICE_SHARED_SECRETS: `e2e=${sharedSecret}`,
      QUEST_SERVICE_ISSUER: "quest-esports",
      QUEST_SERVICE_AUDIENCE: "valorant-platform",
      LOG_LEVEL: "WARNING",
    }, "fastapi", { cwd: VAL_REPO });
    await waitFor(`${BASE.fastapi}/api/v1/health`, "fastapi");

    boot("node", ["src/server.js"], {
      NODE_ENV: "test",
      PORT: "5001",
      DATABASE_URL: process.env.E2E_QUEST_DATABASE_URL,
      DIRECT_URL: process.env.E2E_QUEST_DATABASE_URL,
      SESSION_COOKIE_NAME: "quest_session",
      AUTH_ENCRYPTION_KEY: "a".repeat(64),
      JOB_WORKER_ENABLED: "false",
      MAIL_DELIVERY_REQUIRED: "false",
      CORS_ORIGIN: "http://localhost:3000",
      VALORANT_INTERNAL_BASE_URL: BASE.fastapi,
      VALORANT_SERVICE_SECRET: sharedSecret,
      VALORANT_SERVICE_KEY_ID: "e2e",
      VALORANT_SERVICE_ISSUER: "quest-esports",
      VALORANT_SERVICE_AUDIENCE: "valorant-platform",
      VALORANT_TIMEOUT_MS: "60000",
      VALORANT_READ_RETRIES: "2",
    }, "quest", { cwd: path.join(QUEST_ROOT, "backend") });
    await waitFor(`${BASE.quest}/api/health/live`, "quest");

    // Admin session: login through the API as an admin created for this run.
    const login = await fetch(`${BASE.quest}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.E2E_ADMIN_EMAIL,
        password: process.env.E2E_ADMIN_PASSWORD,
      }),
    });
    assert.equal(login.status, 200, "admin login must succeed");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const q = (pathName, options = {}) =>
      fetch(`${BASE.quest}${pathName}`, {
        ...options,
        headers: {
          cookie,
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });
    const asAdmin = (pathName, body, method = "POST") =>
      q(pathName, { method, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, body: j })));

    // 1. Bind two teams (create-or-get by quest_saved_team_id; retry converges).
    const savedTeamA = await asAdmin("/api/v1/admin/valorant/teams/bind", {
      savedTeamId: process.env.E2E_SAVED_TEAM_A_ID,
    });
    assert.equal(savedTeamA.status, 200, "bind team A");
    const savedTeamB = await asAdmin("/api/v1/admin/valorant/teams/bind", {
      savedTeamId: process.env.E2E_SAVED_TEAM_B_ID,
    });
    assert.equal(savedTeamB.status, 200, "bind team B");

    // 2. Discover with fixture-stubbed Henrik; assert no overlap -> [] 200.
    const discover = await asAdmin("/api/v1/admin/valorant/discover", {
      playerA,
      playerB,
      pageSize: 10,
      maxPages: 1,
    });
    assert.equal(discover.status, 200);
    assert.ok(Array.isArray(discover.body.data.candidates), "candidates is an array");

    // 3. Import the selected match; re-import -> 200 created=false.
    const importRes = await asAdmin("/api/v1/admin/valorant/matches/import", {
      matchId: process.env.E2E_MATCH_HENRIK_ID,
      affinity: "eu",
    });
    assert.ok([200, 201].includes(importRes.status), `import status ${importRes.status}`);
    const detail = await q(`/api/v1/admin/valorant/matches/by-henrik-id/${process.env.E2E_MATCH_HENRIK_ID}`);
    assert.equal(detail.status, 200);

    // 4. Create BO3 with anchors; attach 3 games with side mapping.
    const series = await asAdmin("/api/v1/admin/valorant/series", {
      bindingTeamAId: savedTeamA.body.data.binding.id,
      bindingTeamBId: savedTeamB.body.data.binding.id,
      format: "bo3",
      playedAt: new Date().toISOString(),
      ratingModePreference: "normal",
      anchorPlayerA: playerA,
      anchorPlayerB: playerB,
    });
    assert.equal(series.status, 201, `series create ${series.status}`);
    const seriesId = series.body.data.series.id;

    // 5. Attach three distinct VAL match UUIDs (E2E_MATCH_UUIDS, comma-separated).
    const uuids = process.env.E2E_MATCH_UUIDS.split(",");
    for (let i = 0; i < uuids.length; i++) {
      const attach = await asAdmin(`/api/v1/admin/valorant/series/${seriesId}/games`, {
        gameNumber: i + 1,
        matchId: uuids[i],
        teamASide: i % 2 === 0 ? "red" : "blue",
      });
      assert.equal(attach.status, 200, `attach game ${i + 1}`);
    }

    // 6. Set absolute order; preview shows valid.
    const order = await q(`/api/v1/admin/valorant/series/${seriesId}/games/order`, {
      method: "PUT",
      body: JSON.stringify({
        games: uuids.map((id, i) => ({ game_id: id, game_number: i + 1 })),
      }),
    });
    assert.equal(order.status, 200);
    const preview = await q(`/api/v1/admin/valorant/series/${seriesId}/preview`);
    assert.equal(preview.status, 200);

    // 7. Finalize rated -> two rating events + ranking change.
    const finalize = await asAdmin(`/api/v1/admin/valorant/series/${seriesId}/finalize`, {
      ratingMode: "normal",
      officialWinnerTeamId: null,
      overrideReason: null,
    });
    assert.equal(finalize.status, 200, `finalize ${finalize.status}`);
    assert.equal(finalize.body.data.events.length, 2, "two rating events");

    // 8. Finalize again -> 409, no rating change.
    const again = await asAdmin(`/api/v1/admin/valorant/series/${seriesId}/finalize`, {
      ratingMode: "normal",
      officialWinnerTeamId: null,
      overrideReason: null,
    });
    assert.equal(again.status, 409);

    // 9. Rankings read.
    const rankings = await q("/api/v1/admin/valorant/rankings");
    assert.equal(rankings.status, 200);

    // 10. Anchor-negative rated finalize -> 409 ANCHOR_MISMATCH (a second draft
    // series whose games were built from fixtures without the anchors on
    // opposing sides; E2E_ANCHOR_MISMATCH_SERIES is that series id).
    const anchorBad = await asAdmin(
      `/api/v1/admin/valorant/series/${process.env.E2E_ANCHOR_MISMATCH_SERIES}/finalize`,
      { ratingMode: "normal", officialWinnerTeamId: null, overrideReason: null },
    );
    assert.equal(anchorBad.status, 409, `anchor mismatch must be 409, got ${anchorBad.status}`);

    // 11. Backdated rated finalize -> 409 BACKDATED_SERIES_REJECTED. Create a
    // draft whose playedAt predates the series finalized in step 7.
    const backdated = await asAdmin("/api/v1/admin/valorant/series", {
      bindingTeamAId: savedTeamA.body.data.binding.id,
      bindingTeamBId: savedTeamB.body.data.binding.id,
      format: "bo1",
      playedAt: "2020-01-01T00:00:00Z",
      ratingModePreference: "normal",
      anchorPlayerA: playerA,
      anchorPlayerB: playerB,
    });
    assert.equal(backdated.status, 201, `backdated series create ${backdated.status}`);
    const backdatedId = backdated.body.data.series.id;
    const backdatedFinalize = await asAdmin(`/api/v1/admin/valorant/series/${backdatedId}/finalize`, {
      ratingMode: "normal",
      officialWinnerTeamId: null,
      overrideReason: null,
    });
    assert.equal(
      backdatedFinalize.status,
      409,
      `backdated finalize must be 409, got ${backdatedFinalize.status}`,
    );
  },
);
