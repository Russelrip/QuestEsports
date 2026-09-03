"""Opt-in live Henrik tests (plan App. D; Task 17 fix round 1).

Nothing in this package may touch the network unless BOTH ``RUN_LIVE_HENRIK=1``
and ``HENRIK_API_KEY`` are set — enforced by the package's own ``conftest.py``
autouse guard. All documented commands run with ``-m "not live"``, which
deselects this package entirely.
"""
