from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session

router = APIRouter(tags=["weekly-slides"])


@router.get("/api/weekly-slides", summary="List weekly slides (public)")
async def list_weekly_slides(
    db: AsyncSession = Depends(db_session),
) -> list:
    """Public endpoint for weekly slides - currently returns empty list."""
    return []


@router.get("/api/admin/weekly-slides", summary="List weekly slides (admin)")
async def list_weekly_slides_admin(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> list:
    """Admin endpoint for weekly slides - currently returns empty list."""
    return []


@router.post("/api/admin/weekly-slides", status_code=201, summary="Create weekly slide (admin)")
async def create_weekly_slide(
    slide_data: dict,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    """Create weekly slide - stub implementation."""
    return {"id": 1, **slide_data}


@router.patch("/api/admin/weekly-slides/{slide_id}", summary="Update weekly slide (admin)")
async def update_weekly_slide(
    slide_id: int,
    slide_data: dict,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    """Update weekly slide - stub implementation."""
    return {"id": slide_id, **slide_data}


@router.delete("/api/admin/weekly-slides/{slide_id}", status_code=204, summary="Delete weekly slide (admin)")
async def delete_weekly_slide(
    slide_id: int,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> Response:
    """Delete weekly slide - stub implementation."""
    return Response(status_code=204)


@router.post("/api/admin/weekly-slides/seed", status_code=201, summary="Seed weekly slides (admin)")
async def seed_weekly_slides(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    """Seed weekly slides - stub implementation."""
    return {"ok": True, "message": "Weekly slides seeded"}

