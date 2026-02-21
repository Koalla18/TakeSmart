from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session

router = APIRouter(tags=["weekly-slides"])


class WeeklySlideCreate(BaseModel):
    """Схема для создания/обновления слайда — лишние поля отвергаются."""
    model_config = ConfigDict(extra="forbid")

    title: str
    subtitle: Optional[str] = None
    image: Optional[str] = None
    link: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Заголовок не может быть пустым")
        if len(v) > 200:
            raise ValueError("Заголовок слишком длинный (макс. 200 символов)")
        return v

    @field_validator("subtitle")
    @classmethod
    def validate_subtitle(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if len(v) > 500:
                raise ValueError("Подзаголовок слишком длинный (макс. 500 символов)")
            return v or None
        return v

    @field_validator("image", "link")
    @classmethod
    def validate_url_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 500:
            raise ValueError("URL слишком длинный (макс. 500 символов)")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        if v < 0:
            raise ValueError("sort_order не может быть отрицательным")
        return v


class WeeklySlideUpdate(WeeklySlideCreate):
    """Все поля опциональны при обновлении."""
    title: Optional[str] = None  # type: ignore[assignment]


@router.get("/api/weekly-slides", summary="List weekly slides (public)")
async def list_weekly_slides(
    db: AsyncSession = Depends(db_session),
) -> list:
    return []


@router.get("/api/admin/weekly-slides", summary="List weekly slides (admin)")
async def list_weekly_slides_admin(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> list:
    return []


@router.post("/api/admin/weekly-slides", status_code=201, summary="Create weekly slide (admin)")
async def create_weekly_slide(
    slide_data: WeeklySlideCreate,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    return {"id": 1, **slide_data.model_dump()}


@router.patch("/api/admin/weekly-slides/{slide_id}", summary="Update weekly slide (admin)")
async def update_weekly_slide(
    slide_id: int,
    slide_data: WeeklySlideUpdate,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    return {"id": slide_id, **slide_data.model_dump(exclude_unset=True)}


@router.delete("/api/admin/weekly-slides/{slide_id}", status_code=204, summary="Delete weekly slide (admin)")
async def delete_weekly_slide(
    slide_id: int,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> Response:
    return Response(status_code=204)


@router.post("/api/admin/weekly-slides/seed", status_code=201, summary="Seed weekly slides (admin)")
async def seed_weekly_slides(
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict:
    return {"ok": True, "message": "Weekly slides seeded"}
