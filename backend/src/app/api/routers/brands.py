from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.slugify import build_unique_slug
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.brand import BrandCreate, BrandOut, BrandUpdate

logger = get_logger(__name__)
router = APIRouter(prefix="/brands", tags=["Brands"])


@router.get("", response_model=list[BrandOut], summary="Активные бренды")
async def list_brands(limit: int = Query(100, ge=1, le=500)) -> list[BrandOut]:
    async with UnitOfWork() as uow:
        return list(await uow.brands.get_active(limit=limit))


@router.get("/all", response_model=list[BrandOut], dependencies=[Depends(get_current_admin)])
async def list_all_brands(limit: int = Query(500, ge=1, le=500)) -> list[BrandOut]:
    async with UnitOfWork() as uow:
        return list(await uow.brands.get_all(limit=limit))


@router.post("", response_model=BrandOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(get_current_admin)])
async def create_brand(body: BrandCreate) -> BrandOut:
    async with UnitOfWork() as uow:
        if await uow.brands.get_by_name(body.name):
            raise HTTPException(status_code=409, detail=f"Бренд «{body.name}» уже существует")
        slug = await build_unique_slug(body.name, uow.brands.slug_exists)
        brand = await uow.brands.create(**body.model_dump(), slug=slug)
        await uow.commit()
    logger.info("brand_created", brand_id=str(brand.id), name=brand.name)
    return brand


@router.patch("/{brand_id}", response_model=BrandOut, dependencies=[Depends(get_current_admin)])
async def update_brand(brand_id: UUID, body: BrandUpdate) -> BrandOut:
    async with UnitOfWork() as uow:
        brand = await uow.brands.get_by_id(brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail=f"Бренд {brand_id} не найден")

        data = body.model_dump(exclude_unset=True)
        if name := data.get("name"):
            existing = await uow.brands.get_by_name(name)
            if existing and existing.id != brand_id:
                raise HTTPException(status_code=409, detail=f"Бренд «{name}» уже существует")
            if "slug" not in data:
                data["slug"] = await build_unique_slug(name, uow.brands.slug_exists, exclude_id=brand_id)
        if slug := data.get("slug"):
            if await uow.brands.slug_exists(slug, exclude_id=brand_id):
                raise HTTPException(status_code=409, detail=f"Slug «{slug}» уже занят")

        updated = await uow.brands.update(brand_id, **data)
        await uow.commit()
    logger.info("brand_updated", brand_id=str(brand_id))
    return updated


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=[Depends(get_current_admin)])
async def delete_brand(brand_id: UUID) -> None:
    async with UnitOfWork() as uow:
        if not await uow.brands.delete(brand_id):
            raise HTTPException(status_code=404, detail=f"Бренд {brand_id} не найден")
        await uow.commit()
    logger.info("brand_deleted", brand_id=str(brand_id))
