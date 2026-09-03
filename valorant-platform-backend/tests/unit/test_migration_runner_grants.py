"""The runner's security posture issues runtime-role grants and RLS policies
only when a runtime role is configured (Task 1 of the deployment plan)."""

from scripts.apply_migrations import (
    POLICY_EXCLUDED_TABLES,
    _apply_security_posture,
    _quote_ident,
)


def test_quote_ident_escapes_double_quotes() -> None:
    assert _quote_ident('va"lorant') == '"va""lorant"'


def test_ledger_table_is_excluded_from_runtime_policies() -> None:
    assert "_migration_ledger" in POLICY_EXCLUDED_TABLES


async def test_security_posture_revokes_runtime_access_to_migration_ledger() -> None:
    class RecordingConnection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        async def execute(self, statement, _parameters=None):
            rendered = str(statement)
            self.statements.append(rendered)
            if rendered.startswith("SELECT tablename FROM pg_tables"):
                return [("_migration_ledger",), ("teams",)]
            return []

    connection = RecordingConnection()

    await _apply_security_posture(connection, "valorant", runtime_role="val_runtime")

    assert (
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "valorant" '
        'TO "val_runtime"'
    ) in connection.statements
    assert (
        'REVOKE ALL ON TABLE "valorant"."_migration_ledger" FROM "val_runtime"'
    ) in connection.statements
    assert not any(
        "CREATE POLICY" in statement and "_migration_ledger" in statement
        for statement in connection.statements
    )
