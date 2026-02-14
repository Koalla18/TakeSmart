from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["system"], summary="Health check")
async def health_check() -> dict:
    return {"ok": True}

