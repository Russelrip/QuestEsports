# VALORANT Cross-Repo Deployment & Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Quest ←→ `valorant-platform-backend` integration deployable and verifiable across two repositories and one shared Supabase PostgreSQL project: four DB roles with explicit schema grants and an explicit RLS decision, schema-specific runtime envs, a two-schema production backup/restore, expand-first deployment ordering with limited rollback, service-readiness/private-networking checks, CI schema-scope guards, contract + two-service E2E fixtures, secret scanning on both repos, a consolidated local command reference, and a Playwright-MCP/manual UI verification checklist.

**Architecture:** One Supabase project with two schema owners — Quest Prisma owns `public`, FastAPI's plain-SQL ledger (`scripts/apply_migrations.py`) owns `valorant` (`APP_DB_SCHEMA = "valorant"`). Four conceptual roles (Quest migrator, Quest runtime, VAL migrator, VAL runtime); the VAL side is fully enforced in code (runner grants + per-table RLS policies + a verification script + CI job), the Quest side is enforced by Prisma/RLS tooling plus isolation queries. Production backup (`ops/backup-production.sh`) expands from `--schema=public` only to `public` + `valorant` in one custom-format snapshot. Deployment follows expand-first waves; rollback is app-version revert only while new columns stay inert. Verification is layered: unit/env tests, schema-scope CI guards, roles/RLS CI job, contract-shape tests, and a two-service E2E harness that boots FastAPI + Quest Express against the same test project with a fixture-backed Henrik mock.

**Tech Stack:** Quest: Node 24, Express, Prisma, `node --test`, GitHub Actions, gitleaks. FastAPI: Python 3.11+, FastAPI, SQLAlchemy async + asyncpg, `uv`, pytest, ruff, GitHub Actions. PostgreSQL 16 (Supabase) — the only database. `pg_dump`/`pg_restore`/`psql` (PostgreSQL 17 client pinned by `ops/quest-esports-backup.env.example`), `age`/`rclone` for backup transport.

**Spec:** `QuestEsports/docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` (the approved rev 2 design; §7 persistence/roles/RLS, §7.6 backup, §10 topology/envs, §11 testing strategy, §13 risks).

**Plan scope:** This plan implements **no feature code**. The Quest integration module, FastAPI deltas D1–D11, and the admin UI are owned by the other three plans (below). This plan owns the deployment/verification layer only: roles/grants/RLS runner work, env plumbing, backup/restore, CI guards, the E2E harness, secret scanning, local commands, and UI-verification checklists. Every task ends in a per-repo commit; **this plan itself is never committed as part of any task** — it lives in `docs/superpowers/plans/` and is validated by the orchestrator.

---

## Table of contents

- [Dependencies on the other three plans](#dependencies-on-the-other-three-plans)
- [Execution order](#execution-order)
- [Task 1 — RLS decision (a) and four-role grants in the FastAPI migration runner](#task-1--rls-decision-a-and-four-role-grants-in-the-fastapi-migration-runner)
- [Task 2 — Runtime-access verification script and roles/RLS CI job](#task-2--runtime-access-verification-script-and-rolesrls-ci-job)
- [Task 3 — Same-Supabase local topology](#task-3--same-supabase-local-topology)
- [Task 4 — Quest/FastAPI env plumbing and fail-fast validation](#task-4--questfastapi-env-plumbing-and-fail-fast-validation)
- [Task 5 — Production backup/restore expansion to `public` + `valorant`](#task-5--production-backuprestore-expansion-to-public--valorant)
- [Task 6 — Expand-first deployment order, rollback limits, and schema-scope CI guards](#task-6--expand-first-deployment-order-rollback-limits-and-schema-scope-ci-guards)
- [Task 7 — Service readiness and private-networking verification](#task-7--service-readiness-and-private-networking-verification)
- [Task 8 — Contract fixtures and the two-service E2E harness](#task-8--contract-fixtures-and-the-two-service-e2e-harness)
- [Task 9 — Secret scanning on both repos](#task-9--secret-scanning-on-both-repos)
- [Task 10 — Local command reference and smoke script](#task-10--local-command-reference-and-smoke-script)
- [Task 11 — Playwright MCP / manual UI verification checklist](#task-11--playwright-mcp--manual-ui-verification-checklist)
- [Release blockers](#release-blockers)
- [Commit checkpoints](#commit-checkpoints)
- [Acceptance mapping to the approved spec](#acceptance-mapping-to-the-approved-spec)

---

## Dependencies on the other three plans

All four plans are derived from the same approved spec and are coordinated by the orchestrator. The three feature plans are:

| # | Plan (expected path — confirm with orchestrator) | Owns | Interface this plan consumes | Consumes from this plan |
|---|---|---|---|---|
| P1 | Quest backend integration — `QuestEsports/docs/superpowers/plans/2026-08-13-valorant-quest-integration-implementation.md` | Prisma models `ValorantTeamBinding`/`QuestValorantSeries`/`QuestValorantSeriesGame`/`QuestValorantMatch`/`QuestValorantOperation` in `public`; `backend/src/modules/valorant/*`; guarded `deleteSavedTeam` (`backend/src/modules/teams/team.service.js` ~L643); route mount in `backend/src/routes/v1.js`; operation state machine; `frontend/lib/api.ts`-style client types | Reads `env.VALORANT_*` from `backend/src/config/env.js` (Task 4); consumes the E2E harness's Quest routes for the journey (Task 8) | Env plumbing (Task 4), E2E driver expectations (Task 8), schema-scope guard (Task 6) |
| P2 | Quest admin UI — `QuestEsports/docs/superpowers/plans/2026-08-13-quest-valorant-admin-ui-plan.md` | `frontend/app/admin/valorant/*` screens (bindings, discovery, series, preview/finalize, reconciliation, rankings) | `GET /api/v1/admin/valorant/...` proxy routes from P1; UI verification flows in Task 11 | Playwright-MCP/manual checklist (Task 11) |
| P3 | FastAPI deltas — `valorant-platform-backend/docs/superpowers/plans/2026-08-13-valorant-platform-backend-deltas-implementation.md` | D1 service auth (`app/api/dependencies.py` `require_service_token`, `tests/unit/test_service_token.py`), D2–D9 columns/endpoints in `supabase/migrations/0014_*.sql` and `app/`, D10 docs, D11 reuse | Runs against the runner from Tasks 1–2 (grants/policies must land in the same or an earlier wave than 0014); `require_service_token` name used by Task 7 route-inventory test; `APP_ENV` values `local`/`test` bypass semantics | Runner grants + `DATABASE_RUNTIME_ROLE` (Task 1), verification script (Task 2), contract-shape test expectations (Task 8) |

**Numbering contract:** the FastAPI deltas plan owns every `supabase/migrations/0014_*.sql` file. This plan owns `scripts/apply_migrations.py`, `app/config.py` (`database_runtime_role`), and `.env.example` on the FastAPI side, and adds **no migration file** — the grants/policies are applied by the runner's idempotent security-posture step, so there is no filename collision. Coordinate with P3 that the runner change (Task 1) ships before or with the 0014 wave.

---

## Execution order

| Order | Task | Repo(s) | Depends on |
|---|---|---|---|
| 1 | Task 1 — RLS decision + runner grants | FastAPI | none (can start immediately) |
| 2 | Task 2 — Verification script + roles/RLS CI job | FastAPI | Task 1 |
| 3 | Task 3 — Same-Supabase local topology | Quest + FastAPI | Task 1 |
| 4 | Task 4 — Env plumbing and validation | Quest + FastAPI | Task 3 (env var names) |
| 5 | Task 5 — Backup/restore expansion | Quest | none |
| 6 | Task 6 — Expand-first order + schema-scope CI guards | Quest + FastAPI | none |
| 7 | Task 7 — Readiness + private networking | Quest + FastAPI | P3 (D1 `require_service_token`), Task 3 |
| 8 | Task 8 — Contract fixtures + two-service E2E | Quest + FastAPI | P1, P3, Tasks 1, 2, 4, 6 |
| 9 | Task 9 — Secret scanning | Quest + FastAPI | Task 4 (new secret-shaped vars) |
| 10 | Task 10 — Local command reference + smoke script | Quest | Tasks 3, 4, 5, 7 |
| 11 | Task 11 — Playwright MCP / manual UI verification | Quest | P2, Task 8 |

Tasks 1, 5, and 6 are fully independent and can run in any order. Task 7's route-inventory test must wait for P3's D1.

---

## Task 1: RLS decision (a) and four-role grants in the FastAPI migration runner

**Decision (spec §7.4):** choose option **(a) — explicit per-table RLS policies for the VAL runtime role**, plus role-level `GRANT`s and private-schema network isolation. The runner's blanket `ENABLE ROW LEVEL SECURITY` without policies (the pre-existing posture) is reconciled by giving the runtime role an explicit `FOR ALL ... USING (true) WITH CHECK (true)` policy on every application table (single-tenant admin service — the runtime role is the only legitimate direct caller). The table/schema owner (VAL migrator) bypasses RLS; every other role sees nothing.

**Files:**
- Modify: `valorant-platform-backend/scripts/apply_migrations.py`
- Modify: `valorant-platform-backend/app/config.py`
- Modify: `valorant-platform-backend/.env.example`
- Create: `valorant-platform-backend/docs/runtime-access-posture.md`
- Test: `valorant-platform-backend/tests/unit/test_migration_runner_grants.py`

- [ ] **Step 1: Add `database_runtime_role` to `app/config.py`**

Insert after `admin_api_key` (line 25) in the `Settings` class of `valorant-platform-backend/app/config.py`:

```python
    # VAL DML runtime role (four-role model; deployment). The migration runner
    # grants schema/table/sequence access and per-table RLS policies to this
    # role; the running app should connect as it in production. When empty the
    # runner leaves the current owner-only posture (development/test default).
    database_runtime_role: str | None = None
```

- [ ] **Step 2: Extend `_apply_security_posture` in `scripts/apply_migrations.py`**

Add the policy-excluded ledger table next to `LEDGER_TABLE = "_migration_ledger"` (line 62):

```python
# The migration ledger is migrator-only; it is never granted to or protected
# for the runtime role.
POLICY_EXCLUDED_TABLES = {LEDGER_TABLE}
```

Replace the `_apply_security_posture` function (lines 235–250) with:

```python
async def _apply_security_posture(
    conn: AsyncConnection, schema: str, *, runtime_role: str | None = None
) -> None:
    """Private-schema posture (ADR-001): revoke PUBLIC on the schema, its
    tables, and future default privileges; enable RLS on every application
    table. When ``runtime_role`` is set (four-role model), grant that role
    schema/table/sequence access, grant default privileges for future tables,
    and create an explicit per-table RLS policy (decision (a), ADR-0XX) so the
    runtime role's direct connection is the only legitimate caller and every
    other role still sees nothing. The connecting migrator role owns the
    schema/tables and is unaffected by RLS.
    """
    q = _quote_ident(schema)
    await conn.execute(text(f"REVOKE ALL ON SCHEMA {q} FROM PUBLIC"))
    await conn.execute(text(f"REVOKE ALL ON ALL TABLES IN SCHEMA {q} FROM PUBLIC"))
    await conn.execute(text(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA {q} FROM PUBLIC"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} REVOKE ALL ON TABLES FROM PUBLIC"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} REVOKE ALL ON SEQUENCES FROM PUBLIC"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} REVOKE ALL ON FUNCTIONS FROM PUBLIC"))
    tables = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = :schema"), {"schema": schema})
    table_names = [row[0] for row in tables]
    for table in table_names:
        await conn.execute(text(f"ALTER TABLE {q}.{_quote_ident(table)} ENABLE ROW LEVEL SECURITY"))
    if not runtime_role:
        return
    rr = _quote_ident(runtime_role)
    await conn.execute(text(f"GRANT USAGE ON SCHEMA {q} TO {rr}"))
    await conn.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {q} TO {rr}"))
    await conn.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {q} TO {rr}"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {rr}"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} GRANT USAGE, SELECT ON SEQUENCES TO {rr}"))
    for table in table_names:
        if table in POLICY_EXCLUDED_TABLES:
            continue
        qualified = f"{q}.{_quote_ident(table)}"
        # Drop-then-create keeps the posture idempotent on every migration run.
        await conn.execute(text(f"DROP POLICY IF EXISTS {table}_runtime_all ON {qualified}"))
        await conn.execute(text(f"CREATE POLICY {table}_runtime_all ON {qualified} FOR ALL TO {rr} USING (true) WITH CHECK (true)"))
```

- [ ] **Step 3: Thread `runtime_role` through `_run_migrations` and `apply_migrations`**

Replace the call inside `_run_migrations` (line 288) with:

```python
    async with engine.begin() as conn:
        await _apply_security_posture(conn, schema, runtime_role=runtime_role)
```

Change `_run_migrations`'s signature (line 253) to `async def _run_migrations(engine, migrations_dir: Path, schema: str, runtime_role: str | None = None) -> MigrationResult:` and pass `runtime_role=runtime_role` through to the posture call.

Change `apply_migrations` (line 302) to:

```python
async def apply_migrations(
    database_url: str,
    migrations_dir: Path = Path("supabase/migrations"),
    *,
    search_path: str | None = None,
    runtime_role: str | None = None,
) -> MigrationResult:
```

and inside it, replace `result = await _run_migrations(engine, migrations_dir, target_schema)` with `result = await _run_migrations(engine, migrations_dir, target_schema, runtime_role=runtime_role)`.

- [ ] **Step 4: Add `--runtime-role` CLI flag to `main()`**

In `main()` (after the `--search-path` argument, line 350), add:

```python
    parser.add_argument(
        "--runtime-role",
        default=None,
        help="VAL DML runtime role to grant schema access and RLS policies "
        "(overrides DATABASE_RUNTIME_ROLE)",
    )
```

and change the call (line 357) to:

```python
    runtime_role = args.runtime_role or os.environ.get("DATABASE_RUNTIME_ROLE")
    result = await apply_migrations(
        database_url,
        Path(args.migrations_dir),
        search_path=args.search_path,
        runtime_role=runtime_role,
    )
```

- [ ] **Step 5: Document the decision in `docs/runtime-access-posture.md`**

Create `valorant-platform-backend/docs/runtime-access-posture.md`:

```markdown
# Runtime access posture (four-role model, ADR-0XX)

## Roles

| Role | Schema | Responsibility | DDL or DML |
|---|---|---|---|
| Quest migrator | `public` | Prisma migrations (`npm run prisma:migrate:deploy`) | DDL |
| Quest runtime | `public` | Quest app queries (Prisma client) | DML only |
| VAL migrator | `valorant` | `scripts/apply_migrations.py` (schema + `_migration_ledger`) | DDL |
| VAL runtime | `valorant` | FastAPI app queries (SQLAlchemy async) | DML only |

## RLS decision (spec §7.4, option (a))

Every `valorant` table has RLS enabled and one explicit policy
`<table>_runtime_all` granting `FOR ALL ... USING (true) WITH CHECK (true)` to
the VAL runtime role. The migrator is the schema/table owner and bypasses RLS.
No anonymous grants; no `PUBLIC` grants; `quest_*` roles have no privileges on
`valorant`; the VAL runtime role has no privileges on `public`. The running app
must connect as the runtime role; migration runs use the migrator role.

## Enforcement

- Runner: `scripts/apply_migrations.py --runtime-role <role>` grants schema,
  tables, sequences, and default privileges, and creates the policies.
- Verification: `python -m scripts.verify_runtime_access` (positive and
  `--expect-denied` modes) plus the `roles-rls` CI job.
- Quest side: `npm run prisma:security:verify`; the Quest runtime role is never
  granted anything on `valorant` (see Quest docs/setup-and-deployment.md).
```

- [ ] **Step 6: Update `valorant-platform-backend/.env.example`**

Append at the end of the file:

```env
# VAL DML runtime role (four-role model, deployment). The migration runner
# grants schema/table/sequence access and per-table RLS policies to this role;
# the running app should connect as it in production. Leave empty to run as the
# migrator (development/test default).
DATABASE_RUNTIME_ROLE=
```

- [ ] **Step 7: Write the runner-grant unit test**

Create `valorant-platform-backend/tests/unit/test_migration_runner_grants.py`:

```python
"""The runner's security posture issues runtime-role grants and RLS policies
only when a runtime role is configured (Task 1 of the deployment plan)."""

from scripts.apply_migrations import POLICY_EXCLUDED_TABLES, _quote_ident


def test_quote_ident_escapes_double_quotes() -> None:
    assert _quote_ident('va"lorant') == '"va""lorant"'


def test_ledger_table_is_excluded_from_runtime_policies() -> None:
    assert "_migration_ledger" in POLICY_EXCLUDED_TABLES
```

- [ ] **Step 8: Run the FastAPI unit suite**

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend && uv run pytest tests/unit -q`
Expected: PASS; the new `test_migration_runner_grants.py` runs and all pre-existing unit tests stay green (the `apply_migrations` signature change is backward compatible — `runtime_role` defaults to `None`).

- [ ] **Step 9: Commit (FastAPI repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add scripts/apply_migrations.py app/config.py .env.example docs/runtime-access-posture.md tests/unit/test_migration_runner_grants.py
git commit -m "feat(runtime): grant valorant runtime role with explicit RLS policies (deployment plan Task 1)"
```

---

## Task 2: Runtime-access verification script and roles/RLS CI job

**Files:**
- Create: `valorant-platform-backend/scripts/verify_runtime_access.py`
- Modify: `valorant-platform-backend/.github/workflows/ci.yml`
- Test: `valorant-platform-backend/tests/unit/test_verify_runtime_access.py`

- [ ] **Step 1: Write the verification script**

Create `valorant-platform-backend/scripts/verify_runtime_access.py`:

```python
"""Verify the VAL runtime role's direct access to the application schema.

Connects as the configured role (DATABASE_URL), pins the connection to the
application schema, and proves the role can SELECT, INSERT, and DELETE on a
real application table, cleaning up its own probe row afterwards.

With ``--expect-denied`` it asserts the opposite: the connecting role is refused
at the schema/table level. That mode proves roles outside the VALORANT runtime
(e.g. the Quest runtime role) see nothing in ``valorant``.

Usage:
    uv run python -m scripts.verify_runtime_access
    uv run python -m scripts.verify_runtime_access --expect-denied

Exit 0 on the expected outcome, 1 otherwise (with a diagnostic on stderr).
"""

from __future__ import annotations

import argparse
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import APP_DB_SCHEMA

PROBE_TABLE = "teams"  # guaranteed to exist since migration 0004
PROBE_NAME = "__runtime_access_probe__"


async def _run(expect_denied: bool, database_url: str) -> int:
    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"server_settings": {"search_path": APP_DB_SCHEMA}},
    )
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"SELECT 1 FROM {PROBE_TABLE} LIMIT 1"))
            row = await conn.execute(
                text(f"INSERT INTO {PROBE_TABLE} (name) VALUES (:name) RETURNING id"),
                {"name": PROBE_NAME},
            )
            probe_id = row.scalar_one()
            await conn.execute(
                text(f"DELETE FROM {PROBE_TABLE} WHERE id = :id"), {"id": probe_id}
            )
    except Exception as exc:  # noqa: BLE001  # any failure is the outcome under test
        if expect_denied:
            print("runtime access denied as expected: PASS")
            return 0
        print(f"runtime access: FAIL ({exc})", file=__import__("sys").stderr)
        return 1
    else:
        if expect_denied:
            print(
                "runtime access denied as expected: FAIL (role unexpectedly had access)",
                file=__import__("sys").stderr,
            )
            return 1
        print("runtime access: PASS")
        return 0
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-denied", action="store_true", help="assert access is refused")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is not set")
    raise SystemExit(asyncio.run(_run(args.expect_denied, database_url)))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the unit test for the script's argument handling**

Create `valorant-platform-backend/tests/unit/test_verify_runtime_access.py`:

```python
"""CLI surface of scripts/verify_runtime_access.py (deployment plan Task 2)."""

import pytest

from scripts.verify_runtime_access import _run


@pytest.mark.asyncio
async def test_probe_run_against_missing_database_fails_cleanly() -> None:
    with pytest.raises(Exception):
        await _run(False, "postgresql+asyncpg://nobody:nobody@127.0.0.1:1/nope")
```

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend && uv run pytest tests/unit -q`
Expected: PASS (the probe fails loudly against an unreachable host; the CLI path itself is covered).

- [ ] **Step 3: Add the `roles-rls` CI job to `.github/workflows/ci.yml`**

Append a second job to the workflow (after the existing `test` job):

```yaml
  roles-rls:
    name: Roles and RLS verification
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: valorant_platform_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --extra dev
      - name: Create runtime roles
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y -qq postgresql-client
          psql -h localhost -U postgres -d valorant_platform_test -v ON_ERROR_STOP=1 <<'SQL'
          CREATE ROLE val_runtime LOGIN PASSWORD 'val_runtime';
          CREATE ROLE quest_runtime LOGIN PASSWORD 'quest_runtime';
          SQL
      - name: Apply migrations as migrator with runtime-role grants
        run: >-
          uv run python -m scripts.apply_migrations
          --database-url postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test
          --runtime-role val_runtime
      - name: VAL runtime role can read and write valorant
        run: >-
          DATABASE_URL=postgresql+asyncpg://val_runtime:val_runtime@localhost:5432/valorant_platform_test
          uv run python -m scripts.verify_runtime_access
      - name: Quest runtime role is denied on valorant
        run: >-
          DATABASE_URL=postgresql+asyncpg://quest_runtime:quest_runtime@localhost:5432/valorant_platform_test
          uv run python -m scripts.verify_runtime_access --expect-denied
```

- [ ] **Step 4: Run the full CI-equivalent locally**

Run:
```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
createdb valorant_platform_roles_test 2>/dev/null || true
psql -d valorant_platform_roles_test -c "CREATE ROLE val_runtime LOGIN PASSWORD 'val_runtime'" 2>/dev/null || true
psql -d valorant_platform_roles_test -c "CREATE ROLE quest_runtime LOGIN PASSWORD 'quest_runtime'" 2>/dev/null || true
uv run python -m scripts.apply_migrations \
  --database-url postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_roles_test \
  --runtime-role val_runtime
```
Expected: `applied 13 migration(s): 0001_players.sql ... 0013_rating_event_sequences_immutable.sql` (first run) then `skipped ...` on re-run (idempotent); final line `target schema: valorant`.

Run:
```bash
DATABASE_URL=postgresql+asyncpg://val_runtime:val_runtime@localhost:5432/valorant_platform_roles_test \
  uv run python -m scripts.verify_runtime_access
```
Expected: `runtime access: PASS`, exit 0.

Run:
```bash
DATABASE_URL=postgresql+asyncpg://quest_runtime:quest_runtime@localhost:5432/valorant_platform_roles_test \
  uv run python -m scripts.verify_runtime_access --expect-denied
```
Expected: `runtime access denied as expected: PASS`, exit 0.

- [ ] **Step 5: Commit (FastAPI repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add scripts/verify_runtime_access.py tests/unit/test_verify_runtime_access.py .github/workflows/ci.yml
git commit -m "feat(runtime): add roles/RLS verification script and CI job (deployment plan Task 2)"
```

---

## Task 3: Same-Supabase local topology

Both services target the **same configured Supabase test project** (never production/staging) with schema-specific credentials. This matches the spec's §10.1 topology: Quest Express `:5001` on `public`; FastAPI `:8000` on `valorant`.

**Files:**
- Modify: `QuestEsports/docs/setup-and-deployment.md`
- Modify: `QuestEsports/backend/.env.example`

- [ ] **Step 1: Add the VALORANT local topology section to `docs/setup-and-deployment.md`**

Insert a new section after "Local Backend Testing Workflow" (ends at the "Do not point this workflow at production" paragraph):

```markdown
## VALORANT Local Development Topology

The VALORANT integration runs two services against **one dedicated Supabase test
project** — never production or shared staging:

```text
Next.js frontend ......... http://localhost:3000
Quest Express backend .... http://localhost:5001   (NEXT_PUBLIC_API_URL=http://localhost:5001)
valorant-platform-backend. http://localhost:8000   (VALORANT_INTERNAL_BASE_URL=http://localhost:8000)
Shared Supabase test project  (schema-specific credentials)
```

- Quest `DATABASE_URL`/`DIRECT_URL` connect to the `public` schema (Prisma-owned).
- FastAPI `DATABASE_URL` connects to the `valorant` schema (plain-SQL ledger).
- `valorant-platform-backend` is a sibling repo, never deployed from this repo.

Prepare the shared test project once:

1. In the Supabase SQL editor, create the VAL runtime role:
   ```sql
   CREATE ROLE val_runtime LOGIN PASSWORD '<generate a random password>';
   ```
   (The runner creates the `valorant` schema and grants/RLS policies to this role
   automatically — see the FastAPI repo's `docs/runtime-access-posture.md`.)
2. Quest runs as the project owner (or its own runtime role) on `public` with
   RLS verified by `npm run prisma:security:verify`.
3. Apply FastAPI migrations as the migrator:
   ```bash
   cd ../valorant-platform-backend
   uv sync
   uv run python -m scripts.apply_migrations --runtime-role val_runtime
   ```
4. Apply Quest Prisma migrations as usual (`npm run prisma:migrate:deploy`).
```

- [ ] **Step 2: Extend `backend/.env.example` with the VALORANT block**

Append to `QuestEsports/backend/.env.example`:

```env
# VALORANT platform internal service (Quest backend -> valorant-platform-backend).
# Set VALORANT_INTERNAL_BASE_URL to enable the integration. Outside NODE_ENV=test
# it then requires VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID, and the
# URL must be HTTPS in production.
VALORANT_INTERNAL_BASE_URL=
VALORANT_SERVICE_SECRET=
VALORANT_SERVICE_KEY_ID=
VALORANT_SERVICE_ISSUER=quest-esports
VALORANT_SERVICE_AUDIENCE=valorant-platform
VALORANT_TIMEOUT_MS=10000
VALORANT_READ_RETRIES=2
```

- [ ] **Step 3: Verify isolation between the two schemas on the test project**

Run (adjust names/URLs to the test project; `psql` from either repo):

```bash
psql "$DIRECT_URL" -tAc \
  "SELECT 'val_runtime_on_public=' || count(*) FROM information_schema.role_table_grants WHERE grantee = 'val_runtime' AND table_schema = 'public'"
psql "$VAL_DATABASE_URL" -tAc \
  "SELECT 'quest_runtime_on_valorant=' || count(*) FROM information_schema.role_table_grants WHERE grantee = 'quest_runtime' AND table_schema = 'valorant'"
```
Expected: both counts are `0` (no grants leaked across schemas). If the Quest runtime role is the project owner, record the grant counts for the actual Quest role name instead of `quest_runtime` and confirm the `valorant` side remains empty.

- [ ] **Step 4: Commit (Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add docs/setup-and-deployment.md backend/.env.example
git commit -m "docs(valorant): document same-Supabase two-service local topology (deployment plan Task 3)"
```

---

## Task 4: Quest/FastAPI env plumbing and fail-fast validation

**Files:**
- Modify: `QuestEsports/backend/src/config/env.js`
- Test: `QuestEsports/backend/tests/valorant-env.test.js`
- Modify: `valorant-platform-backend/app/config.py` (already done in Task 1 — verify only)

- [ ] **Step 1: Add the VALORANT vars to `env.js`**

Insert into the `env` object literal in `QuestEsports/backend/src/config/env.js` (after the `TICKET_ORDER_RESERVATION_MINUTES` entry, before the closing `};`):

```js
  VALORANT_INTERNAL_BASE_URL: optional("VALORANT_INTERNAL_BASE_URL"),
  VALORANT_SERVICE_SECRET: optional("VALORANT_SERVICE_SECRET"),
  VALORANT_SERVICE_KEY_ID: optional("VALORANT_SERVICE_KEY_ID"),
  VALORANT_SERVICE_ISSUER: optional("VALORANT_SERVICE_ISSUER", "quest-esports"),
  VALORANT_SERVICE_AUDIENCE: optional("VALORANT_SERVICE_AUDIENCE", "valorant-platform"),
  VALORANT_TIMEOUT_MS: normalizePositiveInteger(process.env.VALORANT_TIMEOUT_MS, 10000),
  VALORANT_READ_RETRIES: normalizeIntegerInRange(
    "VALORANT_READ_RETRIES",
    process.env.VALORANT_READ_RETRIES,
    2,
    0,
    5,
  ),
```

- [ ] **Step 2: Add fail-fast validation rules**

Insert into the validation block in `env.js` (after the `PAYHERE_NOTIFY_URL` production check, before `module.exports`):

```js
if (env.NODE_ENV !== "test" && env.VALORANT_INTERNAL_BASE_URL) {
  if (!env.VALORANT_SERVICE_SECRET || !env.VALORANT_SERVICE_KEY_ID) {
    throw new Error(
      "VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID are required when VALORANT_INTERNAL_BASE_URL is set.",
    );
  }
  assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", env.VALORANT_INTERNAL_BASE_URL, {
    originOnly: true,
  });
}
```

- [ ] **Step 3: Write `backend/tests/valorant-env.test.js`**

Create the file following the existing `env.test.js` pattern (spawn-based reload):

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { environmentValidation } = require("../src/config/env");

const backendRoot = path.join(__dirname, "..");
const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://quest:quest@db.example.com:5432/quest?sslmode=require",
  DIRECT_URL: "postgresql://quest:quest@db.example.com:5432/quest?sslmode=require",
  SESSION_COOKIE_NAME: "quest_session",
  AUTH_ENCRYPTION_KEY: "a".repeat(64),
  UPLOAD_ROOT: "/srv/quest/uploads",
  PRIVATE_UPLOAD_ROOT: "/srv/quest/private",
  APP_URL: "https://quest.example.com",
  API_PUBLIC_URL: "https://api.quest.example.com",
  MOBILE_ADMIN_OAUTH_REDIRECT_URL: "https://api.quest.example.com/mobile-admin-oauth",
  MOBILE_ADMIN_ANDROID_CERT_SHA256: Array(32).fill("AA").join(":"),
  CORS_ORIGIN: "https://quest.example.com",
  TRUST_PROXY: "1",
  REQUIRE_API_ORIGIN: "true",
  MAIL_DELIVERY_REQUIRED: "true",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: "resend-test-key",
  MAIL_FROM: "Quest <noreply@quest.example.com>",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_CALLBACK_URL: "",
  DISCORD_CLIENT_ID: "",
  DISCORD_CLIENT_SECRET: "",
  DISCORD_CALLBACK_URL: "",
  PAYHERE_MERCHANT_ID: "",
  PAYHERE_MERCHANT_SECRET: "",
  PAYHERE_NOTIFY_URL: "",
  PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION: "false",
  API_PROCESS_COUNT: "1",
  SITE_MAINTENANCE_MODE: "false",
  SITE_MAINTENANCE_RETRY_AFTER_SECONDS: "900",
};

const loadEnvironment = (overrides) =>
  spawnSync(process.execPath, ["-e", "require('./src/config/env')"], {
    cwd: backendRoot,
    env: { ...productionEnv, ...overrides },
    encoding: "utf8",
  });

test("VALORANT internal base URL requires the service secret and key id", () => {
  const result = loadEnvironment({ VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000" });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /VALORANT_SERVICE_SECRET and VALORANT_SERVICE_KEY_ID are required/,
  );
});

test("VALORANT internal base URL must be an HTTPS origin in production", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "http://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use HTTPS in production/);
});

test("complete VALORANT configuration is accepted", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
  });
  assert.equal(result.status, 0);
});

test("VALORANT_READ_RETRIES is bounded to 0..5", () => {
  const result = loadEnvironment({
    VALORANT_INTERNAL_BASE_URL: "https://val.internal:8000",
    VALORANT_SERVICE_SECRET: "shared-secret",
    VALORANT_SERVICE_KEY_ID: "key-1",
    VALORANT_READ_RETRIES: "99",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an integer from 0 to 5/);
});

test("VALORANT_INTERNAL_BASE_URL is validated by the exported helper", () => {
  assert.throws(() =>
    environmentValidation.assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", "http://localhost:8000", {
      originOnly: true,
    }),
  );
  assert.doesNotThrow(() =>
    environmentValidation.assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", "https://val.internal:8000", {
      originOnly: true,
    }),
  );
});
```

- [ ] **Step 4: Run the Quest backend suite**

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/backend && npm test`
Expected: PASS including the new `valorant-env.test.js` (5 tests) and all existing `env.test.js` cases.

- [ ] **Step 5: Confirm the FastAPI side env shape**

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend && uv run python -c "from app.config import Settings; s = Settings(_env_file=None); print(s.database_runtime_role)"`
Expected: `None`. (`QUEST_SERVICE_SHARED_SECRETS`, `QUEST_SERVICE_ISSUER`, `QUEST_SERVICE_AUDIENCE` are owned by plan P3's delta D1; do not add them here.)

- [ ] **Step 6: Commit (Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/src/config/env.js backend/tests/valorant-env.test.js
git commit -m "feat(valorant): add VALORANT service env vars with fail-fast validation (deployment plan Task 4)"
```

---

## Task 5: Production backup/restore expansion to `public` + `valorant`

Spec §7.6: the current production backup dumps `--schema=public` only and the manifest records `database_scope=application_public_schema_only`. This task expands it to a consistent two-schema snapshot **before any authoritative VALORANT data is colocated** and adds a two-schema restore verification.

**Files:**
- Modify: `QuestEsports/ops/backup-production.sh`
- Modify: `QuestEsports/ops/restore-production-backup.sh`
- Modify: `QuestEsports/backend/tests/backup-scripts.test.js`
- Modify: `QuestEsports/docs/backup-and-disaster-recovery.md`
- Modify: `QuestEsports/docs/database-and-storage.md`
- Modify: `QuestEsports/ops/README.md`
- Modify: `QuestEsports/docs/production-runbook.md`

- [ ] **Step 1: Add `psql` to the required-command check in `backup-production.sh`**

Replace the `for command in` line (line 58) with:

```bash
for command in age basename cat chmod date find flock hostname mkdir mktemp pg_dump psql realpath rm rclone rsync sha256sum tar; do
```

- [ ] **Step 2: Add a schema-existence probe**

Insert immediately after the `work_directory`/`trap` lines (after line 97):

```bash
if psql "$DIRECT_URL" -tAc "SELECT 1 FROM pg_namespace WHERE nspname = 'valorant'" | grep -q '^1$'; then
  valorant_schema_exists=true
else
  valorant_schema_exists=false
fi
```

- [ ] **Step 3: Dump both schemas when the `valorant` schema exists**

Replace the `pg_dump` block (lines 109–114) with:

```bash
if [[ "$valorant_schema_exists" == true ]]; then
  pg_dump "$DIRECT_URL" \
    --format=custom \
    --schema=public \
    --schema=valorant \
    --no-owner \
    --no-acl \
    --file="$work_directory/database.dump"
else
  # Transitional state: the VALORANT schema has not been migrated into this
  # project yet; keep a public-only snapshot that is still restorable.
  pg_dump "$DIRECT_URL" \
    --format=custom \
    --schema=public \
    --no-owner \
    --no-acl \
    --file="$work_directory/database.dump"
fi
```

- [ ] **Step 4: Update the manifest scope**

Replace the manifest heredoc block (lines 119–128) with:

```bash
if [[ "$valorant_schema_exists" == true ]]; then
  database_scope="application_public_and_valorant_schemas"
else
  database_scope="application_public_schema_only"
fi

cat > "$work_directory/manifest.txt" <<MANIFEST
created_at_utc=$timestamp
source_host=$hostname_value
database_format=postgres_custom
database_scope=$database_scope
valorant_schema_included=$valorant_schema_exists
supabase_managed_schemas_included=false
public_upload_root=$UPLOAD_ROOT
private_upload_root=$PRIVATE_UPLOAD_ROOT
file_snapshot_strategy=two_pass_union_around_database_dump
MANIFEST
```

- [ ] **Step 5: Add two-schema verification to `restore-production-backup.sh`**

Add `psql` to the required-command list (line 35) by replacing it with:

```bash
for command in age basename cat cut date dirname grep mkdir mktemp mv pg_restore psql realpath rm rsync sha256sum sleep tar; do
```

Insert after the successful `pg_restore` (after line 206, before `public_activated=false`):

```bash
echo "Restored schema table counts (public and valorant):"
psql "$DIRECT_URL" -tAc "SELECT 'public=' || count(*) FROM pg_tables WHERE schemaname = 'public' UNION ALL SELECT 'valorant=' || count(*) FROM pg_tables WHERE schemaname = 'valorant'"
```

- [ ] **Step 6: Extend `backend/tests/backup-scripts.test.js`**

Append two tests:

```js
test("production backup dumps both schemas when the valorant schema exists", () => {
  const backupScript = fs.readFileSync(
    path.join(__dirname, "../../ops/backup-production.sh"),
    "utf8",
  );

  assert.match(backupScript, /pg_namespace/);
  assert.match(backupScript, /valorant_schema_exists/);
  assert.match(backupScript, /--schema=public \\\n\s+--schema=valorant/);
  assert.match(backupScript, /database_scope=application_public_and_valorant_schemas/);
  assert.match(backupScript, /valorant_schema_included=\$valorant_schema_exists/);
});

test("production restore reports restored table counts for both schemas", () => {
  const restoreScript = fs.readFileSync(
    path.join(__dirname, "../../ops/restore-production-backup.sh"),
    "utf8",
  );

  assert.match(restoreScript, /SELECT 'public=' \|\| count\(\*\)/);
  assert.match(restoreScript, /SELECT 'valorant=' \|\| count\(\*\)/);
});
```

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/backend && node --test tests/backup-scripts.test.js`
Expected: PASS (4 existing tests + 2 new).

- [ ] **Step 7: Update the backup docs**

Edit `QuestEsports/docs/backup-and-disaster-recovery.md`:

1. In the "Isolated full restore drill" checklist (around line 235), add a verification step: "Verify both schemas were restored: the archive's manifest `database_scope=application_public_and_valorant_schemas` and the restore script printed non-zero table counts for both `public` and `valorant`."
2. In "Intentional production restore", add: "Confirm the selected archive includes the `valorant` schema before restoring; a public-only archive restored over a project that already contains VALORANT data would drop it (`pg_restore --clean`)."

Edit `QuestEsports/docs/database-and-storage.md` line 412: replace "the portable application-owned PostgreSQL `public`-schema dump" with "the portable application-owned PostgreSQL dump of both the `public` and `valorant` schemas (when the VALORANT schema exists)".

Edit `QuestEsports/ops/README.md` — replace the `backup-production.sh` row's "PostgreSQL `public`-schema dump" with "PostgreSQL dump of `public` and `valorant` schemas".

Edit `QuestEsports/docs/production-runbook.md` — in the "Backup Set" section (line 354+), replace "database dump (application `public` schema)" with "database dump (application `public` + `valorant` schemas)" and note the manifest now records `valorant_schema_included`.

- [ ] **Step 8: Dry-run the backup script against a disposable database**

The full script cannot complete on a dev machine unless `age`, `rclone`, and a real remote are present; on a machine without `age` the script exits at the required-command check (line 58) before the dump. The two-schema dump behavior is therefore proven directly (both schemas exist in the disposable database from Task 2):

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
pg_dump "postgresql://postgres:postgres@localhost:5432/valorant_platform_roles_test" \
  --format=custom --schema=public --schema=valorant --no-owner --no-acl \
  --file=/tmp/two-schema.dump
pg_restore --list /tmp/two-schema.dump | grep -c valorant
```
Expected: the `pg_restore --list` output contains `valorant` objects (count ≥ 1), proving a single custom-format dump captures both schemas. The manifest/`valorant_schema_included` behavior is covered by the `backup-scripts.test.js` assertions in Step 6.

On a host with `age` and `rclone` configured, run the real script once against a disposable project and confirm the manifest prints `database_scope=application_public_and_valorant_schemas` and `valorant_schema_included=true`.

- [ ] **Step 9: Commit (Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add ops/backup-production.sh ops/restore-production-backup.sh backend/tests/backup-scripts.test.js \
  docs/backup-and-disaster-recovery.md docs/database-and-storage.md ops/README.md docs/production-runbook.md
git commit -m "feat(ops): back up public+valorant schemas in one consistent snapshot (deployment plan Task 5)"
```

---

## Task 6: Expand-first deployment order, rollback limits, and schema-scope CI guards

**Files:**
- Create: `QuestEsports/backend/scripts/verify-prisma-schema-scope.js`
- Modify: `QuestEsports/.github/workflows/ci.yml`
- Modify: `valorant-platform-backend/.github/workflows/ci.yml`
- Modify: `QuestEsports/docs/DEPLOYMENT_SAFETY.md`
- Modify: `QuestEsports/docs/ci-cd.md`

- [ ] **Step 1: Write the Prisma schema-scope guard**

Create `QuestEsports/backend/scripts/verify-prisma-schema-scope.js`:

```js
// CI guard (deployment plan Task 6): Quest Prisma owns `public` only. Fail if
// backend/prisma ever references the `valorant` schema or its tables — Prisma
// must never model, migrate, or map VALORANT objects (design §7.1/§7.2).
const fs = require("node:fs");
const path = require("node:path");

const prismaDir = path.join(__dirname, "..", "prisma");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "schema.prisma" || entry.name.endsWith(".sql")) files.push(full);
  }
})(prismaDir);

const offenders = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  if (/\bvalorant\b/i.test(content)) {
    offenders.push(`${path.relative(prismaDir, file)}: contains 'valorant'`);
  }
}

if (offenders.length > 0) {
  console.error("Quest Prisma must never reference the valorant schema:");
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`prisma schema scope: PASS (${files.length} file(s) scanned, no 'valorant' references)`);
```

- [ ] **Step 2: Add the guard step to Quest CI**

In `QuestEsports/.github/workflows/ci.yml`, inside the `backend` job, insert after the "Verify applied migrations match Prisma schema" step (after line 81):

```yaml
      - name: Verify Prisma never references the valorant schema
        run: node scripts/verify-prisma-schema-scope.js
```

- [ ] **Step 3: Add the migration-scope guard to FastAPI CI**

In `valorant-platform-backend/.github/workflows/ci.yml`, inside the `test` job, insert before the pytest step:

```yaml
      - name: Guard FastAPI migrations from the public schema and cross-schema FKs
        run: |
          if grep -RniE 'public\.|"public"' supabase/migrations; then
            echo "FastAPI migrations must not reference the Quest-owned public schema." >&2
            exit 1
          fi
          if grep -RniE 'references[[:space:]]+public\.' supabase/migrations; then
            echo "FastAPI migrations must not create cross-schema foreign keys." >&2
            exit 1
          fi
          echo "migration schema scope: PASS"
```

- [ ] **Step 4: Document expand-first ordering and rollback limits**

Append to `QuestEsports/docs/DEPLOYMENT_SAFETY.md`:

```markdown
## VALORANT two-schema expand-first rules (Quest + valorant-platform-backend)

The VALORANT integration runs both services against one Supabase project but
keeps two owned schemas: Quest Prisma owns `public`; FastAPI's plain-SQL ledger
owns `valorant`. Deployment follows the same expand-and-contract discipline:

1. Quest Prisma migrations touch only `public`; FastAPI `supabase/migrations/*.sql`
   touch only `valorant`. CI enforces both directions: `verify-prisma-schema-scope.js`
   in Quest CI and the migration-scope grep guard in FastAPI CI.
2. No cross-schema foreign keys. Quest stores every VALORANT UUID as opaque
   `text`; referential integrity is application-level plus FastAPI-read
   reconciliation.
3. Each deploy wave adds columns/tables first, backfills data in a later
   statement of the same wave, and enforces new constraints only in a
   subsequent deploy. Never drop a column/table in the same deploy that
   populates it.
4. Rollback = revert the app deployment. Newly added columns must stay nullable
   or defaulted so the previous app version remains compatible; the CD gate
   (`BACKEND_MIGRATION_APPROVAL_SHA`/`BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA`)
   applies to Quest, and FastAPI production migrations follow the same manual
   approval + backup discipline.
5. `prisma migrate reset` / `db drop` and the FastAPI reset harness remain
   forbidden against shared/remote databases.
6. Take and verify a restorable two-schema backup before any production
   migration that touches either schema (`ops/backup-production.sh` now dumps
   both `public` and `valorant`).
```

Append to `QuestEsports/docs/ci-cd.md` after the "CI Checks" section:

```markdown
The VALORANT integration adds two schema-scope CI guards: Quest CI runs
`node scripts/verify-prisma-schema-scope.js` (Prisma must never reference the
`valorant` schema) and the `valorant-platform-backend` CI runs a grep guard
(its migrations must never reference the Quest-owned `public` schema or create
cross-schema foreign keys).
```

- [ ] **Step 5: Run both guard commands locally**

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/backend && node scripts/verify-prisma-schema-scope.js`
Expected: `prisma schema scope: PASS (... file(s) scanned, no 'valorant' references)`.

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend && grep -RniE 'public\.|"public"' supabase/migrations || echo "migration schema scope: PASS"`
Expected: `migration schema scope: PASS` (no matches).

- [ ] **Step 6: Commit (Quest repo, then FastAPI repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/scripts/verify-prisma-schema-scope.js .github/workflows/ci.yml docs/DEPLOYMENT_SAFETY.md docs/ci-cd.md
git commit -m "feat(ci): guard Prisma schema scope and document two-schema expand-first rules (deployment plan Task 6)"
```

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add .github/workflows/ci.yml
git commit -m "feat(ci): guard migrations from the public schema (deployment plan Task 6)"
```

---

## Task 7: Service readiness and private-networking verification

**Files:**
- Modify: `valorant-platform-backend/docs/architecture-decisions.md`
- Modify: `valorant-platform-backend/tests/unit/test_route_inventory.py`
- Modify: `QuestEsports/docs/setup-and-deployment.md`

- [ ] **Step 1: Record the private-service ADR**

Append to `valorant-platform-backend/docs/architecture-decisions.md`:

```markdown
# ADR-0XX — Private service boundary and health contract

FastAPI is reached only by the Quest backend over a private network. The local
dev server binds to 127.0.0.1; production deployments bind to a private
interface behind an internal load balancer with an IP allowlist (mTLS deferred —
see design §9.1/§10.2). There is no CORS middleware and no browser-facing route.
`GET /api/v1/health` is the only unauthenticated route and returns
`{status, app, env, db}`; every other `/api/v1/*` route requires a valid service
token in non-`local`/`test` environments (delta D1). Quest asserts
`VALORANT_INTERNAL_BASE_URL` is an HTTPS origin in production and never exposes
FastAPI to browsers (enforced by topology, not convention).
```

- [ ] **Step 2: Extend the route-inventory test**

Append to `valorant-platform-backend/tests/unit/test_route_inventory.py`:

```python
def _auth_dependency_names(route: APIRoute) -> set[str]:
    return {
        dep.call.__name__
        for dep in getattr(route.dependant, "dependencies", [])
        if getattr(dep.call, "__name__", None)
    }


def test_health_is_the_only_unauthenticated_api_route():
    # require_service_token comes from delta D1 (plan P3); imported inside the
    # test so the module still imports before D1 lands.
    from app.api.dependencies import require_service_token  # noqa: PLC0415
    from app.main import create_app

    app = create_app()
    health_paths = {"/api/v1/health"}
    auth_names = {"require_admin", "require_service_token"}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if not path.startswith("/api/v1"):
            continue
        present = _auth_dependency_names(route) & auth_names
        if path in health_paths:
            assert not present, f"health must stay unauthenticated: {path}"
        else:
            assert present, f"route missing auth dependency: {path}"
```

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend && uv run pytest tests/unit/test_route_inventory.py -q`
Expected: PASS (this requires plan P3's delta D1 to be merged; until then the test is written but skipped via the plan's execution-order dependency).

- [ ] **Step 3: Add the production topology and readiness notes to the Quest setup doc**

Append to the VALORANT section created in Task 3:

```markdown
Production topology: only Quest Express is reachable by the frontend. FastAPI
lives on a private network with an IP allowlist and binds to a private
interface; the browser never talks to FastAPI. `VALORANT_INTERNAL_BASE_URL` is
asserted to be an HTTPS origin by `backend/src/config/env.js` in production.
```

- [ ] **Step 4: Verify the readiness contract locally**

Run (FastAPI in development mode):

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 &
sleep 2
curl --fail --silent http://127.0.0.1:8000/api/v1/health
kill %1
```
Expected: `{"status":"ok","app":"valorant-platform-backend","env":"development","db":"up"}` (env name matches `APP_ENV`).

Run (auth-enforcing env, no token):

```bash
APP_ENV=production uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 &
sleep 2
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:8000/api/v1/teams
kill %1
```
Expected: `401` (service token required after delta D1; before D1 the same check returns 401 with `ADMIN_AUTH_REQUIRED` from the X-Admin-Key path).

- [ ] **Step 5: Commit (FastAPI repo, then Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add docs/architecture-decisions.md tests/unit/test_route_inventory.py
git commit -m "feat(security): document private service boundary and assert health is the only unauthenticated route (deployment plan Task 7)"
```

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add docs/setup-and-deployment.md
git commit -m "docs(valorant): document private production topology (deployment plan Task 7)"
```

---

## Task 8: Contract fixtures and the two-service E2E harness

**Files:**
- Create: `QuestEsports/backend/tests/valorant-e2e/henrik-mock-server.mjs`
- Create: `QuestEsports/backend/tests/valorant-e2e/valorant-e2e.test.js`
- Modify: `QuestEsports/backend/package.json`
- Modify: `QuestEsports/.github/workflows/ci.yml`
- Create: `valorant-platform-backend/tests/integration/test_quest_contract_shapes.py`
- Create: `QuestEsports/backend/tests/valorant-e2e/README.md`

The E2E harness drives the spec §11.4 journey through Quest routes against a real FastAPI process, both connected to the same Supabase test project, with Henrik stubbed by a fixture-replaying mock server. It depends on plan P1's routes and P3's deltas being merged.

- [ ] **Step 1: Write the fixture-replaying Henrik mock server**

Create `QuestEsports/backend/tests/valorant-e2e/henrik-mock-server.mjs`:

```js
// Fixture-replaying HenrikDev mock for the two-service VALORANT E2E.
// Serves the recorded fixture JSON files from the FastAPI repo
// (HENRIK_MOCK_FIXTURES must point at valorant-platform-backend/tests/fixtures/henrik).
// Routes match app/integrations/henrik/client.py:
//   GET /valorant/v2/account/{name}/{tag}
//   GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}?size&start
//   GET /valorant/v4/match/{affinity}/{match_id}
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.env.HENRIK_MOCK_FIXTURES;
if (!root) {
  console.error("HENRIK_MOCK_FIXTURES must point at the FastAPI henrik fixtures directory");
  process.exit(1);
}
const port = Number(process.env.HENRIK_MOCK_PORT || 18000);
const accountFixture =
  process.env.HENRIK_MOCK_ACCOUNT || "account_v2/valid.json";
const historyFixture =
  process.env.HENRIK_MOCK_HISTORY || "history_v4/page1_mixed_modes.json";
const matchDetailFixture =
  process.env.HENRIK_MOCK_MATCH_DETAIL || "match_detail_v4/valid.json";

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith("/valorant/v2/account/")) {
      const body = JSON.parse(await readFile(path.join(root, accountFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    if (url.pathname.includes("/by-puuid/matches/")) {
      const body = JSON.parse(await readFile(path.join(root, historyFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    if (url.pathname.startsWith("/valorant/v4/match/")) {
      const body = JSON.parse(await readFile(path.join(root, matchDetailFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    sendJson(res, 404, { status: 404, message: `mock: no fixture for ${url.pathname}` });
  } catch (error) {
    console.error("mock server error:", error);
    sendJson(res, 500, { status: 500, message: String(error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`henrik mock listening on 127.0.0.1:${port}`);
});
```

- [ ] **Step 2: Write the E2E driver**

Create `QuestEsports/backend/tests/valorant-e2e/valorant-e2e.test.js`:

```js
// Two-service E2E (design §11.4): boots the Henrik mock, FastAPI (:8000) and
// Quest Express (:5001) against the same Supabase test project, then drives the
// full VALORANT journey through Quest routes with a real admin session.
// REQUIRES the env block below and plan P1 (Quest routes) + P3 (FastAPI deltas).
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
const FIXTURE_ROOT = path.join(VAL_REPO, "tests", "fixtures", "henrik");

const sharedSecret = "e2e-shared-secret";

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

test("full VALORANT journey through Quest routes", async (t) => {
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
    QUEST_SERVICE_SHARED_SECRETS: `e2e:${sharedSecret}`,
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
    VALORANT_TIMEOUT_MS: "10000",
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
    playerA: process.env.E2E_PLAYER_A,
    playerB: process.env.E2E_PLAYER_B,
    pageSize: 10,
    maxPages: 1,
  });
  assert.equal(discover.status, 200);
  assert.ok(Array.isArray(discover.body.candidates), "candidates is an array");

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
    bindingTeamAId: savedTeamA.body.binding.id,
    bindingTeamBId: savedTeamB.body.binding.id,
    format: "bo3",
    playedAt: new Date().toISOString(),
    ratingModePreference: "normal",
    anchorPlayerA: process.env.E2E_PLAYER_A,
    anchorPlayerB: process.env.E2E_PLAYER_B,
  });
  assert.equal(series.status, 201, `series create ${series.status}`);
  const seriesId = series.body.id;

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
  assert.equal(finalize.body.events.length, 2, "two rating events");

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
    bindingTeamAId: savedTeamA.body.binding.id,
    bindingTeamBId: savedTeamB.body.binding.id,
    format: "bo1",
    playedAt: "2020-01-01T00:00:00Z",
    ratingModePreference: "normal",
    anchorPlayerA: process.env.E2E_PLAYER_A,
    anchorPlayerB: process.env.E2E_PLAYER_B,
  });
  assert.equal(backdated.status, 201, `backdated series create ${backdated.status}`);
  const backdatedId = backdated.body.id;
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
});
```

**Timeout/unknown-outcome scenario (spec §11.4 final paragraph):** the harness covers it as a separate opt-in test toggled by `E2E_DROP_FINALIZE_RESPONSE=1`: when set, the mock drops the finalize response after FastAPI commits, and the driver asserts the operation row reaches `reconciliation_required` and reconciliation adopts the committed state. Implement it after the happy-path driver lands (same file, `test("timeout finalize is reconciled by read")`), using the operation-record endpoint `GET /api/v1/admin/valorant/reconciliation`.
```

**Environment contract (documented in `tests/valorant-e2e/README.md`, created in Step 4):**

| Var | Purpose |
|---|---|
| `VALORANT_PLATFORM_REPO` | absolute path to the FastAPI repo checkout |
| `E2E_VAL_DATABASE_URL` | FastAPI `DATABASE_URL` on the shared test project (`valorant` schema, runtime role) |
| `E2E_QUEST_DATABASE_URL` | Quest `DATABASE_URL`/`DIRECT_URL` on the same project (`public`) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | admin login for the session cookie |
| `E2E_SAVED_TEAM_A_ID` / `E2E_SAVED_TEAM_B_ID` | Quest SavedTeam UUIDs to bind |
| `E2E_PLAYER_A` / `E2E_PLAYER_B` | `{name, tag}` anchor Riot IDs resolved by the fixtures |
| `E2E_MATCH_HENRIK_ID` | Henrik text ID present in the history/detail fixtures |
| `E2E_MATCH_UUIDS` | comma-separated VAL match UUIDs present in the detail fixture(s) |
| `E2E_ANCHOR_MISMATCH_SERIES` | id of a pre-seeded draft series whose games are **not** anchor-consistent (drives the §11.4 step-8 `ANCHOR_MISMATCH` check) |

- [ ] **Step 3: Add the npm scripts**

In `QuestEsports/backend/package.json` scripts, add:

```json
    "test:valorant:e2e": "node --test tests/valorant-e2e/valorant-e2e.test.js",
```

- [ ] **Step 4: Create `tests/valorant-e2e/README.md`**

```markdown
# Two-service VALORANT E2E

Boots the Henrik fixture mock (:18000), `valorant-platform-backend` (:8000) and
Quest Express (:5001) against one dedicated Supabase test project, then drives
the design §11.4 journey through Quest admin routes. Requires:

1. The FastAPI repo checked out; `VALORANT_PLATFORM_REPO` points at it.
2. A dedicated test project prepared per docs/setup-and-deployment.md
   (Task 3): FastAPI migrations applied with `--runtime-role val_runtime`,
   Quest Prisma migrations applied, an admin user + two SavedTeams seeded, and
   one anchor-mismatch draft series seeded (`E2E_ANCHOR_MISMATCH_SERIES`).
3. The environment contract table from the deployment plan (Task 8): the
   `E2E_*` and `VALORANT_PLATFORM_REPO` variables listed there.

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
```

- [ ] **Step 5: Wire an opt-in CI job (cross-repo, PAT-gated)**

Append to `QuestEsports/.github/workflows/ci.yml`:

```yaml
  valorant-e2e:
    name: VALORANT two-service E2E
    runs-on: ubuntu-latest
    if: ${{ secrets.VALORANT_PLATFORM_ACCESS_TOKEN != '' }}
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          repository: Russelrip/valorant-platform-backend
          token: ${{ secrets.VALORANT_PLATFORM_ACCESS_TOKEN }}
          path: valorant-platform-backend
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - uses: astral-sh/setup-uv@v3
      - name: Prepare FastAPI deps and env
        working-directory: valorant-platform-backend
        run: uv sync --extra dev
      - name: Run two-service E2E
        working-directory: backend
        run: >-
          VALORANT_PLATFORM_REPO=$GITHUB_WORKSPACE/valorant-platform-backend
          E2E_VAL_DATABASE_URL=${{ secrets.E2E_VAL_DATABASE_URL }}
          E2E_QUEST_DATABASE_URL=${{ secrets.E2E_QUEST_DATABASE_URL }}
          E2E_ADMIN_EMAIL=${{ secrets.E2E_ADMIN_EMAIL }}
          E2E_ADMIN_PASSWORD=${{ secrets.E2E_ADMIN_PASSWORD }}
          E2E_SAVED_TEAM_A_ID=${{ secrets.E2E_SAVED_TEAM_A_ID }}
          E2E_SAVED_TEAM_B_ID=${{ secrets.E2E_SAVED_TEAM_B_ID }}
          E2E_PLAYER_A='${{ secrets.E2E_PLAYER_A }}'
          E2E_PLAYER_B='${{ secrets.E2E_PLAYER_B }}'
          E2E_MATCH_HENRIK_ID=${{ secrets.E2E_MATCH_HENRIK_ID }}
          E2E_MATCH_UUIDS=${{ secrets.E2E_MATCH_UUIDS }}
          E2E_ANCHOR_MISMATCH_SERIES=${{ secrets.E2E_ANCHOR_MISMATCH_SERIES }}
          npm run test:valorant:e2e
```

**Repo secret requirement (documented to the operator):** `VALORANT_PLATFORM_ACCESS_TOKEN` (a read-only PAT for the private FastAPI repo), plus `E2E_*` secrets pointing at the dedicated test project. The job is skipped until the PAT is present.

- [ ] **Step 6: Write the FastAPI contract-shape test**

Create `valorant-platform-backend/tests/integration/test_quest_contract_shapes.py`:

```python
"""FastAPI side of the cross-repo contract (design §11.2): assert the exact
request shapes Quest sends are accepted and the documented responses return.
Runs on the migrated-schema harness like the other integration tests.

Dependencies: delta D2 (quest_saved_team_id), D3 (external_quest_series_id),
D4 (unrated), D6 (anchors), D9 (absolute order endpoint) — plan P3.
"""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.main import create_app

pytestmark = pytest.mark.asyncio


def _app(monkeypatch: pytest.MonkeyPatch, app_env: str = "test"):
    """Same seam as the other integration tests: patch the settings reader in
    ``app.api.dependencies`` so ``app_env="test"`` bypasses auth."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env=app_env, admin_api_key="s3cret-key"),
    )
    return create_app()


async def test_series_create_contract_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    # The assertion is that the schema accepts the documented Quest shape (no
    # 422 on the external key / anchor fields) and that the missing-prerequisite
    # error is the documented TEAM_NOT_FOUND.
    app = _app(monkeypatch)
    async with httpx.ASGITransport(app=app) as transport:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/series",
                json={
                    "team_a_id": "00000000-0000-0000-0000-00000000000a",
                    "team_b_id": "00000000-0000-0000-0000-00000000000b",
                    "format": "bo3",
                    "importance": "regular",
                    "played_at": "2026-08-02T18:00:00Z",
                    "external_quest_series_id": "quest-0000-0000-0000-0000-000000000000",
                    "anchor_player_a": {"name": "PlayerA", "tag": "TAG"},
                    "anchor_player_b": {"name": "PlayerB", "tag": "TAG"},
                },
            )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "TEAM_NOT_FOUND"
```

Note: full shape coverage for attach/order/finalize runs in the two-service E2E (Step 2) where real rows exist; the unit of assertion here is that `external_quest_series_id`, `anchor_player_*` and `rating_mode` literals parse (no `INVALID_REQUEST` 422).

- [ ] **Step 7: Commit (Quest repo, then FastAPI repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/tests/valorant-e2e backend/package.json .github/workflows/ci.yml
git commit -m "feat(e2e): add two-service VALORANT E2E harness and CI wiring (deployment plan Task 8)"
```

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add tests/integration/test_quest_contract_shapes.py
git commit -m "feat(test): add Quest contract-shape integration test (deployment plan Task 8)"
```

---

## Task 9: Secret scanning on both repos

**Files:**
- Modify: `QuestEsports/.gitleaks.toml`
- Create: `valorant-platform-backend/.github/workflows/secret-scan.yml`
- Create: `valorant-platform-backend/.gitleaks.toml`
- Modify: `QuestEsports/backend/tests/secret-scan-placeholders.test.js`

- [ ] **Step 1: Allowlist `.env.example` placeholders in Quest gitleaks**

Replace `QuestEsports/.gitleaks.toml` with:

```toml
[extend]
useDefault = true

[[allowlists]]
description = "Ignore the documented non-production encryption-key placeholder"
targetRules = ["generic-api-key"]
condition = "AND"
regexTarget = "match"
paths = ['''^docs/setup-and-deployment\.md$''']
regexes = ['''(?i)replace[-_a-z0-9]*''']

[[allowlists]]
description = "Ignore committed .env.example templates (placeholders only)"
targetRules = ["generic-api-key"]
condition = "AND"
regexTarget = "match"
paths = ['''^backend/\.env\.example$''']
regexes = ['''(?i)replace[-_a-z0-9]*|user:password|REPLACE_ME|^[A-Z_]+=$''']
```

- [ ] **Step 2: Add secret scanning to the FastAPI repo**

Create `valorant-platform-backend/.github/workflows/secret-scan.yml` (mirrors Quest's):

```yaml
name: Secret scan

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read
  pull-requests: read

concurrency:
  group: secret-scan-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gitleaks:
    name: Gitleaks
    runs-on: ubuntu-latest
    steps:
      - name: Check out complete history
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          fetch-depth: 0

      - name: Scan for committed secrets
        uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Create `valorant-platform-backend/.gitleaks.toml`:

```toml
[extend]
useDefault = true

[[allowlists]]
description = "Ignore committed .env.example templates (placeholders only)"
targetRules = ["generic-api-key"]
condition = "AND"
regexTarget = "match"
paths = ['''^\.env\.example$''']
regexes = ['''(?i)replace[-_a-z0-9]*|user:password|REPLACE_ME|^[A-Z_]+=$''']
```

- [ ] **Step 3: Add a placeholder-shape test to Quest**

Create `QuestEsports/backend/tests/secret-scan-placeholders.test.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("committed .env.example files contain only placeholder values", () => {
  const questExample = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");
  const lines = questExample.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("=")) continue;
    const value = line.slice(line.indexOf("=") + 1).trim();
    // Values must be empty, placeholders, documented defaults, or URLs with
    // USER:PASSWORD style creds — never real secret-shaped values.
    assert.doesNotMatch(
      value,
      /^[A-Za-z0-9+/]{32,}={0,2}$/,
      `secret-shaped value in .env.example: ${line}`,
    );
  }
});
```

Run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/backend && node --test tests/secret-scan-placeholders.test.js`
Expected: PASS.

- [ ] **Step 4: Run gitleaks locally (if installed) or via Docker**

Run (Docker, from either repo root):

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact
```
Expected: `0 leaks detected` and exit `0`. If Docker is unavailable, record the GitHub Actions `secret-scan` run as the evidence (expected: green on the PR/push).

- [ ] **Step 5: Commit (Quest repo, then FastAPI repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add .gitleaks.toml backend/tests/secret-scan-placeholders.test.js
git commit -m "feat(ci): allowlist .env.example placeholders and add placeholder-shape test (deployment plan Task 9)"
```

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add .github/workflows/secret-scan.yml .gitleaks.toml
git commit -m "feat(ci): add gitleaks secret scanning (deployment plan Task 9)"
```

---

## Task 10: Local command reference and smoke script

**Files:**
- Create: `QuestEsports/backend/scripts/valorant-local-smoke.sh`
- Modify: `QuestEsports/backend/package.json`
- Modify: `QuestEsports/docs/setup-and-deployment.md`

- [ ] **Step 1: Write the local smoke script**

Create `QuestEsports/backend/scripts/valorant-local-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Two-service VALORANT local smoke (deployment plan Task 10). Assumes both
# services are already running (see docs/setup-and-deployment.md) against the
# same dedicated Supabase test project. Exits non-zero with a diagnostic on the
# first failed check.

FASTAPI_BASE="${FASTAPI_BASE:-http://127.0.0.1:8000}"
QUEST_BASE="${QUEST_BASE:-http://127.0.0.1:5001}"

echo "1) FastAPI health (must be 200, unauthenticated):"
curl --fail --silent "$FASTAPI_BASE/api/v1/health"
echo

echo "2) FastAPI domain route rejects a missing token (expect 401):"
STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "$FASTAPI_BASE/api/v1/teams")"
if [[ "$STATUS" != "401" ]]; then
  echo "Unexpected status for unauthenticated domain route: $STATUS (expected 401)" >&2
  exit 1
fi
echo "  ok ($STATUS)"

echo "3) Quest liveness (expect 200):"
curl --fail --silent "$QUEST_BASE/api/health/live" > /dev/null
echo "  ok"

echo "4) Quest readiness (expect 200 or intentional 503 x-maintenance-mode):"
curl --fail --silent "$QUEST_BASE/api/health/ready" > /dev/null
echo "  ok"

echo "VALORANT local smoke: PASS"
```

- [ ] **Step 2: Add the npm script**

In `QuestEsports/backend/package.json` scripts, add:

```json
    "test:valorant:smoke": "bash scripts/valorant-local-smoke.sh",
```

- [ ] **Step 3: Add the local command reference to the setup doc**

Append to the VALORANT section in `QuestEsports/docs/setup-and-deployment.md`:

```markdown
### VALORANT local commands

Run the two services in separate terminals against the shared test project:

```bash
# Terminal 1 — FastAPI (repo: ../valorant-platform-backend)
cd ../valorant-platform-backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — Quest backend
cd backend
npm run dev

# Terminal 3 — Quest frontend
cd frontend
npm run dev
```

Smoke and tests:

```bash
cd backend
npm run test:valorant:smoke          # health + auth checks against running services
npm run test:valorant:e2e            # two-service E2E journey (see tests/valorant-e2e/README.md)
```

Expected smoke output: `VALORANT local smoke: PASS`.
```

- [ ] **Step 4: Run the smoke script against a running pair**

Start both services per Step 3, then run: `cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/backend && npm run test:valorant:smoke`
Expected: four checks pass and the script prints `VALORANT local smoke: PASS` (exit 0).

- [ ] **Step 5: Commit (Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add backend/scripts/valorant-local-smoke.sh backend/package.json docs/setup-and-deployment.md
git commit -m "feat(dev): add VALORANT local smoke script and command reference (deployment plan Task 10)"
```

---

## Task 11: Playwright MCP / manual UI verification checklist

Browser installation stays deferred (spec §10.3 — do **not** run `npx playwright install` as part of this work). UI verification uses **Playwright MCP** or a manual browser against `localhost:3000`.

**Files:**
- Create: `QuestEsports/docs/valorant-ui-verification.md`
- Modify: `QuestEsports/docs/admin-operations.md`

- [ ] **Step 1: Write the UI verification checklist**

Create `QuestEsports/docs/valorant-ui-verification.md`:

```markdown
# VALORANT admin UI verification (Playwright MCP / manual)

Browser install is deferred; verify with Playwright MCP or a manual browser
against `http://localhost:3000` with both services running (see
`docs/setup-and-deployment.md` — VALORANT local commands). Use scrubbed fixture
data; never capture real Riot IDs or real matches. Save screenshots to the
operational record, not the repository.

## Flows (each recorded as passed/failed with a screenshot)

1. **Team binding** — `/admin/valorant`: pick an existing SavedTeam, bind it,
   confirm the VALORANT team UUID is shown as an opaque id; bind a second team;
   attempt to bind one team twice and confirm the duplicate is rejected.
2. **Discovery + explicit selection** — `/admin/valorant/discover`: enter two
   Riot IDs; confirm the candidate list shows only the `MatchCandidate` fields
   (no winning side/roster); confirm a no-overlap search returns an empty list,
   not an error; confirm selecting a candidate is explicit (nothing auto-imports).
3. **Series create** — `/admin/valorant/series`: create a BO3 draft with
   Rated/Unrated preference and the two anchor Riot IDs; confirm the draft
   status is shown.
4. **Attach / reorder / remove with side mapping** — attach three imported
   games, set the absolute desired order, remove one game, and confirm each game
   row shows the Red/Blue side assigned to Team A/Team B.
5. **Preview panel** — confirm `valid`, per-game winners, maps won, calculated
   winner, and the anchor identities.
6. **Finalize** — finalize rated; confirm the audit banner (actor + operation
   id) and the two rating events; confirm a second finalize shows the committed
   state with no re-apply.
7. **Anchor-mismatch prompt** — finalize a series whose games do not contain
   both anchors on opposing sides; confirm the `ANCHOR_MISMATCH` surface and the
   override-reason path.
8. **Orphan / reconciliation banner** — with one Quest series left in
   `reconciliation_required`, confirm the admin surface lists it and offers
   controlled re-sync/adoption.
9. **Rankings page** — `/admin/valorant/rankings`: confirm the table reflects
   the finalized series (binding display names joined with FastAPI rankings).
```

- [ ] **Step 2: Reference the checklist from `docs/admin-operations.md`**

Append to `QuestEsports/docs/admin-operations.md`:

```markdown
## VALORANT Admin Verification

The VALORANT admin flows (bindings, discovery, series build, preview/finalize,
reconciliation, rankings) follow the checklist in
[`docs/valorant-ui-verification.md`](./valorant-ui-verification.md), verified
via Playwright MCP or a manual browser with scrubbed data.
```

- [ ] **Step 3: Run the flows via Playwright MCP**

With both services running and the admin logged in, drive each flow in Step 1 through the browser (Playwright MCP or manual), asserting the listed evidence. Expected evidence per flow: a screenshot plus a one-line pass/fail recorded in the operational record. This step runs only after plan P2 (admin UI) and Task 8 (E2E green) are complete — mark it accordingly in the release record.

- [ ] **Step 4: Commit (Quest repo)**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports
git add docs/valorant-ui-verification.md docs/admin-operations.md
git commit -m "docs(valorant): add admin UI verification checklist (deployment plan Task 11)"
```

---

## Release blockers

Ordered by severity; each blocks the named milestone:

1. **Two-schema production backup deployed and a restore drill passed** before any authoritative VALORANT data is colocated in production (spec §7.6 — release blocker for Slice 3+). Evidence: `ops/backup-production.sh` run with manifest `database_scope=application_public_and_valorant_schemas` + `valorant_schema_included=true`, and an isolated restore drill printing non-zero table counts for both `public` and `valorant` (Task 5).
2. **Four-role/RLS enforcement verified in the production Supabase project** before FastAPI runs with `APP_ENV=production`: `scripts.verify_runtime_access` PASS (VAL runtime), `--expect-denied` PASS (Quest runtime), and `npm run prisma:security:verify` PASS (Quest side) (Tasks 1–3).
3. **Service token (delta D1, plan P3) merged and the Task 7 route-inventory test green** before FastAPI is reachable outside local dev.
4. **Two-service E2E journey green** (`npm run test:valorant:e2e`) before the admin UI (plan P2) is promoted (Task 8).
5. **Secret scanning green on both repos** before any merge that introduces `VALORANT_SERVICE_SECRET`/`QUEST_SERVICE_SHARED_SECRETS` handling (Task 9).
6. **Schema-scope CI guards green** on both repos from the moment any `valorant`-related Prisma/FastAPI migration exists (Task 6).

## Commit checkpoints

| # | Repo | Task | Commit summary (exact message in the task) |
|---|---|---|---|
| 1 | `valorant-platform-backend` | Task 1 | `feat(runtime): grant valorant runtime role with explicit RLS policies (deployment plan Task 1)` |
| 2 | `valorant-platform-backend` | Task 2 | `feat(runtime): add roles/RLS verification script and CI job (deployment plan Task 2)` |
| 3 | `QuestEsports` | Task 3 | `docs(valorant): document same-Supabase two-service local topology (deployment plan Task 3)` |
| 4 | `QuestEsports` | Task 4 | `feat(valorant): add VALORANT service env vars with fail-fast validation (deployment plan Task 4)` |
| 5 | `QuestEsports` | Task 5 | `feat(ops): back up public+valorant schemas in one consistent snapshot (deployment plan Task 5)` |
| 6 | `QuestEsports` | Task 6 | `feat(ci): guard Prisma schema scope and document two-schema expand-first rules (deployment plan Task 6)` |
| 7 | `valorant-platform-backend` | Task 6 | `feat(ci): guard migrations from the public schema (deployment plan Task 6)` |
| 8 | `valorant-platform-backend` | Task 7 | `feat(security): document private service boundary and assert health is the only unauthenticated route (deployment plan Task 7)` |
| 9 | `QuestEsports` | Task 7 | `docs(valorant): document private production topology (deployment plan Task 7)` |
| 10 | `QuestEsports` | Task 8 | `feat(e2e): add two-service VALORANT E2E harness and CI wiring (deployment plan Task 8)` |
| 11 | `valorant-platform-backend` | Task 8 | `feat(test): add Quest contract-shape integration test (deployment plan Task 8)` |
| 12 | `QuestEsports` | Task 9 | `feat(ci): allowlist .env.example placeholders and add placeholder-shape test (deployment plan Task 9)` |
| 13 | `valorant-platform-backend` | Task 9 | `feat(ci): add gitleaks secret scanning (deployment plan Task 9)` |
| 14 | `QuestEsports` | Task 10 | `feat(dev): add VALORANT local smoke script and command reference (deployment plan Task 10)` |
| 15 | `QuestEsports` | Task 11 | `docs(valorant): add admin UI verification checklist (deployment plan Task 11)` |

Each checkpoint is per-repo and independently shippable; Tasks 1, 5, 6 may run before 3/4/7–11.

## Acceptance mapping to the approved spec

| Spec requirement | Plan coverage |
|---|---|
| §7.1 four roles; §7.4 RLS decision (a) + runner grants | Task 1 (runner + policies + docs), Task 2 (verification script + CI job), Task 3 (isolation queries) |
| §7.3 expand-first ordering; rollback limits | Task 6 (CI guards + `DEPLOYMENT_SAFETY.md` rules) |
| §7.6 backup must capture both schemas; manifest scope; restore tested | Task 5 (backup/restore scripts + tests + docs) |
| §10.1 same-Supabase local topology + env vars | Task 3 (topology), Task 4 (env.js/config/.env.example validation) |
| §10.2 production topology; private networking; token rotation | Task 7 (ADR + route-inventory test + HTTPS assertion in Task 4) |
| §10.3 Playwright deferred; Playwright MCP/manual | Task 11 |
| §11.2 contract tests (both sides) | Task 8 (Quest contract fixtures via E2E; FastAPI `test_quest_contract_shapes.py`) |
| §11.4 two-service E2E | Task 8 (harness + CI wiring + npm script) |
| §11.6 UI verification | Task 11 (flow checklist, Playwright MCP/manual) |
| §9.1 secret hygiene / §10.2 CI secret-scanning | Task 9 (gitleaks on both repos + placeholder allowlist) |
| §13.1 risk "Schema credential misconfig" | Tasks 1–4 (fail-fast env, roles/RLS CI, isolation queries) |
| §13.1 risk "VAL data without backup" | Task 5 (release blocker #1) |
| §13.1 risk "Playwright/browser gaps" | Task 11 (Playwright MCP/manual substitute) |
