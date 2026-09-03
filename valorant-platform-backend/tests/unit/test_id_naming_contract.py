"""ID-naming contract pins (spec §4.4 D10, §4.1 glossary).

The same-looking identifier means different things on different endpoints:
``MatchImportRequest.match_id`` is the Henrik TEXT id; ``AttachGameRequest.match_id``
is the internal VAL ``matches.id`` UUID. These pins freeze the two in place so
a future rename cannot silently swap them.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.matches import MatchDetailResponse, MatchImportRequest
from app.schemas.series import AttachGameRequest


def test_import_match_id_is_henrik_text_id() -> None:
    field = MatchImportRequest.model_fields["match_id"]
    assert field.annotation is str
    assert (
        field.description and "henrik" in field.description.lower()
    ), "MatchImportRequest.match_id must be documented as the Henrik text id"


def test_import_match_id_pattern_rejects_non_hex_text() -> None:
    with pytest.raises(ValidationError):
        MatchImportRequest(match_id="not hex!!!")
    assert MatchImportRequest(match_id="a" * 32).match_id == "a" * 32


def test_attach_game_match_id_is_internal_uuid() -> None:
    field = AttachGameRequest.model_fields["match_id"]
    assert field.annotation is uuid.UUID
    assert (
        field.description and "henrik" in field.description.lower()
    ), "AttachGameRequest.match_id must be documented as the internal VAL match UUID (not the Henrik text id)"


def test_detail_response_exposes_both_ids() -> None:
    assert MatchDetailResponse.model_fields["id"].annotation is uuid.UUID
    assert MatchDetailResponse.model_fields["henrik_match_id"].annotation is str
