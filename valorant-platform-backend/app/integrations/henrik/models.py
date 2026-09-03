"""Tolerant Pydantic v2 envelope models for Henrik payloads (plan Task 5).

Every model ignores unknown extra fields (``extra="ignore"``) so forward
compatibility with upstream additions never breaks import. Model-enforced
required fields are exactly the Wave 0 "must fail loudly" set: match identity
(``match_id``) and per-player identity (``puuid``/``name``/``tag``). Everything
under ``players[].stats``, agent fields, map name, ``started_at`` and
``is_completed`` is optional at this layer; the import service enforces the
full "required for import" set (U6/U7, design §5.4).

``raw`` fields (excluded from ``model_dump()``) retain the original upstream
dicts verbatim: ignored extra fields survive unchanged and absence of a
required field stays distinguishable from a model default (e.g. ``raw`` shows
``is_completed`` missing while the model defaults to ``False``).
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class HenrikRounds(BaseModel):
    model_config = ConfigDict(extra="ignore")
    won: int = 0
    lost: int = 0


class HenrikMap(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str | None = None
    name: str | None = None


class HenrikMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")
    match_id: str
    map: HenrikMap | None = None
    started_at: datetime | None = None
    is_completed: bool = False
    mode: str | None = None
    queue: str | None = None
    raw: dict = Field(default_factory=dict, exclude=True)

    @field_validator("queue", mode="before")
    @classmethod
    def _coerce_queue_object_to_name(cls, value):
        """Henrik v4 now returns ``metadata.queue`` as an object
        (``{"id", "name", "mode_type"}``); surface its human-readable ``name``
        (falling back to ``id``) so downstream consumers keep receiving a
        string. Plain strings and ``None`` pass through unchanged."""
        if isinstance(value, dict):
            return value.get("name") or value.get("id")
        return value


class HenrikTeam(BaseModel):
    model_config = ConfigDict(extra="ignore")
    team_id: str
    rounds: HenrikRounds = HenrikRounds()
    won: bool | None = None


class HenrikStats(BaseModel):
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _flatten_damage(cls, value):
        """Henrik v4 nests damage as ``stats.damage = {"dealt", "received"}``.

        The flat ``damage_dealt``/``damage_received`` names below match an older
        shape. Because this model ignores extras, the nested object was dropped
        in silence and every stored damage figure was NULL — which is why no
        imported match has ever carried an ADR. Both shapes are accepted, and a
        flat value still wins if a payload carries one.
        """
        if isinstance(value, dict):
            damage = value.get("damage")
            if isinstance(damage, dict):
                value = dict(value)
                value.setdefault("damage_dealt", damage.get("dealt"))
                value.setdefault("damage_received", damage.get("received"))
        return value

    kills: int | None = None
    deaths: int | None = None
    assists: int | None = None
    score: int | None = None
    damage_dealt: int | None = None
    damage_received: int | None = None
    headshots: int | None = None
    bodyshots: int | None = None
    legshots: int | None = None


class HenrikAgent(BaseModel):
    """Henrik v4 sends the agent as ``{"id", "name"}``.

    Older payloads carried a bare ``character`` name and no id at all, so both
    paths are kept and ``agent`` is preferred. Without this the agent columns
    stayed NULL on every import: an unmodelled key is ignored, not reported.
    """

    model_config = ConfigDict(extra="ignore")
    id: str | None = None
    name: str | None = None


class HenrikPlayer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    puuid: str
    name: str
    tag: str
    team_id: str | None = None
    agent: HenrikAgent | None = None
    character: str | None = None  # legacy agent-name path, superseded by ``agent``
    stats: HenrikStats | None = None
    raw: dict = Field(default_factory=dict, exclude=True)


class HenrikMatchListItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    metadata: HenrikMetadata
    players: list[HenrikPlayer] = []
    teams: list[HenrikTeam] = []
    raw: dict = Field(default_factory=dict, exclude=True)


class HenrikMatchDetail(BaseModel):
    model_config = ConfigDict(extra="ignore")
    metadata: HenrikMetadata
    players: list[HenrikPlayer] = []
    teams: list[HenrikTeam] = []
    raw: dict = Field(default_factory=dict, exclude=True)


class HenrikMatchDetailEnvelope(BaseModel):
    """The complete successful v4 match-detail response (Task 5 fix round).

    ``data`` is the normalized ``HenrikMatchDetail`` (whose own ``raw`` carries
    the match data object verbatim); ``raw`` retains the full upstream envelope
    (``{"status": 200, "data": {...}, <extra top-level fields>}``) unchanged so
    the Task 8 import layer can persist the complete payload and distinguish
    absent fields from model defaults. ``raw`` is excluded from ``model_dump()``.
    """

    model_config = ConfigDict(extra="ignore")
    status: int
    data: HenrikMatchDetail
    raw: dict = Field(default_factory=dict, exclude=True)


class HenrikAccount(BaseModel):
    model_config = ConfigDict(extra="ignore")
    puuid: str
    region: str | None = None
    name: str
    tag: str
    platforms: list[str] = []
    updated_at: datetime | None = None
