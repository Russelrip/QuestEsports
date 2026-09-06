# Two-service VALORANT E2E

See the [VALORANT local-development guide](../../../docs/valorant-local-development.md)
for topology, prerequisites, startup, diagnostics, and cleanup. This document
is the E2E-specific environment contract.

Boots the Henrik fixture mock (:18000), `valorant-platform-backend` (:8000) and
Quest Express (:5001) against one dedicated Supabase test project, then drives
the design §11.4 journey through Quest admin routes. Requires:

1. The monorepo `valorant-platform-backend/` directory; `VALORANT_PLATFORM_REPO` points at it.
2. A dedicated test project prepared per docs/setup-and-deployment.md
   (Task 3): FastAPI migrations applied with `--runtime-role val_runtime`,
   Quest Prisma migrations applied, an admin user + two SavedTeams seeded, and
   one anchor-mismatch draft series seeded (`E2E_ANCHOR_MISMATCH_SERIES`).
3. The environment contract table from the deployment plan (Task 8): the
   `E2E_*` and `VALORANT_PLATFORM_REPO` variables listed there.

| Var | Purpose |
|---|---|
| `VALORANT_PLATFORM_REPO` | absolute path to the monorepo FastAPI directory |
| `E2E_VAL_DATABASE_URL` | FastAPI `DATABASE_URL` on the shared test project (`valorant` schema, runtime role) |
| `E2E_QUEST_DATABASE_URL` | Quest `DATABASE_URL`/`DIRECT_URL` on the same project (`public`) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | admin login for the session cookie |
| `E2E_SAVED_TEAM_A_ID` / `E2E_SAVED_TEAM_B_ID` | Quest SavedTeam UUIDs to bind |
| `E2E_PLAYER_A` / `E2E_PLAYER_B` | `{name, tag}` anchor Riot IDs resolved by the fixtures (JSON-encoded strings, e.g. `'{"name":"PlayerA","tag":"TAG"}'`) |
| `E2E_MATCH_HENRIK_ID` | Henrik text ID present in the history/detail fixtures |
| `E2E_MATCH_UUIDS` | comma-separated VAL match UUIDs present in the detail fixture(s) |
| `E2E_ANCHOR_MISMATCH_SERIES` | id of a pre-seeded draft series whose games are **not** anchor-consistent (drives the §11.4 step-8 `ANCHOR_MISMATCH` check) |

Run:

```bash
cd backend
E2E_VAL_DATABASE_URL=... E2E_QUEST_DATABASE_URL=... \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_SAVED_TEAM_A_ID=... E2E_SAVED_TEAM_B_ID=... \
E2E_PLAYER_A='{"name":"PlayerA","tag":"TAG"}' E2E_PLAYER_B='{"name":"PlayerB","tag":"TAG"}' \
E2E_MATCH_HENRIK_ID=... E2E_MATCH_UUIDS=... E2E_ANCHOR_MISMATCH_SERIES=... \
VALORANT_PLATFORM_REPO=../valorant-platform-backend \
npm run test:valorant:e2e
```

(Each `...` is a live value from the dedicated test project; nothing real or
secret is committed.)

Expected: all journey assertions pass; the test prints the FastAPI and Quest
startup logs with `[fastapi]`/`[quest]` prefixes. Teardown kills all three child
processes (mock, FastAPI, Quest).

The independent auth-boundary test needs no database: set `PYTHON_BIN` to the managed
VALORANT interpreter and run `node --test tests/valorant-e2e/valorant-auth-boundary.test.js`.
Windows uses `.venv/Scripts/python.exe`; Linux uses `.venv/bin/python`. The full
journey still requires the isolated fixture environment above.
