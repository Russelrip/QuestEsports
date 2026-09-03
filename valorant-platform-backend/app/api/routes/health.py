from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter(tags=["health"])


async def _db_status() -> str:
    """SELECT 1 against the async engine.

    Returns "up" when the probe succeeds, "down" when the engine is present but
    unreachable, and "unknown" when the engine is not yet available (Task 4) or
    failed to initialize/import — import failures must never surface as 500s.
    """
    try:
        from app.db.session import engine
    except Exception:  # noqa: BLE001  # any import/init failure -> unknown, never 500
        return "unknown"
    if engine is None:
        return "unknown"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "up"
    except Exception:  # noqa: BLE001  # any connection/probe failure -> down
        return "down"


@router.get("/api/v1/health")
async def health() -> dict:
    db = await _db_status()
    if db != "up":
        return JSONResponse(status_code=503, content={"status": "degraded", "db": db})
    return {"status": "ok", "db": "up"}
