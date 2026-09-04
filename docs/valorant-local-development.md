# VALORANT local development

This guide runs the Quest VALORANT integration against a **dedicated Supabase
test project**. Do not use production or shared staging data. The guide covers
the two application services in this repository's local topology and the
external FastAPI service that they connect to.

## What is in this repository

Quest is the authenticated admin and browser-facing layer. The browser talks
to Quest Express only; it does not call FastAPI or Henrik directly. FastAPI is
the external VALORANT platform service and is the only service that calls the
Henrik API.

```text
Next.js browser/client :3000
        |
        v
Quest Express          :5001  -- public PostgreSQL schema (`public`)
        |
        v
FastAPI VALORANT       :8000  -- VALORANT PostgreSQL schema (`valorant`)
        |
        v
Henrik API (external; FastAPI-owned boundary)
```

The two service processes are Quest Express and FastAPI. The frontend is a
separate local process for browser verification. The E2E harness additionally
starts a checked-in Henrik fixture mock on `127.0.0.1:18000`.

## Prerequisites

- Node.js 24.x and npm 10 or newer.
- A local checkout of the external `valorant-platform-backend` repository.
- `uv` for the FastAPI checkout, as used by the checked-in startup command.
- A dedicated Supabase PostgreSQL test project with credentials for local
  testing only.
- Quest dependencies installed in `backend/` and `frontend/`.
- An admin account and two Quest `SavedTeam` records for interactive admin
  testing. The E2E run additionally requires the dedicated fixture contract in
  the [E2E README](../backend/tests/valorant-e2e/README.md).

The external checkout location, branch/commit, Python and `uv` versions,
FastAPI dependency state, Henrik API provisioning, and external service
credentials are **owner-maintained**. They are not versioned or verifiable in
this repository. `VALORANT_PLATFORM_REPO` must point to the checkout used by
the E2E test.

## Environment contract

Keep real values in untracked `.env` files. The checked-in Quest shape is
`backend/.env.example`:

```env
VALORANT_INTERNAL_BASE_URL=
VALORANT_SERVICE_SECRET=
VALORANT_SERVICE_KEY_ID=
VALORANT_SERVICE_ISSUER=quest-esports
VALORANT_SERVICE_AUDIENCE=valorant-platform
VALORANT_TIMEOUT_MS=60000
VALORANT_READ_RETRIES=2
```

The first three values are intentionally blank in the checked-in example. To
enable a local run, an owner provides untracked values such as:

```env
VALORANT_INTERNAL_BASE_URL=http://localhost:8000
VALORANT_SERVICE_SECRET=<owner-provided-local-secret>
VALORANT_SERVICE_KEY_ID=kid-local
```

These are **owner-provided local values**, not repository facts. The base URL
enables the integration; production requires an HTTPS origin. The FastAPI
shared secret must match the Quest secret and use the same key ID, issuer, and
audience. Never commit either service secret.

The checked-in frontend topology uses
`NEXT_PUBLIC_API_URL=http://localhost:5001`; see the
[checked-in topology](./setup-and-deployment.md#valorant-local-development-topology)
for that frontend/backend URL contract.

Quest's normal database URLs (`DATABASE_URL` and `DIRECT_URL`) point to the
test project's Quest-owned `public` schema. FastAPI's `DATABASE_URL` points to
the same project's `valorant` schema using the FastAPI runtime role. The
database URL values and passwords are owner-managed local credentials, not
repository facts.

The external FastAPI checkout's environment, schema provisioning, runtime role
name/password, and Henrik access are owner-maintained and are not reproduced
here. Follow the [checked-in topology setup](./setup-and-deployment.md#valorant-local-development-topology)
and the authoritative E2E sources below with dedicated test credentials only.

The [E2E README](../backend/tests/valorant-e2e/README.md) is the authoritative
source for the complete E2E variable contract and invocation. The
[E2E test](../backend/tests/valorant-e2e/valorant-e2e.test.js) is authoritative
for child-process environment overrides, fixture behavior, and ports. Do not
replace its non-production settings with production URLs or credentials.

## Required variable inventory

For a manual local run, provide owner-maintained values for the dedicated test
database (`DATABASE_URL` and `DIRECT_URL`), the Quest/FastAPI service contract
(`VALORANT_INTERNAL_BASE_URL`, `VALORANT_SERVICE_SECRET`,
`VALORANT_SERVICE_KEY_ID`, `VALORANT_SERVICE_ISSUER`, and
`VALORANT_SERVICE_AUDIENCE`). The Quest
frontend uses `NEXT_PUBLIC_API_URL=http://localhost:5001`. Local mobile OAuth,
when tested, uses `MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth` and the
same `questadmin://oauth` value in the app; provider callback URLs remain the
backend callback URLs registered for the local API origin.

The two-service E2E additionally requires these dedicated-test values:

| Variable | Purpose |
| --- | --- |
| `VALORANT_PLATFORM_REPO` | Absolute or invocation-relative path to the monorepo FastAPI directory |
| `E2E_VAL_DATABASE_URL` | FastAPI connection to the shared test project's `valorant` schema |
| `E2E_QUEST_DATABASE_URL` | Quest connection to the same project's `public` schema |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Dedicated test admin credentials |
| `E2E_SAVED_TEAM_A_ID` / `E2E_SAVED_TEAM_B_ID` | Seeded Quest `SavedTeam` identifiers |
| `E2E_PLAYER_A` / `E2E_PLAYER_B` | JSON-encoded `{name, tag}` fixture anchor values |
| `E2E_MATCH_HENRIK_ID` | Henrik fixture history/detail match identifier |
| `E2E_MATCH_UUIDS` | Comma-separated fixture VAL match UUIDs |
| `E2E_ANCHOR_MISMATCH_SERIES` | Seeded draft series identifier for the negative anchor test |

CI uses the `valorant-platform-backend/` directory from the same approved
monorepo checkout, so no personal access token or sibling checkout is required.
Do not put any of these values in tracked files. Use the
[E2E-specific README](../backend/tests/valorant-e2e/README.md) and
[test source](../backend/tests/valorant-e2e/valorant-e2e.test.js) for the exact
JSON, seed, and invocation semantics.

## Database preparation

Use a disposable, dedicated test project. E2E performs writes: it binds teams,
imports a match, creates and finalizes series, and exercises negative cases.
**Never point E2E writes at production data.** Do not use a shared staging
database either, because the test data is not a safe fixture boundary.

Prepare the database and apply both services' migrations before startup. Quest
uses the Prisma-owned `public` schema; FastAPI uses the externally owned
`valorant` schema. The checked-in [topology setup](./setup-and-deployment.md#valorant-local-development-topology)
is the authoritative source for runtime-role creation and migration commands;
the external migration runner and its exact version remain owner-maintained.
From this repository, Quest's migration command is:

```bash
cd backend
npm run prisma:migrate:deploy
```

For a regular local run, seed or create an admin and two `SavedTeam` records.
For E2E, use only the dedicated test project and the fixture values in the
[E2E README](../backend/tests/valorant-e2e/README.md).

## Startup order

### Manual local run

Start FastAPI first, then Quest Express, then the frontend. Run each block in
its own terminal:

```bash
# Terminal 1 — FastAPI (external repo)
cd ../valorant-platform-backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

```bash
# Terminal 2 — Quest backend (this repository)
cd backend
npm run dev
```

```bash
# Terminal 3 — Quest frontend (this repository)
cd frontend
npm run dev
```

Open `http://localhost:3000` for browser checks. Quest Express is at
`http://localhost:5001`; FastAPI is at `http://localhost:8000`.

### E2E run

The E2E test starts the Henrik mock, FastAPI, and Quest Express itself. From
this repository; its test source is authoritative for the startup details:
[valorant-e2e.test.js](../backend/tests/valorant-e2e/valorant-e2e.test.js).

```bash
cd backend
npm run test:valorant:e2e
```

The E2E process uses FastAPI `:8000`, Quest `:5001`, and the Henrik mock
`:18000`; it waits for each service before driving the journey through Quest
routes. Its child-process output is prefixed `[henrik]`, `[fastapi]`, or
`[quest]`.

## Validation and failure diagnosis

With the manual FastAPI and Quest processes running, use the checked-in smoke
script from `backend/`:

```bash
npm run test:valorant:smoke
```

The [smoke script](../backend/scripts/valorant-local-smoke.sh) is authoritative
for its endpoints, defaults, status handling, and expected
`VALORANT local smoke: PASS` output.

If a check fails:

- A connection failure usually means the corresponding process is not running,
  is using a different port, or is still starting. Confirm the process logs and
  the overrides documented in the [smoke script](../backend/scripts/valorant-local-smoke.sh).
- A FastAPI health failure points to the external checkout's startup,
  FastAPI environment, or its database connection. Those service details are
  owner-maintained outside this repository.
- An authenticated Quest action failure indicates that the Quest and FastAPI
  shared secret/key ID or issuer/audience settings may not agree.
- An E2E startup failure should be diagnosed from the prefixed child logs and
  the authoritative [E2E README](../backend/tests/valorant-e2e/README.md) and
  [E2E test](../backend/tests/valorant-e2e/valorant-e2e.test.js). The E2E driver
  uses the checked-in fixture mock, so a live Henrik endpoint is not needed for
  that run.

## Cleanup and safety

- Stop manually started processes with `Ctrl-C`, FastAPI first or last as
  convenient after Quest is stopped.
- The [E2E test](../backend/tests/valorant-e2e/valorant-e2e.test.js) tears down
  its Henrik mock, FastAPI, and Quest child processes. Review the prefixed logs
  if a child remains running.
- E2E data remains in the configured test project after the process exits.
  Discard the disposable project, or clean it using the database owner's
  controlled test-data procedure before reusing it.
- Never run E2E against production. Do not place production credentials in
  E2E variables, committed examples, or screenshots.

## Related documentation

- [Integration reference](./valorant-integration.md) — API, data, and behavior
  contracts.
- [UI verification checklist](./valorant-ui-verification.md) — browser flows.
- [E2E environment contract](../backend/tests/valorant-e2e/README.md) — fixture
  values and the full E2E invocation.
