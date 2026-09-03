"""Pure anchor-verification unit tests (spec §4.4 D6)."""

from __future__ import annotations

import uuid

from app.domain.series.anchor import verify_opposing_anchors

M1 = uuid.UUID("10000000-0000-0000-0000-000000000001")
M2 = uuid.UUID("10000000-0000-0000-0000-000000000002")
A, B = "puuid_a", "puuid_b"


def test_opposing_anchors_pass() -> None:
    sides = {M1: {A: "red", B: "blue"}, M2: {A: "blue", B: "red"}}
    assert verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1, M2], sides_by_match=sides) == []


def test_missing_anchor_a_fails() -> None:
    sides = {M1: {B: "blue"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert len(errors) == 1
    assert "anchor A" in errors[0]


def test_missing_anchor_b_fails() -> None:
    sides = {M1: {A: "red"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert any("anchor B" in e for e in errors)


def test_same_side_fails() -> None:
    sides = {M1: {A: "red", B: "red"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert any("opposing sides" in e for e in errors)


def test_game_with_no_data_fails_for_both_anchors() -> None:
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1, M2], sides_by_match={})
    assert len(errors) == 4
