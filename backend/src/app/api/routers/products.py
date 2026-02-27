from __future__ import annotations

import json
from collections import defaultdict
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.app.api.admin.endpoints import oauth2_scheme
from src.app.core.logger import get_logger
from src.app.core.slugify import build_unique_slug
from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.common import PaginatedResponse
from src.app.schemas.product import (
    ProductCreate,
    ProductDetailOut,
    ProductOut,
    ProductUpdate,
)
from src.app.schemas.product_image import ProductImageOut
from src.app.schemas.product_spec import ProductSpecGroupOut, ProductSpecIn, ProductSpecOut
from src.app.schemas.product_variant import (
    ProductVariantCreate,
    ProductVariantOut,
    ProductVariantUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/products", tags=["Products"])


def _group_specs(specs: list) -> list[ProductSpecGroupOut]:
    """Группирует список спецификаций по group_name для отображения на фронте."""
    groups: dict[str, list[ProductSpecOut]] = defaultdict(list)
    for spec in specs:
        groups[spec.group_name].append(ProductSpecOut.model_validate(spec))
    return [
        ProductSpecGroupOut(group_name=group, specs=items)
        for group, items in groups.items()
    ]


def _build_detail(product, images, specs) -> ProductDetailOut:
    """Собирает ProductDetailOut из ORM-объектов."""
    return ProductDetailOut(
        **ProductOut.model_validate(product).model_dump(),
        images=[
            ProductImageOut(
                **{k: v for k, v in vars(img).items() if not k.startswith("_")},
                url=static_service.build_url(img.file_path),
            )
            for img in images
        ],
        specs_grouped=_group_specs(specs),
    )


# ─────────────────────────────────────────────────────────────────── #
#  Список и поиск                                                      #
# ─────────────────────────────────────────────────────────────────── #

@router.get(
    "",
    response_model=PaginatedResponse[ProductOut],
    summary="Список товаров",
    description=(
        "Поддерживает фильтрацию по категории, бренду, цене, поиск по названию "
        "и фильтрацию по произвольным атрибутам через параметр `attrs`.\n\n"
        "**Фильтр по атрибутам** (`attrs`) — JSON-строка с парами ключ-значение. "
        "Пример: `?attrs={\"ram_gb\":12,\"5g\":true}` вернёт только товары, "
        "у которых в JSONB-поле `attributes` есть оба этих значения."
    ),
)
async def list_products(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=1000),
    only_active: bool = Query(True),
    category_id: UUID | None = Query(None, description="Фильтр по категории"),
    brand: str | None = Query(None, description="Фильтр по бренду"),
    search: str | None = Query(None, min_length=2, description="Поиск по названию (ILIKE)"),
    min_price: Decimal | None = Query(None, gt=0, description="Минимальная цена"),
    max_price: Decimal | None = Query(None, gt=0, description="Максимальная цена"),
    attrs: str | None = Query(
        None,
        description=(
            'Фильтр по произвольным атрибутам товара. '
            'Передаётся как JSON-строка. '
            'Пример: `{"ram_gb": 12, "5g": true}`'
        ),
    ),
) -> PaginatedResponse[ProductOut]:
    # Валидация диапазона цен
    if min_price and max_price and min_price > max_price:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min_price не может быть больше max_price",
        )

    # Парсим attrs из JSON-строки
    attrs_dict: dict[str, Any] | None = None
    if attrs:
        try:
            attrs_dict = json.loads(attrs)
            if not isinstance(attrs_dict, dict):
                raise ValueError("attrs должен быть JSON-объектом")
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Некорректный параметр attrs: {e}",
            )

    async with UnitOfWork() as uow:
        if attrs_dict:
            items = await uow.products.filter_by_attributes(
                attrs_dict, offset=offset, limit=limit
            )
            total = len(items)
        elif search:
            items = await uow.products.search_by_name(search, offset=offset, limit=limit)
            total = len(items)
        elif category_id:
            items = await uow.products.get_by_category(
                category_id, offset=offset, limit=limit, only_active=only_active
            )
            total = len(items)
        elif brand:
            items = await uow.products.get_by_brand(brand, offset=offset, limit=limit)
            total = len(items)
        elif min_price or max_price:
            items = await uow.products.filter_by_price(
                min_price=min_price, max_price=max_price, offset=offset, limit=limit
            )
            total = len(items)
        elif only_active:
            items = await uow.products.get_active(offset=offset, limit=limit)
            total = await uow.products.count()
        else:
            items = await uow.products.get_all(offset=offset, limit=limit)
            total = await uow.products.count()

    logger.info("products_listed", count=len(items), offset=offset, limit=limit)
    return PaginatedResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_next=(offset + limit) < total,
    )


@router.get(
    "/featured",
    response_model=list[ProductOut],
    summary="Товары на витрине (is_featured=True)",
)
async def list_featured_products(
    limit: int = Query(20, ge=1, le=100),
) -> list[ProductOut]:
    async with UnitOfWork() as uow:
        items = await uow.products.get_featured(limit=limit)
    logger.info("featured_products_listed", count=len(items))
    return items


@router.get(
    "/{product_id}",
    response_model=ProductDetailOut,
    summary="Получить товар по ID",
    description="Возвращает товар вместе с изображениями и спецификациями, сгруппированными по группам.",
    responses={404: {"description": "Товар не найден"}},
)
async def get_product(product_id: UUID) -> ProductDetailOut:
    async with UnitOfWork() as uow:
        product = await uow.products.get_with_specs(product_id)
        if not product:
            logger.warning("product_not_found", product_id=str(product_id))
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        return _build_detail(product, product.images, product.specs)


@router.get(
    "/slug/{slug}",
    response_model=ProductDetailOut,
    summary="Получить товар по slug",
    description="Возвращает товар вместе с изображениями и спецификациями, сгруппированными по группам.",
    responses={404: {"description": "Товар не найден"}},
)
async def get_product_by_slug(slug: str) -> ProductDetailOut:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_slug_with_specs(slug)
        if not product:
            logger.warning("product_not_found_by_slug", slug=slug)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар со slug='{slug}' не найден",
            )
        return _build_detail(product, product.images, product.specs)


# ─────────────────────────────────────────────────────────────────── #
#  CRUD товара                                                         #
# ─────────────────────────────────────────────────────────────────── #

@router.post(
    "",
    response_model=ProductDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать товар",
    description=(
        "Создаёт товар. В теле запроса можно передать:\n\n"
        "- `attributes` — произвольный JSON с характеристиками (для фильтров и поиска)\n"
        "- `specs` — список структурированных характеристик с группами (для таблицы на странице товара)\n\n"
        "Оба поля опциональны и независимы — можно использовать одно, другое или оба."
    ),
    responses={
        409: {"description": "Товар с таким SKU уже существует"},
        422: {"description": "Ошибка валидации полей"},
    },
    dependencies=[Depends(oauth2_scheme)],
)
async def create_product(body: ProductCreate) -> ProductDetailOut:
    async with UnitOfWork() as uow:
        # Проверяем уникальность SKU
        if body.sku and await uow.products.get_by_sku(body.sku):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Товар с SKU='{body.sku}' уже существует",
            )

        # Проверяем категорию
        if body.category_id:
            category = await uow.categories.get_by_id(body.category_id)
            if not category:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Категория с id={body.category_id} не найдена",
                )
            if not category.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Нельзя привязать товар к неактивной категории",
                )

        # Автогенерация уникального slug из name
        slug = await build_unique_slug(body.name, uow.products.slug_exists)

        # Создаём товар (без поля specs — оно идёт отдельно)
        product_data = body.model_dump(exclude={"specs"})
        product = await uow.products.create(slug=slug, **product_data)

        # Создаём спецификации если переданы
        specs = []
        if body.specs:
            specs = await uow.product_specs.bulk_create(
                product.id,
                [s.model_dump() for s in body.specs],
            )
            logger.debug(
                "product_specs_created",
                product_id=str(product.id),
                specs_count=len(specs),
            )

        await uow.commit()

        # Перезагружаем со всеми связями
        product = await uow.products.get_with_specs(product.id)

    logger.info(
        "product_created",
        product_id=str(product.id),
        slug=product.slug,
        attrs_keys=list(product.attributes.keys()) if product.attributes else [],
        specs_count=len(product.specs),
    )
    return _build_detail(product, product.images, product.specs)


@router.patch(
    "/{product_id}",
    response_model=ProductDetailOut,
    summary="Обновить товар",
    description=(
        "Обновляет товар (PATCH-семантика — передавать только изменяемые поля).\n\n"
        "- `attributes` — полная замена JSONB-атрибутов. Передай `null` чтобы очистить.\n"
        "- `specs` — полная замена всех спецификаций. Передай `[]` чтобы удалить все."
    ),
    responses={
        404: {"description": "Товар не найден"},
        409: {"description": "SKU уже занят"},
        422: {"description": "Ошибка валидации"},
    },
    dependencies=[Depends(oauth2_scheme)],
)
async def update_product(product_id: UUID, body: ProductUpdate) -> ProductDetailOut:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )

        # Проверяем уникальность SKU
        if body.sku:
            existing = await uow.products.get_by_sku(body.sku)
            if existing and existing.id != product_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Товар с SKU='{body.sku}' уже существует",
                )

        # Проверяем категорию
        if body.category_id:
            category = await uow.categories.get_by_id(body.category_id)
            if not category:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Категория с id={body.category_id} не найдена",
                )
            if not category.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Нельзя привязать товар к неактивной категории",
                )

        # Проверяем discount_price относительно текущей (или новой) цены
        effective_price = body.price or product.price
        if body.discount_price and body.discount_price >= effective_price:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Цена со скидкой должна быть меньше основной цены",
            )

        update_data = body.model_dump(exclude_none=True, exclude={"specs"})

        # Если меняется name — пересчитываем slug автоматически
        if body.name:
            update_data["slug"] = await build_unique_slug(
                body.name,
                uow.products.slug_exists,
                exclude_id=product_id,
            )

        await uow.products.update(product_id, **update_data)

        # Обновляем спецификации если переданы (полная замена)
        if body.specs is not None:
            await uow.product_specs.replace_all(
                product_id,
                [s.model_dump() for s in body.specs],
            )
            logger.debug(
                "product_specs_replaced",
                product_id=str(product_id),
                specs_count=len(body.specs),
            )

        await uow.commit()
        product = await uow.products.get_with_specs(product_id)

    logger.info("product_updated", product_id=str(product_id), slug=product.slug)
    return _build_detail(product, product.images, product.specs)


@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить товар",
    responses={
        404: {"description": "Товар не найден"},
    },
)
async def delete_product(product_id: UUID) -> None:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )

        images = await uow.product_images.get_by_product(product_id)
        if images:
            for image in images:
                await static_service.delete_file(image.file_path)

        await uow.products.delete(product_id)
        await uow.commit()

    logger.info("product_deleted", product_id=str(product_id))


# ─────────────────────────────────────────────────────────────────── #
#  Спецификации товара                                                 #
# ─────────────────────────────────────────────────────────────────── #

@router.get(
    "/{product_id}/specs",
    response_model=list[ProductSpecGroupOut],
    summary="Спецификации товара (сгруппированные)",
    description="Возвращает все характеристики товара, сгруппированные по group_name.",
    responses={404: {"description": "Товар не найден"}},
)
async def get_product_specs(product_id: UUID) -> list[ProductSpecGroupOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        specs = await uow.product_specs.get_by_product(product_id)
    return _group_specs(specs)


@router.put(
    "/{product_id}/specs",
    response_model=list[ProductSpecGroupOut],
    summary="Заменить все спецификации товара",
    description=(
        "Полностью заменяет спецификации товара. "
        "Все старые характеристики удаляются, создаются новые. "
        "Передай пустой массив `[]` чтобы удалить все спецификации."
    ),
    responses={404: {"description": "Товар не найден"}},
    dependencies=[Depends(oauth2_scheme)],
)
async def replace_product_specs(
    product_id: UUID,
    specs: list[ProductSpecIn],
) -> list[ProductSpecGroupOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        new_specs = await uow.product_specs.replace_all(
            product_id,
            [s.model_dump() for s in specs],
        )
        await uow.commit()

    logger.info(
        "product_specs_replaced",
        product_id=str(product_id),
        specs_count=len(new_specs),
    )
    return _group_specs(new_specs)


@router.post(
    "/{product_id}/specs",
    response_model=list[ProductSpecGroupOut],
    status_code=status.HTTP_201_CREATED,
    summary="Добавить характеристики к товару",
    description="Добавляет новые характеристики не удаляя существующие.",
    responses={404: {"description": "Товар не найден"}},
    dependencies=[Depends(oauth2_scheme)],
)
async def add_product_specs(
    product_id: UUID,
    specs: list[ProductSpecIn],
) -> list[ProductSpecGroupOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        await uow.product_specs.bulk_create(
            product_id,
            [s.model_dump() for s in specs],
        )
        await uow.commit()
        all_specs = await uow.product_specs.get_by_product(product_id)

    logger.info(
        "product_specs_added",
        product_id=str(product_id),
        added_count=len(specs),
    )
    return _group_specs(all_specs)


@router.delete(
    "/{product_id}/specs",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить все спецификации товара",
    responses={404: {"description": "Товар не найден"}},
    dependencies=[Depends(oauth2_scheme)],
)
async def delete_product_specs(product_id: UUID) -> None:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        await uow.product_specs.delete_by_product(product_id)
        await uow.commit()
    logger.info("product_specs_deleted", product_id=str(product_id))


# ─────────────────────────────────────────────────────────────────── #
#  Варианты товара                                                     #
# ─────────────────────────────────────────────────────────────────── #

@router.get(
    "/{product_id}/variants",
    response_model=list[ProductVariantOut],
    summary="Варианты товара (цвет, объём памяти и т.д.)",
    responses={404: {"description": "Товар не найден"}},
)
async def list_product_variants(
    product_id: UUID,
    only_active: bool = Query(True),
) -> list[ProductVariantOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        variants = await uow.product_variants.get_by_product(
            product_id, only_active=only_active
        )
    return list(variants)


@router.post(
    "/{product_id}/variants",
    response_model=ProductVariantOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить вариант товара",
    responses={404: {"description": "Товар не найден"}},
)
async def create_product_variant(
    product_id: UUID,
    body: ProductVariantCreate,
    _token: str = Depends(oauth2_scheme),
) -> ProductVariantOut:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с id={product_id} не найден",
            )
        if body.sku:
            existing = await uow.product_variants.get_by_sku(body.sku)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Вариант с SKU='{body.sku}' уже существует",
                )
        variant = await uow.product_variants.create(
            product_id=product_id, **body.model_dump()
        )
        await uow.commit()
        await uow.product_variants.session.refresh(variant)
    logger.info("variant_created", product_id=str(product_id), variant_id=str(variant.id))
    return variant


@router.patch(
    "/{product_id}/variants/{variant_id}",
    response_model=ProductVariantOut,
    summary="Обновить вариант товара",
    responses={404: {"description": "Вариант не найден"}},
)
async def update_product_variant(
    product_id: UUID,
    variant_id: UUID,
    body: ProductVariantUpdate,
    _token: str = Depends(oauth2_scheme),
) -> ProductVariantOut:
    async with UnitOfWork() as uow:
        variant = await uow.product_variants.get_by_id(variant_id)
        if not variant or variant.product_id != product_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Вариант с id={variant_id} не найден",
            )
        data = body.model_dump(exclude_unset=True)
        for field, value in data.items():
            setattr(variant, field, value)
        await uow.commit()
        await uow.product_variants.session.refresh(variant)
    logger.info("variant_updated", variant_id=str(variant_id))
    return variant


@router.delete(
    "/{product_id}/variants/{variant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить вариант товара",
    responses={404: {"description": "Вариант не найден"}},
)
async def delete_product_variant(
    product_id: UUID,
    variant_id: UUID,
    _token: str = Depends(oauth2_scheme),
) -> None:
    async with UnitOfWork() as uow:
        variant = await uow.product_variants.get_by_id(variant_id)
        if not variant or variant.product_id != product_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Вариант с id={variant_id} не найден",
            )
        await uow.product_variants.session.delete(variant)
        await uow.commit()
    logger.info("variant_deleted", variant_id=str(variant_id))

