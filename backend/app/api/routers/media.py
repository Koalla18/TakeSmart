from __future__ import annotations

from fastapi import APIRouter, Depends

from ...api.deps import admin_required, db_session
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/admin", tags=["media"])


@router.get("/media", summary="List media files (admin)")
async def list_media(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> list:
    """List all media files - stub implementation."""
    return []

