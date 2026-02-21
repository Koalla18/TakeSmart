from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session, redis_client
from ...repositories.product import ProductRepository
from ...schemas import ProductCreate, ProductRead, ProductUpdate
from ...services.cache import bump_version, get_json, get_version, make_cache_key, set_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["products"])


async def _serialize_product(product) -> dict[str, Any]:
    return ProductRead.model_validate(product).model_dump()


async def _with_variants(product, session: AsyncSession) -> dict[str, Any]:
    payload = await _serialize_product(product)
    if product.variant_group_id:
        variants = await ProductRepository.list_variants(session, product.variant_group_id)
        payload["variants"] = [
            {
                "id": variant.id,
                "slug": variant.slug,
                "color": variant.color,
                "color_code": variant.color_code,
                "storage": variant.storage,
                "price": variant.price,
                "in_stock": variant.in_stock,
            }
            for variant in variants
        ]
    return payload


@router.get(
    "/products",
    response_model=list[ProductRead],
    summary="List products",
    description="Public product list with optional filters and full-text search.",
)
async def list_products(
    category: str | None = Query(None, description="Category slug"),
    is_used: bool | None = Query(None, description="Filter by used products"),
    in_stock: bool | None = Query(None, description="Filter by availability"),
    search: str | None = Query(None, min_length=2, description="Full-text search query"),
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> list[ProductRead]:
    version_key = "ver:products:search" if search else "ver:products:list"
    version = await get_version(redis, version_key)
    cache_suffix = f"category={category}|used={is_used}|stock={in_stock}|search={search}"
    cache_key = make_cache_key("products:list", version, cache_suffix)
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    products = await ProductRepository.list_active(db, category, is_used, in_stock, search)
    payload = [ProductRead.model_validate(item).model_dump() for item in products]
    await set_json(redis, cache_key, payload)
    return payload


@router.get(
    "/products/featured",
    response_model=ProductRead | None,
    summary="Get featured product",
)
async def get_featured_product(
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> ProductRead | None:
    version = await get_version(redis, "ver:products:featured")
    cache_key = make_cache_key("products:featured", version, "single")
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    product = await ProductRepository.get_featured(db)
    if not product:
        return None
    payload = ProductRead.model_validate(product).model_dump()
    await set_json(redis, cache_key, payload)
    return payload


@router.get(
    "/products/{product_id}",
    summary="Get product by id",
)
async def get_product_public(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> dict[str, Any]:
    version = await get_version(redis, f"ver:products:detail:{product_id}")
    cache_key = make_cache_key("products:detail", version, str(product_id))
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    product = await ProductRepository.get_by_id(db, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    payload = await _with_variants(product, db)
    await set_json(redis, cache_key, payload)
    return payload


@router.get(
    "/products/slug/{slug}",
    summary="Get product by slug",
)
async def get_product_by_slug(
    slug: str,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> dict[str, Any]:
    version = await get_version(redis, f"ver:products:slug:{slug}")
    cache_key = make_cache_key("products:slug", version, slug)
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    product = await ProductRepository.get_by_slug(db, slug, active_only=True)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    payload = await _with_variants(product, db)
    await set_json(redis, cache_key, payload)
    return payload


@router.get(
    "/admin/products",
    response_model=list[ProductRead],
    summary="List all products (admin)",
)
async def list_all_products(
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> list[ProductRead]:
    version = await get_version(redis, "ver:products:admin:list")
    cache_key = make_cache_key("products:admin:list", version, "all")
    cached = await get_json(redis, cache_key)
    if cached is not None:
        return cached

    products = await ProductRepository.list_all(db)
    payload = [ProductRead.model_validate(item).model_dump() for item in products]
    await set_json(redis, cache_key, payload)
    return payload


@router.post(
    "/admin/products",
    response_model=ProductRead,
    status_code=201,
    summary="Create product (admin)",
)
async def create_product(
    product_data: ProductCreate,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> ProductRead:
    existing = await ProductRepository.get_by_slug(db, product_data.slug, active_only=False)
    if existing:
        raise HTTPException(status_code=400, detail="Product with this slug already exists")

    data = product_data.model_dump()
    if data.get("specs"):
        data["specs"] = [spec if isinstance(spec, dict) else spec.model_dump() for spec in product_data.specs]

    product = await ProductRepository.create(db, data)
    await bump_version(redis, "ver:products:list")
    await bump_version(redis, "ver:products:search")
    await bump_version(redis, "ver:products:admin:list")
    await bump_version(redis, "ver:products:featured")
    logger.info("Product created: %s", product.slug)
    return ProductRead.model_validate(product)


@router.post(
    "/admin/products/{product_id}/set-featured",
    response_model=ProductRead,
    summary="Set featured product (admin)",
)
async def set_featured_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> ProductRead:
    await ProductRepository.unset_featured(db)
    product = await ProductRepository.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    updated = await ProductRepository.update(db, product, {"is_featured": True})
    await bump_version(redis, "ver:products:featured")
    await bump_version(redis, "ver:products:list")
    logger.info("Product featured: %s", updated.slug)
    return ProductRead.model_validate(updated)


@router.get(
    "/admin/products/{product_id}",
    summary="Get product (admin)",
)
async def get_product_admin(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> dict[str, Any]:
    product = await ProductRepository.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return await _with_variants(product, db)


@router.patch(
    "/admin/products/{product_id}",
    response_model=ProductRead,
    summary="Update product (admin)",
)
async def update_product(
    product_id: uuid.UUID,
    product_data: ProductUpdate,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> ProductRead:
    product = await ProductRepository.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = product_data.model_dump(exclude_unset=True)
    if "specs" in update_data and update_data["specs"]:
        update_data["specs"] = [spec if isinstance(spec, dict) else spec for spec in update_data["specs"]]

    updated = await ProductRepository.update(db, product, update_data)
    await bump_version(redis, "ver:products:list")
    await bump_version(redis, "ver:products:search")
    await bump_version(redis, "ver:products:admin:list")
    await bump_version(redis, f"ver:products:detail:{product_id}")
    await bump_version(redis, f"ver:products:slug:{updated.slug}")
    logger.info("Product updated: %s", updated.slug)
    return ProductRead.model_validate(updated)


@router.delete(
    "/admin/products/{product_id}",
    status_code=204,
    summary="Delete product (admin)",
)
async def delete_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    _: dict = admin_required,
) -> Response:
    product = await ProductRepository.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    await ProductRepository.delete(db, product)
    await bump_version(redis, "ver:products:list")
    await bump_version(redis, "ver:products:search")
    await bump_version(redis, "ver:products:admin:list")
    await bump_version(redis, f"ver:products:detail:{product_id}")
    await bump_version(redis, f"ver:products:slug:{product.slug}")
    logger.info("Product deleted: %s", product.slug)
    return Response(status_code=204)
