"""Henrik exception hierarchy (plan Task 5; design §6, §16.2).

One root ``HenrikError``; every failure mode the integration can raise maps to
a concrete subclass so services can translate them into stable app errors.
No upstream body or header value is ever embedded in an exception beyond the
documented fields below (message, sub_code, retry metadata, request_id).
"""


class HenrikError(Exception):
    """Base class for every error raised by the Henrik integration."""


class HenrikAuthenticationError(HenrikError):
    """401/403 — the API key is missing or invalid."""

    def __init__(self, message: str, request_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.request_id = request_id


class HenrikRateLimitError(HenrikError):
    """429 — rate limited. Carries ``Retry-After``/``X-RateLimit-Reset`` when
    upstream provided them (presence varies; never required)."""

    def __init__(
        self,
        message: str,
        retry_after: float | None,
        rate_limit_reset: int | None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after
        self.rate_limit_reset = rate_limit_reset
        self.request_id = request_id


class HenrikNotFoundError(HenrikError):
    """404 — the requested resource does not exist; ``sub_code`` is the
    upstream error code (22 account, 23 region, 26 match) when present."""

    def __init__(self, message: str, sub_code: int | None, request_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.sub_code = sub_code
        self.request_id = request_id


class HenrikValidationError(HenrikError):
    """400 — upstream rejected a request parameter; ``sub_code`` is the pinned
    error code (27 mode, 28 map, 42 platform, 43 uuid, 45 start) when present."""

    def __init__(self, message: str, sub_code: int | None, request_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.sub_code = sub_code
        self.request_id = request_id


class HenrikUnavailableError(HenrikError):
    """500/501/network — upstream is unavailable or unreachable."""

    def __init__(self, message: str, request_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.request_id = request_id


class HenrikProtocolError(HenrikError):
    """The upstream response violated the pinned contract: unexpected envelope
    shape, missing required field, or an unknown side literal. Never guessed."""

    def __init__(self, message: str, request_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.request_id = request_id
