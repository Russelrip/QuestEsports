"""Henrik envelope model unit tests (queue contract-drift regression).

Henrik v4 now returns ``metadata.queue`` as an object (``{"id", "name",
"mode_type"}``) instead of a string; ``HenrikMetadata`` coerces it back to its
human-readable ``name`` before validation. These tests pin that coercion for
every representation ``queue`` can take: object (new shape), plain string, and
null, plus the ``name``-absent fallback to ``id``.
"""

from app.integrations.henrik.models import HenrikMatchListItem


def _item(metadata: dict) -> HenrikMatchListItem:
    return HenrikMatchListItem.model_validate(
        {"metadata": {"match_id": "00000000-0000-0000-0000-000000000001", **metadata}}
    )


def test_queue_object_coerced_to_name():
    item = _item({"queue": {"id": "deathmatch", "name": "Deathmatch", "mode_type": "Deathmatch"}})
    assert item.metadata.queue == "Deathmatch"


def test_queue_object_without_name_falls_back_to_id():
    item = _item({"queue": {"id": "swiftplay", "mode_type": "Swiftplay"}})
    assert item.metadata.queue == "swiftplay"


def test_queue_plain_string_unchanged():
    item = _item({"queue": "competitive"})
    assert item.metadata.queue == "competitive"


def test_queue_null_unchanged():
    item = _item({"queue": None})
    assert item.metadata.queue is None


def test_queue_absent_unchanged():
    item = _item({})
    assert item.metadata.queue is None
