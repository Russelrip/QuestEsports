# Live Henrik tests — opt-in protocol

Tests in this package hit the **real** HenrikDev API and consume rate units.
They never run unless an operator explicitly opts in. Two independent
mechanisms protect the default runs:

1. **Marker:** every test here carries `pytestmark = pytest.mark.live`. All
   documented commands run with `-m "not live"`, so the package is deselected
   and **never collected** by the standard or real-Postgres suites.
2. **Guard:** `tests/integration/live/conftest.py` installs an autouse
   module-scoped fixture that `pytest.skip`s every test unless **both**
   `RUN_LIVE_HENRIK=1` **and** `HENRIK_API_KEY` are set. A stale key in the
   environment alone can never enable live tests.

## Running the live suite (opt-in)

```bash
HENRIK_API_KEY=... RUN_LIVE_HENRIK=1 uv run pytest -m live tests/integration/live -q
```

## Rules for live tests (rate-limit etiquette)

- Use `size=1` and a single small page (plan App. D); never loop.
- Consume the key from the `live_henrik_key` fixture (guaranteed present past
  the guard), never from `os.environ` directly.
- Record live facts (not asserted stable truth) in `docs/henrik-contract.md`;
  all deterministic behavior must stay covered by the sanitized fixtures under
  `tests/fixtures/henrik/`.
- Never log or print the key; never write it to fixtures or evidence.
