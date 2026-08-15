from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.slugify import build_unique_slug
from src.app.core.static_service import static_service
from src.app.database.models.brand import Brand
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.brand import BrandCreate, BrandOut, BrandUpdate

logger = get_logger(__name__)
router = APIRouter(prefix="/brands", tags=["Brands"])


def _to_out(brand: Brand, products_count: int = 0) -> BrandOut:
    """ORM-бренд → BrandOut с подмешанным счётчиком товаров."""
    return BrandOut.model_validate(brand).model_copy(update={"products_count": products_count})


def _rewrite_quick_filters(quick_filters: object, old_lower: str, new_lower: str) -> list | None:
    """Заменяет brand в элементах quick_filters категории (Python-сторона, без jsonb_set).

    Возвращает новый список, если была хотя бы одна замена, иначе None.
    """
    if not isinstance(quick_filters, list):
        return None
    changed = False
    rewritten = []
    for item in quick_filters:
        if isinstance(item, dict) and (item.get("brand") or "").lower() == old_lower and item.get("brand") != new_lower:
            item = {**item, "brand": new_lower}
            changed = True
        rewritten.append(item)
    return rewritten if changed else None


@router.get("", response_model=list[BrandOut], summary="Активные бренды")
async def list_brands(limit: int = Query(100, ge=1, le=500)) -> list[BrandOut]:
    async with UnitOfWork() as uow:
        rows = await uow.brands.get_active_with_counts(limit=limit)
    return [_to_out(brand, count) for brand, count in rows]


@router.get("/all", response_model=list[BrandOut], dependencies=[Depends(get_current_admin)])
async def list_all_brands(limit: int = Query(500, ge=1, le=500)) -> list[BrandOut]:
    async with UnitOfWork() as uow:
        rows = await uow.brands.get_all_with_counts(limit=limit)
    return [_to_out(brand, count) for brand, count in rows]


@router.post("", response_model=BrandOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(get_current_admin)])
async def create_brand(body: BrandCreate) -> BrandOut:
    async with UnitOfWork() as uow:
        if await uow.brands.get_by_name(body.name):
            raise HTTPException(status_code=409, detail=f"Бренд «{body.name}» уже существует")
        slug = await build_unique_slug(body.name, uow.brands.slug_exists)
        brand = await uow.brands.create(**body.model_dump(), slug=slug)
        # Товары могли ссылаться на бренд текстом ещё до появления записи в справочнике
        products_count = await uow.products.count_by_brand_name(brand.name)
        await uow.commit()
    logger.info("brand_created", brand_id=str(brand.id), name=brand.name)
    return _to_out(brand, products_count)


@router.patch("/{brand_id}", response_model=BrandOut, dependencies=[Depends(get_current_admin)])
async def update_brand(brand_id: UUID, body: BrandUpdate) -> BrandOut:
    async with UnitOfWork() as uow:
        brand = await uow.brands.get_by_id(brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail=f"Бренд {brand_id} не найден")

        old_name = brand.name
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

        # Каскад переименования: бренд в товарах — голая строка (FK нет),
        # плюс lowercase-имя живёт в quick_filters категорий. Всё — в одной транзакции.
        products_updated = 0
        categories_updated = 0
        new_name = data.get("name")
        if new_name and new_name != old_name:
            products_updated = await uow.products.rename_brand(old_name, new_name)
            old_lower, new_lower = old_name.lower(), new_name.lower()
            if old_lower != new_lower:
                for category in await uow.categories.get_all(limit=500):
                    rewritten = _rewrite_quick_filters(category.quick_filters, old_lower, new_lower)
                    if rewritten is not None:
                        category.quick_filters = rewritten
                        categories_updated += 1

        updated = await uow.brands.update(brand_id, **data)
        products_count = await uow.products.count_by_brand_name(updated.name)
        await uow.commit()

    if new_name and new_name != old_name:
        logger.info(
            "brand_renamed_cascade",
            brand_id=str(brand_id),
            old_name=old_name,
            new_name=new_name,
            products_updated=products_updated,
            categories_updated=categories_updated,
        )
    logger.info("brand_updated", brand_id=str(brand_id))
    return _to_out(updated, products_count)


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, dependencies=[Depends(get_current_admin)])
async def delete_brand(
    brand_id: UUID,
    force: bool = Query(False, description="Удалить, даже если бренд используется в товарах"),
) -> None:
    async with UnitOfWork() as uow:
        brand = await uow.brands.get_by_id(brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail=f"Бренд {brand_id} не найден")

        products_count = await uow.products.count_by_brand_name(brand.name)
        if products_count and not force:
            raise HTTPException(
                status_code=409,
                detail=f"Бренд используется в {products_count} товарах. Товары сохранят название бренда текстом.",
            )

        await uow.brands.delete(brand_id)
        await uow.commit()
    logger.info("brand_deleted", brand_id=str(brand_id), products_count=products_count, force=force)


@router.post(
    "/{brand_id}/logo",
    response_model=BrandOut,
    summary="Загрузить логотип бренда",
    responses={404: {"description": "Бренд не найден"}},
    dependencies=[Depends(get_current_admin)],
)
async def upload_brand_logo(
    brand_id: UUID,
    file: UploadFile = File(..., description="Логотип бренда (JPEG / PNG / WebP, макс. 5 МБ)"),
) -> BrandOut:
    async with UnitOfWork() as uow:
        brand = await uow.brands.get_by_id(brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail=f"Бренд {brand_id} не найден")

        relative_path, _ = await static_service.save_brand_image(file, brand_id)
        logo_url = static_service.build_url(relative_path)
        updated = await uow.brands.update(brand_id, logo_url=logo_url)
        products_count = await uow.products.count_by_brand_name(updated.name)
        await uow.commit()

    logger.info("brand_logo_uploaded", brand_id=str(brand_id), url=logo_url)
    return _to_out(updated, products_count)
