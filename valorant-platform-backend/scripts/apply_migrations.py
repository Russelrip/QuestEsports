"""Plain-SQL migration runner with a durable ledger (Task 4; Task 17 fix round 1).

Executes every ``*.sql`` file under ``supabase/migrations`` in filename order,
each file inside its own transaction, and records each success **transactionally**
in a ``_migration_ledger`` table inside the target schema:

- **Apply each migration exactly once.** An already-recorded migration is skipped
  (never re-run); a new migration is applied and recorded in the same transaction,
  so a failed migration rolls back everything (including its ledger row) and the
  run aborts at the first failure.
- **Checksum drift is fatal.** The sha256 of each applied file is stored; re-running
  with a changed, already-applied file raises ``MigrationDriftError``.
- **Name drift is reported.** A ledger entry whose file no longer exists on disk
  (renamed/removed migration) is collected as a visible warning, not silently
  ignored — but it does not fail the run, because deliberately partial migration
  sets are legitimate (the harness's 0001–0010 → 0011–0013 upgrade test applies
  from subsets).
- **Private-schema security posture (four-role model, ADR-001).** When no
  ``--search-path`` is given, the runner creates the private application schema
  ``valorant`` (``app.config.APP_DB_SCHEMA``) and pins every connection to it.
  In both modes it then revokes ``PUBLIC`` access on the schema/tables/default
  privileges and enables row-level security on every application table. Under
  the four-role model (Quest migrator/runtime and VAL migrator/runtime), the
  runner additionally grants the VAL runtime role (``--runtime-role`` /
  ``DATABASE_RUNTIME_ROLE``) schema/table/sequence access and default
  privileges, and applies an idempotent per-table RLS policy
  ``<table>_runtime_all`` granting ``FOR ALL ... USING (true) WITH CHECK (true)``
  to that role — its direct connection is the only legitimate caller and every
  other role sees nothing. The connecting migrator owns the schema/tables and
  is unaffected by RLS; ``_migration_ledger`` is migrator-only and excluded from
  runtime policies. When no runtime role is configured, the runner leaves the
  owner-only posture (development/test default).

Concurrency: two runners racing the same migration fail loudly (the ledger's
``PRIMARY KEY (name)`` is the serialization point — the loser aborts with a
duplicate-key error after the winner commits), which is the safe outcome for an
operator error.

Multiple statements per file are supported via a small splitter that respects
quoted strings, comments, and dollar-quoted bodies (needed for the Phase 2
PL/pgSQL trigger migrations), because the asyncpg dialect cannot run several
statements in a single prepared execution.

Usage: ``uv run python -m scripts.apply_migrations`` (reads ``DATABASE_URL``
from the environment). ``--database-url`` overrides the URL for tests;
``--search-path`` targets a specific schema for the isolated test harness;
``--runtime-role`` (or ``DATABASE_RUNTIME_ROLE``) grants the VAL runtime role
schema/table/sequence access and per-table RLS policies.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.config import APP_DB_SCHEMA, Settings
from app.db.tls import database_connect_args

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MIGRATIONS_DIR = PROJECT_ROOT / "supabase" / "migrations"

# Durable migration ledger inside the target schema. Unqualified on purpose:
# every connection's search_path resolves it (and every migration) in the same
# schema, so the ledger can never be confused with an application table.
LEDGER_TABLE = "_migration_ledger"

# The migration ledger is migrator-only; it is never granted to or protected
# for the runtime role.
POLICY_EXCLUDED_TABLES = {LEDGER_TABLE}

_DOLLAR_TAG_RE = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$")
_COMMENT_ONLY_RE = re.compile(r"(?:--[^\n]*(?:\n|$)|\/\*.*?\*\/)", re.DOTALL)
_IDENT_CHAR_RE = re.compile(r"[A-Za-z0-9_$]")


class MigrationError(Exception):
    """Base error for migration-run failures (rollback already happened)."""


class MigrationDriftError(MigrationError):
    """An already-applied migration's file changed since it was recorded."""

    def __init__(self, name: str, recorded: str, current: str) -> None:
        super().__init__(
            f"migration drift: {name} was already applied with checksum {recorded[:12]} "
            f"but the file now hashes to {current[:12]}; refusing to re-apply"
        )
        self.name = name
        self.recorded_checksum = recorded
        self.current_checksum = current


@dataclass
class MigrationResult:
    """Outcome of one ``apply_migrations`` run."""

    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _is_comment_only(statement: str) -> bool:
    """True when a statement is only comments/whitespace and has no SQL."""
    rest = statement.strip()
    while rest:
        match = _COMMENT_ONLY_RE.match(rest)
        if not match:
            return False
        rest = rest[match.end() :].lstrip()
    return True


def _consume_string(sql: str, i: int) -> int:
    """Return the index just past the string literal that opens at ``sql[i]``.

    Handles standard strings (where ``''`` is an escaped quote) and escape
    strings ``E'...'``/``e'...'`` (where backslash escapes also make ``\\'`` a
    literal quote that never terminates the string, and ``''`` still doubles),
    matching the PostgreSQL lexer for well-formed input. ``E`` is treated as a
    prefix only when it is not trailing an identifier.
    """
    n = len(sql)
    escape_active = (
        i >= 1
        and sql[i - 1] in "Ee"
        and (i < 2 or not _IDENT_CHAR_RE.match(sql[i - 2]))
    )
    j = i + 1
    while j < n:
        ch = sql[j]
        if escape_active and ch == "\\":
            j += 2  # backslash escape consumes the next character (e.g. \')
            continue
        if ch == "'":
            if j + 1 < n and sql[j + 1] == "'":
                j += 2  # doubled quote inside the string
                continue
            return j + 1  # closing quote
        j += 1
    return n  # unterminated: consume to EOF; PostgreSQL will reject the file


def _split_sql_statements(sql: str) -> list[str]:
    """Split a SQL script at top-level ``;`` separators.

    Tracks single-quoted strings (``''`` doubling, plus backslash escapes in
    ``E'...'`` strings), double-quoted identifiers, line/block comments, and
    dollar-quoted bodies so separators inside PL/pgSQL functions are kept.
    """
    statements: list[str] = []
    buf: list[str] = []
    dollar_tag: str | None = None
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(ch)
            i += 1
            continue

        if ch == "$":
            match = _DOLLAR_TAG_RE.match(sql, i)
            if match:
                dollar_tag = match.group(0)
                buf.append(dollar_tag)
                i += len(dollar_tag)
                continue
            buf.append(ch)
            i += 1
            continue

        if ch == "'":
            end = _consume_string(sql, i)
            buf.append(sql[i:end])
            i = end
            continue

        if ch == '"':
            j = i + 1
            while j < n and sql[j] != '"':
                j += 1
            j = min(j + 1, n)
            buf.append(sql[i:j])
            i = j
            continue

        if ch == "-" and nxt == "-":
            j = sql.find("\n", i)
            if j == -1:
                j = n
            buf.append(sql[i:j])
            i = j
            continue

        if ch == "/" and nxt == "*":
            end = sql.find("*/", i + 2)
            j = n if end == -1 else end + 2
            buf.append(sql[i:j])
            i = j
            continue

        if ch == ";":
            statement = "".join(buf).strip()
            if statement and not _is_comment_only(statement):
                statements.append(statement)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail and not _is_comment_only(tail):
        statements.append(tail)
    return statements


async def _bootstrap_ledger(conn: AsyncConnection) -> None:
    """Create the ledger table if absent (idempotent; resolves via search_path)."""
    await conn.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} ("
            "name text PRIMARY KEY, "
            "checksum text NOT NULL, "
            "applied_at timestamptz NOT NULL DEFAULT now())"
        )
    )


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
    # The ledger is migrator-owned control-plane state, not application data.
    # Revoke explicitly after the broad grant so reruns also repair databases
    # where an older runner exposed it to the runtime role.
    await conn.execute(
        text(f"REVOKE ALL ON TABLE {q}.{_quote_ident(LEDGER_TABLE)} FROM {rr}")
    )
    await conn.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {q} TO {rr}"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {rr}"))
    await conn.execute(text(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q} GRANT USAGE, SELECT ON SEQUENCES TO {rr}"))
    for table in table_names:
        if table in POLICY_EXCLUDED_TABLES:
            continue
        qualified = f"{q}.{_quote_ident(table)}"
        # The policy name is assembled from the table name, so quote it too —
        # defensive only (tables are snake_case today), but safe for any
        # identifier. Drop-then-create keeps the posture idempotent on every
        # migration run.
        policy = _quote_ident(f"{table}_runtime_all")
        await conn.execute(text(f"DROP POLICY IF EXISTS {policy} ON {qualified}"))
        await conn.execute(text(f"CREATE POLICY {policy} ON {qualified} FOR ALL TO {rr} USING (true) WITH CHECK (true)"))


async def _run_migrations(engine, migrations_dir: Path, schema: str, runtime_role: str | None = None) -> MigrationResult:
    result = MigrationResult()
    migrations = sorted(migrations_dir.glob("*.sql"))

    # Bootstrap the ledger (own transaction; durable even if a migration fails).
    async with engine.begin() as conn:
        await _bootstrap_ledger(conn)

    for path in migrations:
        name = path.name
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        async with engine.begin() as conn:
            row = (
                await conn.execute(
                    text(f"SELECT checksum FROM {LEDGER_TABLE} WHERE name = :name"), {"name": name}
                )
            ).first()
            if row is not None:
                if row.checksum != checksum:
                    raise MigrationDriftError(name, row.checksum, checksum)
                result.skipped.append(name)
                continue
            statements = _split_sql_statements(path.read_text(encoding="utf-8"))
            if not statements:
                continue
            for statement in statements:
                await conn.execute(text(statement))
            await conn.execute(
                text(f"INSERT INTO {LEDGER_TABLE} (name, checksum) VALUES (:name, :checksum)"),
                {"name": name, "checksum": checksum},
            )
            result.applied.append(name)

    # Security posture (idempotent; fails loudly if it cannot be applied).
    async with engine.begin() as conn:
        await _apply_security_posture(conn, schema, runtime_role=runtime_role)

    # Name drift: ledger entries whose file is no longer on disk.
    async with engine.begin() as conn:
        ledger_names = {row[0] for row in (await conn.execute(text(f"SELECT name FROM {LEDGER_TABLE}"))).all()}
    disk_names = {path.name for path in migrations}
    for orphaned in sorted(ledger_names - disk_names):
        result.warnings.append(
            f"ledger entry {orphaned} has no matching file on disk "
            f"(renamed or removed migration); its effects remain applied"
        )
    return result


async def apply_migrations(
    database_url: str,
    migrations_dir: Path = Path("supabase/migrations"),
    *,
    search_path: str | None = None,
    runtime_role: str | None = None,
) -> MigrationResult:
    """Apply pending migrations in filename order with the durable ledger;
    returns a ``MigrationResult``.

    ``search_path`` (optional) pins every connection to a target schema and is
    used by the test harness to apply migrations into an isolated schema. When
    it is omitted, the runner creates the private application schema
    (``app.config.APP_DB_SCHEMA``) and pins every connection to it.
    ``runtime_role`` (optional, four-role model) grants the VAL DML runtime
    role schema/table/sequence access, default privileges, and per-table RLS
    policies (see ``_apply_security_posture``); the runner leaves the current
    owner-only posture when it is omitted (development/test default).
    """
    target_schema = search_path or APP_DB_SCHEMA
    settings = Settings(database_url=database_url)
    if search_path is None:
        # Create the private app schema up front (idempotent), then pin the
        # search_path so the ledger and every migration resolve inside it.
        admin = create_async_engine(
            database_url,
            connect_args=database_connect_args(settings),
        )
        try:
            async with admin.begin() as conn:
                await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {_quote_ident(APP_DB_SCHEMA)}"))
        finally:
            await admin.dispose()
    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=database_connect_args(settings, search_path=target_schema),
    )
    try:
        result = await _run_migrations(engine, migrations_dir, target_schema, runtime_role=runtime_role)
        return result
    finally:
        await engine.dispose()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Apply plain-SQL migrations (no Alembic)")
    parser.add_argument(
        "--database-url", default=None, help="override DATABASE_URL (used by the test harness)"
    )
    parser.add_argument(
        "--migrations-dir",
        default=str(DEFAULT_MIGRATIONS_DIR),
        help=f"directory of *.sql migrations (default: {DEFAULT_MIGRATIONS_DIR})",
    )
    parser.add_argument(
        "--search-path", default=None, help="target Postgres schema (isolated test harness)"
    )
    parser.add_argument(
        "--runtime-role",
        default=None,
        help="VAL DML runtime role to grant schema access and RLS policies "
        "(overrides DATABASE_RUNTIME_ROLE)",
    )
    args = parser.parse_args()

    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is not set and --database-url was not provided")

    runtime_role = args.runtime_role or os.environ.get("DATABASE_RUNTIME_ROLE")
    result = await apply_migrations(
        database_url,
        Path(args.migrations_dir),
        search_path=args.search_path,
        runtime_role=runtime_role,
    )
    target = args.search_path or APP_DB_SCHEMA
    print(f"target schema: {target}")
    print(f"applied {len(result.applied)} migration(s): {', '.join(result.applied)}")
    print(f"skipped {len(result.skipped)} already-applied migration(s)")
    for warning in result.warnings:
        print(f"warning: {warning}")


if __name__ == "__main__":
    asyncio.run(main())
