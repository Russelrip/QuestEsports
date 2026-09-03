"""Unit tests for the migration runner's SQL statement splitter (Task 4).

Pure string-level checks — no database required. The splitter must only
separate on top-level ``;`` and must not split inside quoted strings (standard
and ``E'...'`` escape strings), comments, or dollar-quoted PL/pgSQL bodies.
"""

from __future__ import annotations

from scripts.apply_migrations import _split_sql_statements


def test_split_basic_statements() -> None:
    assert _split_sql_statements("SELECT 1; SELECT 2;") == ["SELECT 1", "SELECT 2"]


def test_trailing_statement_without_semicolon() -> None:
    assert _split_sql_statements("SELECT 1") == ["SELECT 1"]


def test_semicolon_inside_standard_string_is_kept() -> None:
    assert _split_sql_statements("SELECT 'a;b' AS v;") == ["SELECT 'a;b' AS v"]


def test_doubled_quote_inside_standard_string() -> None:
    assert _split_sql_statements("SELECT 'it''s; ok' AS v;") == ["SELECT 'it''s; ok' AS v"]


def test_escape_string_backslashed_quote_is_kept() -> None:
    # E'it\'; ok' -> the \' is an escaped quote, so the string continues.
    assert _split_sql_statements("SELECT E'it\\'; ok' AS v;") == ["SELECT E'it\\'; ok' AS v"]


def test_escape_string_backslashed_quote_at_end() -> None:
    # E'\'' is the single-quote character (backslash-escaped), not a terminator.
    assert _split_sql_statements("SELECT E'\\'' AS q; SELECT 2;") == [
        "SELECT E'\\'' AS q",
        "SELECT 2",
    ]


def test_escape_string_doubled_quote_is_kept() -> None:
    assert _split_sql_statements("SELECT E'it''s; ok' AS v;") == ["SELECT E'it''s; ok' AS v"]


def test_escape_string_escaped_backslash_before_terminator() -> None:
    # E'path\\' -> \\ is an escaped backslash; the following ' terminates.
    assert _split_sql_statements("SELECT E'path\\\\' AS p; SELECT 2;") == [
        "SELECT E'path\\\\' AS p",
        "SELECT 2",
    ]


def test_escape_prefix_only_at_identifier_boundary() -> None:
    # `some_e` is one identifier; the string after it is a standard string, so
    # a backslash does not protect the quote (matches the PostgreSQL lexer).
    assert _split_sql_statements("some_e'it\\'; x'") == ["some_e'it\\'", "x'"]


def test_dollar_quoted_function_body_semicolons() -> None:
    sql = (
        "CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$\n"
        "BEGIN\n"
        "    RAISE EXCEPTION 'x;y';\n"
        "    RETURN NEW;\n"
        "END;\n"
        "$$ LANGUAGE plpgsql;\n"
        "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f();"
    )
    statements = _split_sql_statements(sql)
    assert len(statements) == 2
    assert statements[0].startswith("CREATE OR REPLACE FUNCTION")
    assert statements[0].endswith("$$ LANGUAGE plpgsql")
    assert statements[1].startswith("CREATE TRIGGER")


def test_tagged_dollar_quote_with_inner_string() -> None:
    sql = "DO $body$ SELECT 'a;b'; $body$;"
    assert _split_sql_statements(sql) == ["DO $body$ SELECT 'a;b'; $body$"]


def test_line_comment_with_semicolons() -> None:
    assert _split_sql_statements("-- note ; ; \nSELECT 1;") == ["-- note ; ; \nSELECT 1"]


def test_block_comment_with_semicolons() -> None:
    assert _split_sql_statements("/* a ; b */ SELECT 1;") == ["/* a ; b */ SELECT 1"]


def test_comment_only_fragments_are_dropped() -> None:
    sql = "-- only a comment\n/* also only a comment */\n;"
    assert _split_sql_statements(sql) == []


def test_comment_after_semicolon_is_dropped() -> None:
    assert _split_sql_statements("SELECT 1; -- trailing ; comment") == ["SELECT 1"]
