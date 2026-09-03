"""Explicit rating policy resolution (plan Task 14; design §10.3, App. B).

Pure, no I/O. ``resolve_rating_policy`` separates the calculated winner
(derived strictly from the imported games by ``compute_series_result``) from
the official winner (which an administrator may override) and resolves the
explicit rating mode.

Locked policy (Global Constraints item 11, encoded in tests):

- no official winner → official defaults to the calculated winner, mode
  ``normal``;
- official == calculated → mode ``normal`` unless an explicit mode is selected
  (a forfeit declared after the maps were played is honored);
- official != calculated (a real override) → a non-empty ``override_reason``
  AND an explicit mode are REQUIRED. An override without a reason, or with a
  reason but no explicitly selected mode, is ambiguous and raises
  ``RatingPolicyRequiredError`` (mapped to 409 ``RATING_POLICY_REQUIRED`` at
  the API boundary) — an ambiguous override is never silently defaulted or
  hidden in generic winner code.

``rate_series`` is False for the two forfeit modes: no ELO is applied.
``forfeit_no_rating`` additionally records no win/loss counters, while
``forfeit_result_only`` records the official winner and counters without a
rating change — the Task 15 consumer distinguishes them by ``mode``.

D4 (spec §4.4): ``unrated`` (Quest integration) NEVER rates and NEVER records
win/loss/matches counters — the series finalizes as a result with no ELO and
no counters, distinct from ``forfeit_result_only`` (which updates counters).

D5 (spec §4.4): ``manual_override``/``forfeit_no_rating``/``forfeit_result_only``
require a non-empty ``override_reason`` whenever they are SELECTED — even when
the official winner equals the calculated winner.

The official winner must be a team of the series; that check needs the
series' team ids, so it lives in the service that calls this function.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

# The locked, explicit rating modes (plan Task 14 interface).
RATING_MODES = ("normal", "unrated", "forfeit_no_rating", "forfeit_result_only", "manual_override")

_RATING_MODES = frozenset(RATING_MODES)

# Modes that apply the ELO calculation (all but the two forfeit modes).
_RATE_SERIES_MODES = frozenset({"normal", "manual_override"})

# D5 (spec §4.4): these modes require a non-empty reason whenever they are
# SELECTED — even when the official winner equals the calculated winner.
_REASON_REQUIRED_MODES = frozenset({"manual_override", "forfeit_no_rating", "forfeit_result_only"})


class RatingPolicyError(Exception):
    """Base class for rating-policy resolution failures (pure, no HTTP)."""


class RatingPolicyRequiredError(RatingPolicyError):
    """An override/forfeit policy is ambiguous; an explicit mode (and, for a
    winner override, a non-empty reason) is required before ELO finalization."""


@dataclass(frozen=True)
class RatingPolicyDecision:
    """The resolved, explicit rating policy for a series finalization.

    ``mode`` is one of ``RATING_MODES``; ``rate_series`` is False for the two
    forfeit modes (no ELO is applied). ``official_winner_id`` is the resolved
    official winner (already defaulted to the calculated winner when no
    override was given); ``override_reason`` is carried so ``calculation_details``
    can record the override and the resolved mode.
    """

    mode: str
    rate_series: bool
    official_winner_id: uuid.UUID | None
    override_reason: str | None


def resolve_rating_policy(
    *,
    official_winner_id: uuid.UUID | None,
    calculated_winner_id: uuid.UUID | None,
    override_reason: str | None,
    explicit_mode: str | None = None,
) -> RatingPolicyDecision:
    """Resolve the official winner and the explicit rating mode.

    - ``official_winner_id is None`` → official = calculated, mode ``normal``
      (an explicit mode is honored if provided).
    - ``official_winner_id == calculated_winner_id`` → mode ``normal`` unless
      an explicit mode was selected (which is honored).
    - ``official_winner_id != calculated_winner_id`` (override) →
      ``override_reason`` REQUIRED (else ``RatingPolicyRequiredError``) and an
      explicit mode REQUIRED (else ``RatingPolicyRequiredError`` — ambiguous).
    """
    if explicit_mode is not None and explicit_mode not in _RATING_MODES:
        raise ValueError(f"unknown rating mode: {explicit_mode!r}")

    # D5 (spec §4.4): a forfeit/override mode is never silently defaulted — it
    # demands a non-empty reason whenever it is SELECTED, even when the
    # official winner equals the calculated winner.
    if explicit_mode in _REASON_REQUIRED_MODES and not is_non_empty(override_reason):
        raise RatingPolicyRequiredError(f"{explicit_mode} requires a non-empty override reason")

    if official_winner_id is None:
        official_winner_id = calculated_winner_id

    if official_winner_id == calculated_winner_id:
        mode = explicit_mode if explicit_mode is not None else "normal"
        return RatingPolicyDecision(
            mode=mode,
            rate_series=mode in _RATE_SERIES_MODES,
            official_winner_id=official_winner_id,
            override_reason=override_reason,
        )

    # A real override: the reason and the mode must both be explicit.
    if not _is_non_empty(override_reason):
        raise RatingPolicyRequiredError("override requires a non-empty override reason")
    if explicit_mode is None:
        raise RatingPolicyRequiredError("override requires an explicitly selected rating mode")
    return RatingPolicyDecision(
        mode=explicit_mode,
        rate_series=explicit_mode in _RATE_SERIES_MODES,
        official_winner_id=official_winner_id,
        override_reason=override_reason,
    )


def decision_from_persisted_state(
    *, mode: str, official_winner_id: uuid.UUID | None, override_reason: str | None
) -> RatingPolicyDecision:
    """Reconstruct the explicit decision a finalize already resolved and
    persisted on a finalized series (plan Task 16 rebuild replay).

    A rebuild replays each series with the SAME mode/winner the finalize
    recorded — it never re-resolves or silently defaults a forfeit.
    ``rate_series`` follows the locked ``_RATE_SERIES_MODES`` set, so a
    ``forfeit_*`` mode produces no rating events on replay.
    """
    return RatingPolicyDecision(
        mode=mode,
        rate_series=mode in _RATE_SERIES_MODES,
        official_winner_id=official_winner_id,
        override_reason=override_reason,
    )


def _is_non_empty(value: str | None) -> bool:
    return value is not None and value.strip() != ""


def is_non_empty(value: str | None) -> bool:
    """True for a non-whitespace, non-empty string (public: used by the
    anchor-waiver check in ``rating_service`` too)."""
    return value is not None and value.strip() != ""
