# Valorant Player Leaderboard (Quest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, read-only Sri Lankan Valorant player leaderboard page to Quest, proxying `valorantsl-new`'s leaderboard API server-to-server, in Quest styling.

**Architecture:** A new `valorant-leaderboard` module in the Quest Express BFF (client → service → controller) exposes two public, cached routes (`/api/v1/valorant/leaderboard`, `/api/v1/valorant/leaderboard/search`) that proxy `valorantsl-new`'s anonymous leaderboard API. A new public Next.js App Router page fetches those routes server-side and renders a search box, top-10 highlight, and paginated table in Quest styling. Registration stays in `valorantsl-new`; the page links out to it.

**Tech Stack:** Node 24, Express 5 (CommonJS), `node:test`; Next.js 16 App Router, React 19, Tailwind CSS v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md`

## Global Constraints

- Backend is CommonJS (`"type": "commonjs"`); use `require`/`module.exports`, never ESM imports.
- Every response uses the envelope `{ success: true, data: <payload>, meta: { serverNow: new Date().toISOString() } }`; errors go through `HttpError` (the global error handler emits `body.error.code`).
- Public routes carry **no auth** and are cached with `cachePublicData()` + `cacheJson({ ttlSeconds: 60, tags: ["foundation"] })`.
- Upstream `valorantsl-new` fields are snake_case; Quest projections are camelCase (mirror `valorant.mapper.js`).
- Upstream `per_page` is capped at **200**; Quest clamps incoming `per_page` to `[1, 200]`.
- Frontend path alias `@/*` → `frontend/`; public pages are server components that fetch via `fetchApiJson` and render a `"use client"` content component inside `PageLayout`.
- Frontend must **never** reference `api.henrikdev`, `valorant-platform-backend`, `X-Admin-Key`, `VALORANT_SERVICE_SECRET`, or `localhost:8000` (source-assertion tests enforce this).
- Register CTA target: `NEXT_PUBLIC_VALORANT_SL_REGISTER_URL` with fallback `https://valorantsl.com/register`.
- Backend run: `cd backend && node --test tests/<file>`. Frontend run: `cd frontend && npx vitest run tests/unit/<file>`.
- Commit style mirrors the repo: `feat(valorant-leaderboard): <short>`.

---

### Task 1: `valorant-leaderboard` client + env config

**Files:**
- Create: `backend/src/modules/valorant-leaderboard/client.js`
- Modify: `backend/src/config/env.js` (add one env field)
- Modify: `backend/.env.example` (document the var)
- Test: `backend/tests/valorant-leaderboard.client.test.js`

**Interfaces:**
- Consumes: `env.VALORANT_SL_API_URL` (new), `HttpError` from `../../lib/http-error`.
- Produces: `getLeaderboard({ page, perPage })` → raw upstream `LeaderboardResponse`; `searchLeaderboard(query)` → raw upstream `LeaderboardEntry | null`. Both `async`, throw `HttpError` (503 unconfigured/unavailable, 404 page-not-found).

- [ ] **Step 1: Add the env field**

In `backend/src/config/env.js`, insert directly after the `VALORANT_READ_RETRIES` entry (after line 192), before `NODE_ENV`:

```js
  VALORANT_SL_API_URL: optional("VALORANT_SL_API_URL"),
```

In `backend/.env.example`, append after the `VALORANT_READ_RETRIES=2` line (line 119):

```
# VALORANT SL player leaderboard (Quest backend -> valorantsl-new public API).
# Optional: when unset, the public leaderboard routes return 503 (fail-soft).
VALORANT_SL_API_URL=
```

- [ ] **Step 2: Write the failing client test**

Create `backend/tests/valorant-leaderboard.client.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const envWithUrl = { env: { VALORANT_SL_API_URL: "https://api.valorantsl.com" } };
const envWithoutUrl = { env: { VALORANT_SL_API_URL: "" } };

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const loadClient = (envMock) => loadModuleWithMocks(clientPath, { [envPath]: envMock });

test("getLeaderboard builds the upstream query and returns the parsed payload", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { entries: [], total: 0, page: 1, per_page: 50, total_pages: 1 });
  };
  try {
    const { module: client } = loadClient(envWithUrl);
    const result = await client.getLeaderboard({ page: 2, perPage: 25 });
    assert.equal(capturedUrl, "https://api.valorantsl.com/api/v1/leaderboard?page=2&per_page=25");
    assert.equal(result.total_pages, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchLeaderboard URL-encodes the query and passes through a null result", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return jsonResponse(200, null);
  };
  try {
    const { module: client } = loadClient(envWithUrl);
    const result = await client.searchLeaderboard("john#1234");
    assert.equal(capturedUrl, "https://api.valorantsl.com/api/v1/leaderboard/search/john%231234");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 503 when VALORANT_SL_API_URL is not configured", async () => {
  const { module: client } = loadClient(envWithoutUrl);
  await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
});

test("throws 503 on transport failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient(envWithUrl);
    await assert.rejects(client.getLeaderboard({ page: 1, perPage: 50 }), (e) => e.statusCode === 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws 404 when upstream reports an out-of-range page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(404, { detail: "Page 999 not found." });
  try {
    const { module: client } = loadClient(envWithUrl);
    await assert.rejects(client.getLeaderboard({ page: 999, perPage: 50 }), (e) => e.statusCode === 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && node --test tests/valorant-leaderboard.client.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant-leaderboard/client.js'`.

- [ ] **Step 4: Implement the client**

Create `backend/src/modules/valorant-leaderboard/client.js`:

```js
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");

const TIMEOUT_MS = 5000;

const getBaseUrl = () => {
  const baseUrl = env.VALORANT_SL_API_URL;
  if (!baseUrl) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
};

const get = async (path) => {
  const baseUrl = getBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
  } catch {
    throw new HttpError(503, "VALORANT leaderboard is unavailable.");
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return response.json();
  }
  if (response.status === 404) {
    throw new HttpError(404, "Leaderboard page not found.");
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

const getLeaderboard = async ({ page = 1, perPage = 50 }) => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return get(`/api/v1/leaderboard?${params.toString()}`);
};

const searchLeaderboard = async (query) =>
  get(`/api/v1/leaderboard/search/${encodeURIComponent(query)}`);

module.exports = { getLeaderboard, searchLeaderboard };
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd backend && node --test tests/valorant-leaderboard.client.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/src/modules/valorant-leaderboard/client.js backend/src/config/env.js backend/.env.example backend/tests/valorant-leaderboard.client.test.js
git commit -m "feat(valorant-leaderboard): add anonymous upstream client"
```

---

### Task 2: `valorant-leaderboard` service (mapping)

**Files:**
- Create: `backend/src/modules/valorant-leaderboard/service.js`
- Test: `backend/tests/valorant-leaderboard.service.test.js`

**Interfaces:**
- Consumes: `getLeaderboard`, `searchLeaderboard` from `./client`.
- Produces: `listLeaderboard({ page, perPage })` → `{ entries: ValorantPlayerLeaderboardEntry[], total, page, perPage, totalPages }`; `searchLeaderboardPlayer(query)` → `ValorantPlayerLeaderboardEntry | null`. Entry fields are camelCase: `puuid, name, tag, discordUsername, currentTier, elo, rankInTier, peakRank, peakSeason, lastPlayed`.

- [ ] **Step 1: Write the failing service test**

Create `backend/tests/valorant-leaderboard.service.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");
const clientPath = path.join(__dirname, "../src/modules/valorant-leaderboard/client.js");

const loadService = (clientMock) => loadModuleWithMocks(servicePath, { [clientPath]: clientMock });

test("listLeaderboard maps the paginated upstream payload to camelCase", async () => {
  const clientMock = {
    getLeaderboard: async () => ({
      entries: [
        { puuid: "p-1", name: "Sahan", tag: "QST", discord_username: "sahan", current_tier: "Diamond 2", elo: 1520, rank_in_tier: 40, peak_rank: "Ascendant 1", peak_season: "e10a1", last_played_match: "2026-08-10T00:00:00Z" },
      ],
      total: 1, page: 1, per_page: 50, total_pages: 1,
    }),
    searchLeaderboard: async () => null,
  };
  const { module: service } = loadService(clientMock);
  const result = await service.listLeaderboard({ page: 1, perPage: 50 });
  assert.deepEqual(result.entries[0], {
    puuid: "p-1", name: "Sahan", tag: "QST", discordUsername: "sahan", currentTier: "Diamond 2",
    elo: 1520, rankInTier: 40, peakRank: "Ascendant 1", peakSeason: "e10a1", lastPlayed: "2026-08-10T00:00:00Z",
  });
  assert.equal(result.perPage, 50);
  assert.equal(result.totalPages, 1);
});

test("searchLeaderboardPlayer maps a found entry", async () => {
  const clientMock = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => ({ puuid: "p-2", name: "Russel", tag: "QST", discord_username: "russel", current_tier: "Platinum 3", elo: 900, rank_in_tier: 10, peak_rank: "Diamond 1", peak_season: "e9a3", last_played_match: null }),
  };
  const { module: service } = loadService(clientMock);
  const result = await service.searchLeaderboardPlayer("russel");
  assert.equal(result.discordUsername, "russel");
  assert.equal(result.peakRank, "Diamond 1");
  assert.equal(result.lastPlayed, null);
});

test("searchLeaderboardPlayer returns null when upstream has no match", async () => {
  const clientMock = {
    getLeaderboard: async () => ({}),
    searchLeaderboard: async () => null,
  };
  const { module: service } = loadService(clientMock);
  assert.equal(await service.searchLeaderboardPlayer("nobody"), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test tests/valorant-leaderboard.service.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant-leaderboard/service.js'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/valorant-leaderboard/service.js`:

```js
const { getLeaderboard, searchLeaderboard } = require("./client");

// valorantsl-new LeaderboardEntry (snake_case) -> Quest projection (camelCase).
// Field names come from valorantsl-new backend/app/models/user.py LeaderboardEntry.
const mapLeaderboardEntry = (entry) => ({
  puuid: entry.puuid,
  name: entry.name,
  tag: entry.tag,
  discordUsername: entry.discord_username,
  currentTier: entry.current_tier ?? null,
  elo: entry.elo ?? null,
  rankInTier: entry.rank_in_tier ?? null,
  peakRank: entry.peak_rank ?? null,
  peakSeason: entry.peak_season ?? null,
  lastPlayed: entry.last_played_match ?? null,
});

const listLeaderboard = async ({ page = 1, perPage = 50 } = {}) => {
  const raw = await getLeaderboard({ page, perPage });
  return {
    entries: (raw.entries || []).map(mapLeaderboardEntry),
    total: raw.total ?? 0,
    page: raw.page ?? page,
    perPage: raw.per_page ?? perPage,
    totalPages: raw.total_pages ?? 1,
  };
};

const searchLeaderboardPlayer = async (query) => {
  const raw = await searchLeaderboard(query);
  return raw ? mapLeaderboardEntry(raw) : null;
};

module.exports = { listLeaderboard, searchLeaderboardPlayer };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && node --test tests/valorant-leaderboard.service.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/src/modules/valorant-leaderboard/service.js backend/tests/valorant-leaderboard.service.test.js
git commit -m "feat(valorant-leaderboard): map upstream payload to camelCase projections"
```

---

### Task 3: `valorant-leaderboard` controller

**Files:**
- Create: `backend/src/modules/valorant-leaderboard/controller.js`
- Test: `backend/tests/valorant-leaderboard.controller.test.js`

**Interfaces:**
- Consumes: `listLeaderboard`, `searchLeaderboardPlayer` from `./service`; `asyncHandler` from `../../lib/async-handler`.
- Produces: Express handlers `getLeaderboard(req, res)` and `searchLeaderboard(req, res)` writing the `{ success, data, meta }` envelope. `getLeaderboard` reads `req.query.page` / `req.query.per_page` (clamped). `searchLeaderboard` reads `req.query.q`.

- [ ] **Step 1: Write the failing controller test**

Create `backend/tests/valorant-leaderboard.controller.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");
const servicePath = path.join(__dirname, "../src/modules/valorant-leaderboard/service.js");

const makeRes = () => {
  const calls = { status: 200, json: undefined };
  const res = {
    statusCode: 200,
    status(code) { calls.status = code; return res; },
    json(body) { calls.json = body; return res; },
  };
  return { res, calls };
};

const loadController = (serviceMock) => loadModuleWithMocks(controllerPath, { [servicePath]: serviceMock });

test("getLeaderboard wraps the mapped page in the Quest envelope", async () => {
  const serviceMock = {
    listLeaderboard: async ({ page, perPage }) => ({ entries: [], total: 0, page, perPage, totalPages: 1 }),
    searchLeaderboardPlayer: async () => null,
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.getLeaderboard({ query: { page: "2", per_page: "25" } }, res);
  assert.equal(calls.status, 200);
  assert.equal(calls.json.success, true);
  assert.equal(calls.json.data.page, 2);
  assert.equal(calls.json.data.perPage, 25);
});

test("getLeaderboard clamps per_page to the upstream max of 200", async () => {
  let seenPerPage;
  const serviceMock = {
    listLeaderboard: async ({ perPage }) => { seenPerPage = perPage; return { entries: [], total: 0, page: 1, perPage, totalPages: 1 }; },
    searchLeaderboardPlayer: async () => null,
  };
  const { module: controller } = loadController(serviceMock);
  const { res } = makeRes();
  await controller.getLeaderboard({ query: { page: "1", per_page: "9999" } }, res);
  assert.equal(seenPerPage, 200);
});

test("searchLeaderboard returns { entry: null } for a blank query", async () => {
  const serviceMock = {
    listLeaderboard: async () => ({}),
    searchLeaderboardPlayer: async (q) => (q === "sahan" ? { puuid: "p-1", name: "Sahan" } : null),
  };
  const { module: controller } = loadController(serviceMock);
  const { res, calls } = makeRes();
  await controller.searchLeaderboard({ query: {} }, res);
  assert.equal(calls.json.data.entry, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test tests/valorant-leaderboard.controller.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant-leaderboard/controller.js'`.

- [ ] **Step 3: Implement the controller**

Create `backend/src/modules/valorant-leaderboard/controller.js`:

```js
const { asyncHandler } = require("../../lib/async-handler");
const { listLeaderboard, searchLeaderboardPlayer } = require("./service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listLeaderboard({ page, perPage });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const entry = query ? await searchLeaderboardPlayer(query) : null;
  res.status(200).json({ success: true, data: { entry }, meta: { serverNow: new Date().toISOString() } });
});

module.exports = { getLeaderboard, searchLeaderboard };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && node --test tests/valorant-leaderboard.controller.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/src/modules/valorant-leaderboard/controller.js backend/tests/valorant-leaderboard.controller.test.js
git commit -m "feat(valorant-leaderboard): add controller handlers"
```

---

### Task 4: Wire routes + OpenAPI + docs

**Files:**
- Modify: `backend/src/routes/v1.js` (import + 2 cache instances + 2 routes)
- Modify: `backend/src/lib/openapi.js` (2 operations)
- Modify: `backend/tests/valorant-routes.test.js` (mock the new controller + assert the 2 routes)
- Modify: `docs/api-documentation.md` (new public section)

**Interfaces:**
- Consumes: controller handlers from Task 3; `cachePublicData`, `cacheJson` (already imported in v1.js).
- Produces: `GET /api/v1/valorant/leaderboard` and `GET /api/v1/valorant/leaderboard/search` (public, cached).

- [ ] **Step 1: Wire the routes**

In `backend/src/routes/v1.js`:

1. After line 5 (the existing `valorantController` require), add:

```js
const valorantLeaderboardController = require("../modules/valorant-leaderboard/controller");
```

2. After the `bracketResponseCache` declaration (after line 27), add:

```js
const leaderboardPublicCache = cachePublicData({ browserSeconds: 0, sharedSeconds: 60 });
const leaderboardCache = cacheJson({ ttlSeconds: 60, tags: ["foundation"] });
```

3. After the `/events` route (line 56), before the admin block (line 58), add:

```js
router.get("/valorant/leaderboard", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.getLeaderboard);
router.get("/valorant/leaderboard/search", leaderboardPublicCache, leaderboardCache, valorantLeaderboardController.searchLeaderboard);
```

- [ ] **Step 2: Document the routes in OpenAPI**

In `backend/src/lib/openapi.js`, immediately after the `/api/v1/admin/valorant/reconciliation` entry (line 889), add:

```js
  "/api/v1/valorant/leaderboard": {
    get: createOperation("valorant", "List the public VALORANT player leaderboard (paginated, ELO-desc)"),
  },
  "/api/v1/valorant/leaderboard/search": {
    get: createOperation("valorant", "Search the public VALORANT player leaderboard by Discord username"),
  },
```

- [ ] **Step 3: Extend the routes test**

In `backend/tests/valorant-routes.test.js`:

1. After line 19 (the `valorantControllerPath` declaration), add:

```js
const valorantLeaderboardControllerPath = path.join(__dirname, "../src/modules/valorant-leaderboard/controller.js");
```

2. Inside the `loadModuleWithMocks` mock map, after `[valorantControllerPath]: controllerMock,`, add:

```js
    [valorantLeaderboardControllerPath]: controllerMock,
```

3. In the `expected` array (after `"GET /admin/valorant/reconciliation",`), add:

```js
      "GET /valorant/leaderboard",
      "GET /valorant/leaderboard/search",
```

- [ ] **Step 4: Run the routes + OpenAPI tests**

Run: `cd backend && node --test tests/valorant-routes.test.js tests/openapi.test.js`
Expected: PASS. (`openapi.test.js` enforces that every route is documented; if it fails, the route/OpenAPI entries are out of sync.)

- [ ] **Step 5: Document the public endpoints**

In `docs/api-documentation.md`, after the `### Request/response shapes (spec §6.4)` VALORANT section ends (end of file), append:

```markdown
## VALORANT Leaderboard (public)

Public, unauthenticated read-only player leaderboard sourced from `valorantsl-new` (the Sri Lankan player leaderboard service). Routes live under `/api/v1/valorant/*`, are cached for 60 seconds, and proxy the `valorantsl-new` anonymous leaderboard API server-to-server. Registration remains in `valorantsl-new` — Quest does not host it. Spec: `docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md` §4.

| Method | Quest route | Backing upstream call |
|---|---|---|
| `GET` | `/api/v1/valorant/leaderboard?page=&per_page=` | `GET /api/v1/leaderboard?page=&per_page=` |
| `GET` | `/api/v1/valorant/leaderboard/search?q=` | `GET /api/v1/leaderboard/search/{discord_username}` |

Responses follow the standard envelope `{ success: true, data: <payload>, meta: { serverNow } }`. The list payload is `{ entries, total, page, perPage, totalPages }`; each entry is `{ puuid, name, tag, discordUsername, currentTier, elo, rankInTier, peakRank, peakSeason, lastPlayed }`. The search payload is `{ entry: <entry | null> }`. When `VALORANT_SL_API_URL` is unset or upstream is unreachable, both routes return `503`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/src/routes/v1.js backend/src/lib/openapi.js backend/tests/valorant-routes.test.js docs/api-documentation.md
git commit -m "feat(valorant-leaderboard): wire public routes, OpenAPI, and docs"
```

---

### Task 5: Frontend types + public fetch functions

**Files:**
- Modify: `frontend/lib/valorant.ts` (types + register URL constant)
- Modify: `frontend/lib/valorant-api.ts` (public fetch functions)
- Test: `frontend/tests/unit/valorant-api.test.ts` (extend)

**Interfaces:**
- Consumes: `fetchApiJson` from `../../lib/api`.
- Produces: `ValorantPlayerLeaderboardEntry`, `ValorantPlayerLeaderboardPage`, `VALORANT_SL_REGISTER_URL`; `fetchPublicValorantLeaderboard(page?, perPage?)` → `Promise<ValorantPlayerLeaderboardPage>`; `searchPublicValorantLeaderboard(query)` → `Promise<ValorantPlayerLeaderboardEntry | null>`.

- [ ] **Step 1: Add types to `lib/valorant.ts`**

Append to `frontend/lib/valorant.ts`:

```ts
export type ValorantPlayerLeaderboardEntry = {
  puuid: string;
  name: string;
  tag: string;
  discordUsername: string;
  currentTier: string | null;
  elo: number | null;
  rankInTier: number | null;
  peakRank: string | null;
  peakSeason: string | null;
  lastPlayed: string | null;
};

export type ValorantPlayerLeaderboardPage = {
  entries: ValorantPlayerLeaderboardEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export const VALORANT_SL_REGISTER_URL =
  process.env.NEXT_PUBLIC_VALORANT_SL_REGISTER_URL || "https://valorantsl.com/register";
```

- [ ] **Step 2: Add public fetch functions to `lib/valorant-api.ts`**

In `frontend/lib/valorant-api.ts`, add the `fetchApiJson` import near the top (with the other imports):

```ts
import { fetchApiJson } from "./api";
```

And add `ValorantPlayerLeaderboardEntry` / `ValorantPlayerLeaderboardPage` to the existing type import from `./valorant`. Then append:

```ts
export const fetchPublicValorantLeaderboard = async (
  page = 1,
  perPage = 50,
): Promise<ValorantPlayerLeaderboardPage> => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  const envelope = await fetchApiJson<{ data: ValorantPlayerLeaderboardPage }>(
    `/api/v1/valorant/leaderboard?${params.toString()}`,
    { next: { revalidate: 60 } },
    "Leaderboard request failed.",
  );
  return envelope.data;
};

export const searchPublicValorantLeaderboard = async (
  query: string,
): Promise<ValorantPlayerLeaderboardEntry | null> => {
  const params = new URLSearchParams();
  params.set("q", query);
  const envelope = await fetchApiJson<{ data: { entry: ValorantPlayerLeaderboardEntry | null } }>(
    `/api/v1/valorant/leaderboard/search?${params.toString()}`,
    { next: { revalidate: 60 } },
    "Leaderboard request failed.",
  );
  return envelope.data.entry;
};
```

- [ ] **Step 3: Write the failing API tests**

In `frontend/tests/unit/valorant-api.test.ts`, add alongside the existing `vi.mock("../../lib/admin", ...)`:

```ts
import { fetchApiJson } from "../../lib/api";

vi.mock("../../lib/api", () => ({ fetchApiJson: vi.fn() }));
const mockedFetchApiJson = vi.mocked(fetchApiJson);
```

Then append a new `describe` block:

```ts
describe("VALORANT public leaderboard API client", () => {
  it("fetches the paginated leaderboard via the public proxy", async () => {
    mockedFetchApiJson.mockResolvedValueOnce({
      success: true,
      data: { entries: [], total: 0, page: 2, perPage: 25, totalPages: 1 },
    } as never);
    const { fetchPublicValorantLeaderboard } = await import("../../lib/valorant-api");
    const result = await fetchPublicValorantLeaderboard(2, 25);
    expect(result.entries).toEqual([]);
    expect(result.perPage).toBe(25);
    expect(mockedFetchApiJson).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard?page=2&per_page=25",
      { next: { revalidate: 60 } },
      "Leaderboard request failed.",
    );
  });

  it("search unwraps the entry from the envelope", async () => {
    mockedFetchApiJson.mockResolvedValueOnce({
      success: true,
      data: { entry: { puuid: "p-1", name: "Sahan", tag: "QST" } },
    } as never);
    const { searchPublicValorantLeaderboard } = await import("../../lib/valorant-api");
    const result = await searchPublicValorantLeaderboard("sahan");
    expect(result?.puuid).toBe("p-1");
    expect(mockedFetchApiJson).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/search?q=sahan",
      { next: { revalidate: 60 } },
      "Leaderboard request failed.",
    );
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/valorant-api.test.ts`
Expected: FAIL — `fetchPublicValorantLeaderboard`/`searchPublicValorantLeaderboard` are not exported.

- [ ] **Step 5: Run it to verify it passes (after Step 2 implementation)**

Run: `cd frontend && npx vitest run tests/unit/valorant-api.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add frontend/lib/valorant.ts frontend/lib/valorant-api.ts frontend/tests/unit/valorant-api.test.ts
git commit -m "feat(valorant-leaderboard): add player leaderboard types and public fetchers"
```

---

### Task 6: Page, component, nav, sitemap

**Files:**
- Create: `frontend/app/valorant-leaderboard/page.tsx`
- Create: `frontend/components/valorant/ValorantLeaderboard.tsx`
- Modify: `frontend/lib/site.ts` (nav entry + description)
- Modify: `frontend/lib/sitemap.ts` (path)
- Modify: `frontend/.env.example` (register URL)
- Test: `frontend/tests/unit/valorant-leaderboard.test.ts` (new)

**Interfaces:**
- Consumes: `fetchPublicValorantLeaderboard`, `searchPublicValorantLeaderboard` (Task 5); `PageLayout`, `buildPageMetadata`, `defaultPageDescriptions`, ui primitives (`Card`, `Input`, `Button`/`buttonClassName`, `EmptyState`, `Badge`), `useRouter` from `next/navigation`.
- Produces: the public `/valorant-leaderboard` page (server component) and its client content component `ValorantLeaderboard`.

- [ ] **Step 1: Create the page**

Create `frontend/app/valorant-leaderboard/page.tsx`:

```tsx
import PageLayout from "@/components/PageLayout";
import ValorantLeaderboard from "@/components/valorant/ValorantLeaderboard";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import {
  fetchPublicValorantLeaderboard,
  searchPublicValorantLeaderboard,
} from "@/lib/valorant-api";

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: "Valorant Leaderboard",
  description: defaultPageDescriptions.valorantLeaderboard,
  path: "/valorant-leaderboard",
  keywords: [
    "valorant leaderboard sri lanka",
    "sri lanka valorant rankings",
    "valorant rank sri lanka",
    "quest esports valorant",
  ],
});

const PER_PAGE = 50;

export default async function ValorantLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page = "1", q = "" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const query = q.trim();

  if (query) {
    const entry = await searchPublicValorantLeaderboard(query);
    return (
      <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
        <ValorantLeaderboard
          entries={[]}
          page={1}
          perPage={PER_PAGE}
          total={0}
          totalPages={1}
          query={query}
          searchResult={entry}
        />
      </PageLayout>
    );
  }

  const pageData = await fetchPublicValorantLeaderboard(pageNumber, PER_PAGE);
  return (
    <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
      <ValorantLeaderboard
        entries={pageData.entries}
        page={pageData.page}
        perPage={pageData.perPage}
        total={pageData.total}
        totalPages={pageData.totalPages}
        query=""
        searchResult={null}
      />
    </PageLayout>
  );
}
```

- [ ] **Step 2: Create the client component**

Create `frontend/components/valorant/ValorantLeaderboard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  VALORANT_SL_REGISTER_URL,
  type ValorantPlayerLeaderboardEntry,
} from "@/lib/valorant";

type ValorantLeaderboardProps = {
  entries: ValorantPlayerLeaderboardEntry[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  query: string;
  searchResult: ValorantPlayerLeaderboardEntry | null;
};

const TOP_N = 10;

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

const LeaderboardRow = ({ entry, rank }: { entry: ValorantPlayerLeaderboardEntry; rank: number | null }) => (
  <tr className="border-b border-white/5 last:border-0 transition hover:bg-white/5">
    <td className="px-4 py-4 font-semibold text-white">{rank ?? "—"}</td>
    <td className="px-4 py-4 text-slate-200">
      <span className="font-medium text-white">{entry.name}#{entry.tag}</span>
      <span className="ml-2 text-xs text-slate-500">{entry.discordUsername}</span>
    </td>
    <td className="px-4 py-4">
      {entry.currentTier ? <Badge>{entry.currentTier}</Badge> : <span className="text-slate-500">—</span>}
    </td>
    <td className="px-4 py-4 whitespace-nowrap font-semibold text-white">{entry.elo ?? "—"}</td>
    <td className="px-4 py-4 whitespace-nowrap text-slate-300">
      {entry.peakRank ? `${entry.peakRank}${entry.peakSeason ? ` · ${entry.peakSeason}` : ""}` : "—"}
    </td>
    <td className="px-4 py-4 whitespace-nowrap text-right text-slate-400">
      {entry.lastPlayed ? new Date(entry.lastPlayed).toLocaleDateString() : "—"}
    </td>
  </tr>
);

const SearchForm = ({
  search,
  setSearch,
  onSubmit,
}: {
  search: string;
  setSearch: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) => (
  <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
    <Input
      type="search"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      placeholder="Search by Discord username"
      aria-label="Search by Discord username"
      className="max-w-sm"
    />
    <button type="submit" className={buttonClassName({ variant: "secondary", size: "md" })}>
      Search
    </button>
  </form>
);

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

export default function ValorantLeaderboard({
  entries,
  page,
  perPage,
  total,
  totalPages,
  query,
  searchResult,
}: ValorantLeaderboardProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = search.trim();
    if (q) {
      router.push(`/valorant-leaderboard?q=${encodeURIComponent(q)}`);
    } else {
      router.push("/valorant-leaderboard");
    }
  };

  const goToPage = (next: number) => router.push(`/valorant-leaderboard?page=${next}`);

  if (query) {
    return (
      <div className="space-y-6">
        <SearchForm search={search} setSearch={setSearch} onSubmit={submitSearch} />
        {searchResult ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <LeaderboardTableHeader />
                <tbody>
                  <LeaderboardRow entry={searchResult} rank={null} />
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No player found"
            description={`No player matches "${query}". Searches match a player's exact Discord username.`}
          />
        )}
      </div>
    );
  }

  const topEntries = entries.slice(0, TOP_N);

  return (
    <div className="space-y-6">
      <SearchForm search={search} setSearch={setSearch} onSubmit={submitSearch} />

      {entries.length > 0 ? (
        <>
          {page === 1 && topEntries.length > 0 ? (
            <section aria-label="Top 10 players">
              <h2 className="text-lg font-semibold text-white">Top 10</h2>
              <Card className="mt-3 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <LeaderboardTableHeader />
                    <tbody>
                      {topEntries.map((entry, index) => (
                        <LeaderboardRow key={entry.puuid} entry={entry} rank={index + 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          ) : null}

          <section aria-label="Full leaderboard">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <LeaderboardTableHeader />
                  <tbody>
                    {entries.map((entry, index) => (
                      <LeaderboardRow
                        key={entry.puuid}
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

      <div className="flex justify-center pt-2">
        <a
          href={VALORANT_SL_REGISTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: "primary", size: "md" })}
        >
          Register your account
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add nav + description**

In `frontend/lib/site.ts`, in `primaryNavItems` (line 452), add after the Tournaments entry:

```ts
  { href: "/valorant-leaderboard", label: "Valorant Leaderboard" },
```

In `defaultPageDescriptions` (line 579), add a key (after `tournaments`):

```ts
  valorantLeaderboard:
    "Sri Lanka's Valorant player leaderboard — the country's top-ranked players by ELO, with rank, tier, and peak rank.",
```

- [ ] **Step 4: Add the sitemap path**

In `frontend/lib/sitemap.ts`, add `"/valorant-leaderboard",` to `sitemapStaticPaths` (after `"/tournaments",`).

- [ ] **Step 5: Document the register URL**

In `frontend/.env.example`, append:

```
NEXT_PUBLIC_VALORANT_SL_REGISTER_URL=https://valorantsl.com/register
```

- [ ] **Step 6: Write the test**

Create `frontend/tests/unit/valorant-leaderboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapStaticPaths } from "../../lib/sitemap";
import { defaultPageDescriptions, primaryNavItems } from "../../lib/site";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("VALORANT player leaderboard", () => {
  it("is a public page with a nav entry, description, and sitemap path", () => {
    expect(primaryNavItems.some((item) => item.href === "/valorant-leaderboard")).toBe(true);
    expect(typeof defaultPageDescriptions.valorantLeaderboard).toBe("string");
    expect(sitemapStaticPaths).toContain("/valorant-leaderboard");
  });

  it("renders a public leaderboard without admin or upstream references", () => {
    const component = read("components/valorant/ValorantLeaderboard.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain("Register your account");
    expect(component).toContain("Search by Discord username");
    expect(component).toContain("Top 10");
    expect(component).not.toMatch(/api\.henrikdev|valorant-platform-backend|X-Admin-Key|VALORANT_SERVICE_SECRET|localhost:8000/);
  });

  it("the page fetches the public proxy, not the admin endpoint", () => {
    const page = read("app/valorant-leaderboard/page.tsx");
    expect(page).toContain("fetchPublicValorantLeaderboard");
    expect(page).not.toContain("admin/valorant");
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run tests/unit/valorant-leaderboard.test.ts tests/unit/site.test.ts tests/unit/sitemap.test.ts`
Expected: PASS. (If `site.test.ts`/`sitemap.test.ts` assert exhaustive nav/sitemap snapshots, update those assertions to include the new entry — the new item is additive and must not be treated as a drift.)

- [ ] **Step 8: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add frontend/app/valorant-leaderboard/page.tsx frontend/components/valorant/ValorantLeaderboard.tsx frontend/lib/site.ts frontend/lib/sitemap.ts frontend/.env.example frontend/tests/unit/valorant-leaderboard.test.ts
git commit -m "feat(valorant-leaderboard): add public leaderboard page"
```

---

## Final verification

- [ ] **Backend full test suite:** `cd backend && npm test` (or `node --test`), then `npm run lint`.
- [ ] **Frontend full check:** `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`.
- [ ] **Manual smoke (optional):** with `VALORANT_SL_API_URL` set to a reachable `valorantsl-new`, `GET /api/v1/valorant/leaderboard?page=1&per_page=10` returns `{ success: true, data: { entries: [...] } }`; with it unset, it returns `503`. Then load `/valorant-leaderboard` in the dev server and confirm the table, top-10, search, and Register CTA render in Quest styling.
