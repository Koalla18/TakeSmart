from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session, redis_client
from ...repositories.category import CategoryRepository
from ...schemas import CategoryCreate, CategoryRead, CategoryUpdate
from ...services.cache import bump_version, get_json, get_version, make_cache_key, set_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["categories"])


@router.get(
    "/categories",
    response_model=list[CategoryRead],
    summary="List active categories",
    description="Public list of active categories ordered by sort order.",
)
async def list_categories(
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> list[CategoryRead]:
    version = await get_version(redis, "ver:categories:list")
    cache_key = make_cache_key("categories:list", version, "active")
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    categories = await CategoryRepository.list_active(db)
    payload = [CategoryRead.model_validate(cat).model_dump() for cat in categories]
    await set_json(redis, cache_key, payload)
    return payload


@router.get(
    "/admin/categories",
    response_model=list[CategoryRead],
    summary="List all categories (admin)",
)
async def list_all_categories(
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> list[CategoryRead]:
    version = await get_version(redis, "ver:categories:admin:list")
    cache_key = make_cache_key("categories:admin:list", version, "all")
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    categories = await CategoryRepository.list_all(db)
    payload = [CategoryRead.model_validate(cat).model_dump() for cat in categories]
    await set_json(redis, cache_key, payload)
    return payload


@router.post(
    "/admin/categories",
    response_model=CategoryRead,
    status_code=201,
    summary="Create category (admin)",
)
async def create_category(
    category_data: CategoryCreate,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> CategoryRead:
    existing = await CategoryRepository.get_by_slug(db, category_data.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Category with this slug already exists")

    category = await CategoryRepository.create(db, category_data.model_dump())
    await bump_version(redis, "ver:categories:list")
    await bump_version(redis, "ver:categories:admin:list")
    logger.info("Category created: %s", category.slug)
    return CategoryRead.model_validate(category)


@router.get(
    "/admin/categories/{category_id}",
    response_model=CategoryRead,
    summary="Get category (admin)",
)
async def get_category(
    category_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> CategoryRead:
    category = await CategoryRepository.get_by_id(db, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return CategoryRead.model_validate(category)


@router.patch(
    "/admin/categories/{category_id}",
    response_model=CategoryRead,
    summary="Update category (admin)",
)
async def update_category(
    category_id: uuid.UUID,
    category_data: CategoryUpdate,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> CategoryRead:
    category = await CategoryRepository.get_by_id(db, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    updated = await CategoryRepository.update(db, category, category_data.model_dump(exclude_unset=True))
    await bump_version(redis, "ver:categories:list")
    await bump_version(redis, "ver:categories:admin:list")
    logger.info("Category updated: %s", updated.slug)
    return CategoryRead.model_validate(updated)


@router.delete(
    "/admin/categories/{category_id}",
    status_code=204,
    summary="Delete category (admin)",
)
async def delete_category(
    category_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> Response:
    category = await CategoryRepository.get_by_id(db, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    await CategoryRepository.delete(db, category)
    await bump_version(redis, "ver:categories:list")
    await bump_version(redis, "ver:categories:admin:list")
    logger.info("Category deleted: %s", category_id)
    return Response(status_code=204)
