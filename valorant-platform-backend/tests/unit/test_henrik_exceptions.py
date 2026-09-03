"""Henrik exception hierarchy (plan Task 5; design §6, error envelope).

Every exception type's fields are pinned here, plus the mapper's ``map_side``
contract: unknown side literals raise ``HenrikProtocolError`` (never guessed).
"""

import pytest

from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)
from app.integrations.henrik.mapper import HenrikMapper


def test_hierarchy_all_concrete_errors_derive_from_henrik_error():
    assert issubclass(HenrikAuthenticationError, HenrikError)
    assert issubclass(HenrikRateLimitError, HenrikError)
    assert issubclass(HenrikNotFoundError, HenrikError)
    assert issubclass(HenrikValidationError, HenrikError)
    assert issubclass(HenrikUnavailableError, HenrikError)
    assert issubclass(HenrikProtocolError, HenrikError)


def test_authentication_error_fields():
    err = HenrikAuthenticationError("api key is missing or invalid", request_id="req-1")
    assert isinstance(err, HenrikError)
    assert err.message == "api key is missing or invalid"
    assert err.request_id == "req-1"
    assert str(err) == "api key is missing or invalid"
    assert HenrikAuthenticationError("only msg").request_id is None


def test_rate_limit_error_fields():
    err = HenrikRateLimitError(
        "rate limit reached", retry_after=1.0, rate_limit_reset=1700000000, request_id="req-2"
    )
    assert isinstance(err, HenrikError)
    assert err.message == "rate limit reached"
    assert err.retry_after == 1.0
    assert err.rate_limit_reset == 1700000000
    assert err.request_id == "req-2"
    bare = HenrikRateLimitError("m", None, None)
    assert bare.retry_after is None
    assert bare.rate_limit_reset is None


def test_not_found_error_fields():
    err = HenrikNotFoundError("the provided account data is invalid", sub_code=22, request_id="req-3")
    assert isinstance(err, HenrikError)
    assert err.message == "the provided account data is invalid"
    assert err.sub_code == 22
    assert err.request_id == "req-3"
    assert HenrikNotFoundError("m", None).sub_code is None


def test_validation_error_fields():
    err = HenrikValidationError("start value must be greater than 0", sub_code=45)
    assert isinstance(err, HenrikError)
    assert err.message == "start value must be greater than 0"
    assert err.sub_code == 45
    assert err.request_id is None


def test_unavailable_error_fields():
    err = HenrikUnavailableError("upstream internal error", request_id="req-4")
    assert isinstance(err, HenrikError)
    assert err.message == "upstream internal error"
    assert err.request_id == "req-4"


def test_protocol_error_fields():
    err = HenrikProtocolError("unknown side literal 'Green'")
    assert isinstance(err, HenrikError)
    assert err.message == "unknown side literal 'Green'"


def test_map_side_normalizes_pinned_literals():
    mapper = HenrikMapper()
    assert mapper.map_side("Red") == "red"
    assert mapper.map_side("Blue") == "blue"


def test_map_side_unknown_literal_raises_protocol_error():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.map_side("Green")
