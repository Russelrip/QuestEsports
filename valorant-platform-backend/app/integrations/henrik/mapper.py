"""Fixture-driven Henrik mapper (plan Task 5; design §5.4, §6, §7.2).

Owns the Wave 0 side-literal table and every deterministic field-path mapping.
Mapper methods receive the ``data`` object from the pinned envelope (the
account object / match object); the client owns the envelope boundaries
(``{"status", "data"}`` / ``{"status", "errors": [...]}``). ``parse_error_body``
parses the pinned error envelope and raises ``HenrikProtocolError`` when the
envelope shape is malformed. No raw payload value is ever echoed into
``HenrikProtocolError`` messages.
"""

import re
from datetime import UTC, datetime
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.integrations.henrik.contract import SIDE_LITERAL_MAP
from app.integrations.henrik.exceptions import HenrikProtocolError
from app.integrations.henrik.models import (
    HenrikAccount,
    HenrikMatchDetail,
    HenrikMatchListItem,
)

_T = TypeVar("_T", bound=BaseModel)

# Deathmatch (and other free-for-all modes) reports one team per player with a
# UUID team id, not a "Red"/"Blue" side — those are not sides and must be left
# untouched so score derivation reports both sides as absent.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class HenrikMapper:
    """Translate pinned upstream ``data`` objects into tolerant Pydantic models.

    Required fields enforced here are the model-enforced identity set (match_id
    and per-player puuid/name/tag); optional fields (map name, started_at,
    is_completed, team_id, stats, agent) stay tolerant for the import layer.
    """

    def parse_error_body(self, body: dict) -> tuple[int, str, list[dict]]:
        """Return ``(status, message, errors[])`` from the pinned error envelope.

        Henrik uses two envelope shapes: ``{"status": <int>, "errors": [...]}``
        and, for account-not-found, ``{"errors": [{..., "status": <int>}]}`` with
        no top-level status. Both are accepted; the top-level value wins when
        present. A malformed envelope — non-dict body, missing/empty errors, no
        integer status in either position, or an error item whose ``message`` is
        not a string or whose ``code``/``status`` is not an int or null — raises
        ``HenrikProtocolError`` (never guesses). Booleans are rejected as
        ``status``/``code`` (they subclass ``int`` in Python).
        """
        if not isinstance(body, dict):
            raise HenrikProtocolError("error envelope must be a JSON object")
        errors = body.get("errors")
        if not isinstance(errors, list) or not errors:
            raise HenrikProtocolError("error envelope requires a non-empty errors list")
        messages: list[str] = []
        item_status: int | None = None
        for item in errors:
            if not isinstance(item, dict):
                raise HenrikProtocolError("error item must be an object")
            if not isinstance(item.get("message"), str):
                raise HenrikProtocolError("error item requires a string message")
            code = item.get("code")
            if code is not None and (not isinstance(code, int) or isinstance(code, bool)):
                raise HenrikProtocolError("error item code must be an integer or null")
            nested = item.get("status")
            if nested is not None:
                if not isinstance(nested, int) or isinstance(nested, bool):
                    raise HenrikProtocolError("error item status must be an integer or null")
                if item_status is None:
                    item_status = nested
            messages.append(item["message"])

        # Henrik uses TWO error envelope shapes, both observed in production:
        #
        #   {"status": 400, "errors": [{"code": 27, "message": "..."}]}
        #   {"errors": [{"code": 22, "message": "Account not found",
        #                "status": 404, "details": null}]}
        #
        # The second omits the top-level status and carries it per item. Only
        # accepting the first made every account-not-found look like a protocol
        # violation, which the service then reported as HENRIK_UNAVAILABLE — so
        # a player with a typo was told the provider was down instead of being
        # told to check their spelling.
        status = body.get("status")
        if not isinstance(status, int) or isinstance(status, bool):
            status = item_status
        if status is None:
            raise HenrikProtocolError("error envelope requires an integer status")
        return status, "; ".join(messages), errors

    def to_account(self, raw: dict) -> HenrikAccount:
        """Parse an account ``data`` object; malformed required identity raises
        ``HenrikProtocolError``."""
        return self._validate(HenrikAccount, raw)

    def to_match_list_item(self, raw: dict) -> HenrikMatchListItem:
        """Parse a match object from the history-list ``data[]``."""
        item = self._validate(HenrikMatchListItem, raw)
        self._attach_raw(item, raw)
        self._normalize_sides(item)
        return item

    def to_match_detail(self, raw: dict) -> HenrikMatchDetail:
        """Parse the detail ``data`` dict, normalizing sides for derivation."""
        item = self._validate(HenrikMatchDetail, raw)
        self._attach_raw(item, raw)
        self._normalize_sides(item)
        return item

    def map_side(self, literal: str) -> str:
        """Normalize an upstream side literal via ``SIDE_LITERAL_MAP``.

        Unknown literals raise ``HenrikProtocolError``; the mapper never guesses.
        """
        try:
            return SIDE_LITERAL_MAP[literal]
        except KeyError:
            raise HenrikProtocolError(f"unknown side literal {literal!r}") from None

    def to_player_mmr(self, raw: dict) -> dict:
        """Normalize an MMR ``data`` object to a plain flat dict (R6).

        The upstream MMR response has TWO response shapes and both must be
        handled:

        - nested: ``data.current.tier.name`` -> ``currenttierpatched``,
          ``data.current.tier.id`` -> ``current_tier``, ``data.current.elo`` ->
          ``elo``, ``data.current.rr`` -> ``ranking_in_tier``;
        - flat: ``data.currenttierpatched`` / ``data.currenttier`` / ``data.elo``
          / ``data.ranking_in_tier``.

        Both are normalized to a single flat ``rank_details`` dict (defaults:
        ``currenttierpatched="Unrated"``, ints ``0``, matching valorantsl-new).
        ``peak_rank``, ``seasonal_ranks`` and account ``name``/``tag`` are
        extracted alongside. Returns ``{"name", "tag", "rank_details",
        "peak_rank", "seasonal_ranks"}``; the dict flows into a JSONB column
        where valorantsl-new parses defensively, so no pydantic model is used.
        """
        data = raw if isinstance(raw, dict) else {}
        current_raw = data.get("current")
        current = current_raw if isinstance(current_raw, dict) else {}
        tier_raw = current.get("tier")
        tier = tier_raw if isinstance(tier_raw, dict) else {}

        rank_details = {
            "currenttierpatched": (
                tier.get("name")
                if "name" in tier
                else (data.get("currenttierpatched") or "Unrated")
            ),
            "current_tier": (
                tier.get("id")
                if "id" in tier
                else (data.get("currenttier") or 0)
            ),
            "elo": (
                current.get("elo")
                if "elo" in current
                else (data.get("elo") or 0)
            ),
            "ranking_in_tier": (
                current.get("rr")
                if "rr" in current
                else (data.get("ranking_in_tier") or 0)
            ),
            "games_needed_for_rating": (
                current.get("games_needed_for_rating")
                if "games_needed_for_rating" in current
                else (data.get("games_needed_for_rating") or 0)
            ),
        }

        peak_raw = data.get("peak")
        peak = peak_raw if isinstance(peak_raw, dict) else {}
        peak_tier_raw = peak.get("tier")
        peak_tier = peak_tier_raw if isinstance(peak_tier_raw, dict) else {}
        peak_season_raw = peak.get("season")
        peak_season = peak_season_raw if isinstance(peak_season_raw, dict) else {}
        peak_rank = {
            "tier_name": peak_tier.get("name", "Unknown"),
            "season_short": peak_season.get("short", "Unknown"),
            "tier": peak_tier.get("id", 0),
        }

        account_raw = data.get("account")
        account = account_raw if isinstance(account_raw, dict) else {}
        return {
            "name": account.get("name", "Unknown"),
            "tag": account.get("tag", "0000"),
            "rank_details": rank_details,
            "peak_rank": peak_rank,
            "seasonal_ranks": self._to_seasonal_ranks(data),
        }

    def to_last_competitive_match(self, raw: list) -> str | None:
        """ISO timestamp of the newest match in the v4 history list (``size=1``).

        Reads ``raw[0]["metadata"]["started_at"]`` verbatim when present;
        otherwise falls back to ``raw[0]["metadata"]["game_start]`` (ms epoch ->
        ``datetime.fromtimestamp(ms/1000, tz=UTC).isoformat()``, so the
        timestamp is UTC regardless of the host's local timezone — a naive-local
        conversion would skew ``last_played_match`` and corrupt the 14-day
        leaderboard filter). Empty list (or a metadata block with neither field)
        -> ``None``.
        """
        if not raw:
            return None
        metadata = raw[0].get("metadata") if isinstance(raw[0], dict) else None
        if not isinstance(metadata, dict):
            return None
        started_at = metadata.get("started_at")
        if isinstance(started_at, str) and started_at:
            return started_at
        game_start = metadata.get("game_start")
        if isinstance(game_start, (int, float)):
            return datetime.fromtimestamp(game_start / 1000, tz=UTC).isoformat()
        return None

    # ------------------------------------------------------------ internals

    @staticmethod
    def _to_seasonal_ranks(data: dict) -> list[dict]:
        """Port of ``valorantsl-new`` ``updater/riot_api.py``
        ``_get_seasonal_ranks_info``: ``data.seasonal`` -> processed list,
        sorted by ``season_short`` descending (most recent first)."""
        seasonal_data = data.get("seasonal", [])
        if not isinstance(seasonal_data, list):
            return []
        processed: list[dict] = []
        for season in seasonal_data:
            if not isinstance(season, dict):
                continue
            season_raw = season.get("season")
            season_info = season_raw if isinstance(season_raw, dict) else {}
            end_tier_raw = season.get("end_tier")
            end_tier_info = end_tier_raw if isinstance(end_tier_raw, dict) else {}
            season_record = {
                "season_short": season_info.get("short", "Unknown"),
                "season_id": season_info.get("id", ""),
                "wins": season.get("wins", 0),
                "games": season.get("games", 0),
                "end_tier": {
                    "id": end_tier_info.get("id", 0),
                    "name": end_tier_info.get("name", "Unknown"),
                },
                "end_rr": season.get("end_rr", 0),
                "ranking_schema": season.get("ranking_schema", "base"),
                "leaderboard_placement": season.get("leaderboard_placement"),
            }
            act_wins = season.get("act_wins", [])
            if isinstance(act_wins, list) and act_wins:
                tier_counts: dict[str, int] = {}
                for act_win in act_wins:
                    if isinstance(act_win, dict):
                        tier_name = act_win.get("name", "Unknown")
                        tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1
                season_record["act_wins_summary"] = tier_counts
                season_record["total_act_wins"] = len(act_wins)
            processed.append(season_record)
        processed.sort(key=lambda x: x.get("season_short", ""), reverse=True)
        return processed

    @staticmethod
    def _attach_raw(item, raw: dict) -> None:
        """Preserve original upstream dicts verbatim on every ``raw`` field.

        The tolerant models drop unknown fields; ``raw`` keeps them so ignored
        extra fields survive unchanged, absent required fields stay
        distinguishable from model defaults, and Task 8 import can persist the
        complete payload (metadata + per-player + the whole item).
        """
        raw_meta = raw.get("metadata")
        if isinstance(raw_meta, dict):
            item.metadata.raw = raw_meta
        raw_players = raw.get("players")
        if isinstance(raw_players, list):
            for player, raw_player in zip(item.players, raw_players):
                if isinstance(raw_player, dict):
                    player.raw = raw_player
        if hasattr(item, "raw"):
            item.raw = raw

    def _normalize_sides(self, item: HenrikMatchListItem | HenrikMatchDetail) -> None:
        """Normalize upstream side literals to canonical "red"/"blue"; leave
        non-side team ids (per-player UUIDs in Deathmatch) unchanged so
        ``derive_scores`` reports those sides as absent. Any other unknown
        literal still fails loudly (contract drift)."""
        for team in item.teams:
            if team.team_id is not None and not _UUID_RE.match(team.team_id):
                team.team_id = self.map_side(team.team_id)
        for player in item.players:
            if player.team_id is not None and not _UUID_RE.match(player.team_id):
                player.team_id = self.map_side(player.team_id)

    @staticmethod
    def _validate(model: type[_T], raw: dict) -> _T:
        if not isinstance(raw, dict):
            raise HenrikProtocolError(f"{model.__name__} payload must be a JSON object")
        if "players" in raw:
            _require_list_of_dicts(raw.get("players"), "players")
        if "teams" in raw:
            _require_list_of_dicts(raw.get("teams"), "teams")
        try:
            return model.model_validate(raw)
        except ValidationError as exc:
            # Field paths only; raw input values (which could carry secrets)
            # are never included in the message.
            details = "; ".join(
                f"{'.'.join(str(part) for part in err.get('loc', ()))}: {err.get('msg', 'invalid')}"
                for err in exc.errors()
            )
            raise HenrikProtocolError(f"invalid {model.__name__}: {details}") from exc


def _require_list_of_dicts(value, field: str) -> None:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise HenrikProtocolError(f"{field} must be a list of objects")
