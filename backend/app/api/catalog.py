import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.cache import get_json, invalidate_prefix, set_json
from app.core.deps import require_admin
from app.db.models import Brand, Category, Product, ProductImage, ProductSpec
from app.db.repositories import (
    BrandRepository,
    CategoryRepository,
    ProductRepository,
)
from app.db.session import get_db
from app.schemas.catalog import (
    BrandCreate,
    BrandRead,
    BrandUpdate,
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    ProductCreate,
    ProductRead,
    ProductSearchVector,
    ProductUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["catalog"])


@router.get(
    "/categories",
    response_model=list[CategoryRead],
    summary="Список категорий",
    description="Возвращает список всех категорий.",
)
async def list_categories(
    offset: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)
) -> list[Category] | list[dict]:
    cache_key = f"catalog:categories:{offset}:{limit}"
    cached = await get_json(cache_key)
    if cached is not None:
        return cached
    categories = await CategoryRepository(db).list(offset=offset, limit=limit)
    payload = [CategoryRead.model_validate(c).model_dump() for c in categories]
    await set_json(cache_key, payload)
    return payload


@router.post(
    "/categories",
    response_model=CategoryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать категорию",
    dependencies=[Depends(require_admin)],
)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db)) -> Category:
    repo = CategoryRepository(db)
    if await repo.get_by_slug(payload.slug):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category slug already exists")
    category = await repo.create(payload.model_dump())
    await invalidate_prefix("catalog:categories:")
    return category


@router.get(
    "/categories/{category_id}",
    response_model=CategoryRead,
    summary="Получить категорию",
)
async def get_category(category_id: int, db: AsyncSession = Depends(get_db)) -> Category:
    category = await CategoryRepository(db).get(category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


@router.patch(
    "/categories/{category_id}",
    response_model=CategoryRead,
    summary="Обновить категорию",
    dependencies=[Depends(require_admin)],
)
async def update_category(
    category_id: int, payload: CategoryUpdate, db: AsyncSession = Depends(get_db)
) -> Category:
    repo = CategoryRepository(db)
    category = await repo.get(category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    category = await repo.update(category, payload.model_dump(exclude_unset=True))
    await invalidate_prefix("catalog:categories:")
    return category


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить категорию",
    dependencies=[Depends(require_admin)],
)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)) -> None:
    repo = CategoryRepository(db)
    category = await repo.get(category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    await repo.delete(category)
    await invalidate_prefix("catalog:categories:")
    return None


@router.get(
    "/brands",
    response_model=list[BrandRead],
    summary="Список брендов",
)
async def list_brands(
    offset: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)
) -> list[Brand] | list[dict]:
    cache_key = f"catalog:brands:{offset}:{limit}"
    cached = await get_json(cache_key)
    if cached is not None:
        return cached
    brands = await BrandRepository(db).list(offset=offset, limit=limit)
    payload = [BrandRead.model_validate(b).model_dump() for b in brands]
    await set_json(cache_key, payload)
    return payload


@router.post(
    "/brands",
    response_model=BrandRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать бренд",
    dependencies=[Depends(require_admin)],
)
async def create_brand(payload: BrandCreate, db: AsyncSession = Depends(get_db)) -> Brand:
    repo = BrandRepository(db)
    if await repo.get_by_slug(payload.slug):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Brand slug already exists")
    brand = await repo.create(payload.model_dump())
    await invalidate_prefix("catalog:brands:")
    return brand


@router.get(
    "/brands/{brand_id}",
    response_model=BrandRead,
    summary="Получить бренд",
)
async def get_brand(brand_id: int, db: AsyncSession = Depends(get_db)) -> Brand:
    brand = await BrandRepository(db).get(brand_id)
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    return brand


@router.patch(
    "/brands/{brand_id}",
    response_model=BrandRead,
    summary="Обновить бренд",
    dependencies=[Depends(require_admin)],
)
async def update_brand(brand_id: int, payload: BrandUpdate, db: AsyncSession = Depends(get_db)) -> Brand:
    repo = BrandRepository(db)
    brand = await repo.get(brand_id)
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    brand = await repo.update(brand, payload.model_dump(exclude_unset=True))
    await invalidate_prefix("catalog:brands:")
    return brand


@router.delete(
    "/brands/{brand_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить бренд",
    dependencies=[Depends(require_admin)],
)
async def delete_brand(brand_id: int, db: AsyncSession = Depends(get_db)) -> None:
    repo = BrandRepository(db)
    brand = await repo.get(brand_id)
    if not brand:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found")
    await repo.delete(brand)
    await invalidate_prefix("catalog:brands:")
    return None


@router.get(
    "/products",
    response_model=list[ProductRead],
    summary="Список товаров",
    description="Список активных товаров с фильтрами.",
)
async def list_products(
    offset: int = 0,
    limit: int = 20,
    category_id: int | None = None,
    brand_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Product] | list[dict]:
    cache_key = f"catalog:products:{offset}:{limit}:{category_id}:{brand_id}"
    cached = await get_json(cache_key)
    if cached is not None:
        return cached

    query = (
        select(Product)
        .options(
            joinedload(Product.images),
            joinedload(Product.specs),
            joinedload(Product.brand),
            joinedload(Product.category),
        )
        .where(Product.is_active.is_(True))
    )
    if category_id:
        query = query.where(Product.category_id == category_id)
    if brand_id:
        query = query.where(Product.brand_id == brand_id)

    result = await db.execute(query.offset(offset).limit(limit))
    products = result.scalars().all()

    payload = [ProductRead.model_validate(p).model_dump() for p in products]
    await set_json(cache_key, payload)
    return payload


@router.post(
    "/products/search/vector",
    response_model=list[ProductRead],
    summary="Поиск по вектору",
    description="Ищет товары по вектору названия (pgvector).",
)
async def search_products_vector(
    payload: ProductSearchVector, db: AsyncSession = Depends(get_db)
) -> list[Product]:
    products = await ProductRepository(db).search_by_embedding(payload.vector, limit=payload.limit)
    return products


@router.get(
    "/products/{product_id}",
    response_model=ProductRead,
    summary="Карточка товара",
)
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)) -> Product | dict:
    cache_key = f"catalog:product:{product_id}"
    cached = await get_json(cache_key)
    if cached is not None:
        return cached

    result = await db.execute(
        select(Product)
        .options(joinedload(Product.images), joinedload(Product.specs))
        .where(Product.id == product_id)
    )
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    payload = ProductRead.model_validate(product).model_dump()
    await set_json(cache_key, payload)
    return payload


@router.post(
    "/products",
    response_model=ProductRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать товар",
    dependencies=[Depends(require_admin)],
)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)) -> Product:
    if await ProductRepository(db).get_by_slug(payload.slug):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product slug already exists")
    product = Product(
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        price=payload.price,
        currency=payload.currency,
        stock=payload.stock,
        is_active=payload.is_active,
        brand_id=payload.brand_id,
        category_id=payload.category_id,
        name_embedding=payload.name_embedding,
    )
    product.images = [ProductImage(**image.model_dump()) for image in payload.images]
    product.specs = [ProductSpec(**spec.model_dump()) for spec in payload.specs]
    db.add(product)
    await db.commit()
    await db.refresh(product)
    await invalidate_prefix("catalog:products:")
    await invalidate_prefix("catalog:product:")
    await invalidate_prefix("catalog:search:tsv:")
    return product


@router.patch(
    "/products/{product_id}",
    response_model=ProductRead,
    summary="Обновить товар",
    dependencies=[Depends(require_admin)],
)
async def update_product(
    product_id: int, payload: ProductUpdate, db: AsyncSession = Depends(get_db)
) -> Product:
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    data = payload.model_dump(exclude_unset=True)
    images = data.pop("images", None)
    specs = data.pop("specs", None)

    for field, value in data.items():
        setattr(product, field, value)

    if images is not None:
        product.images = [ProductImage(**image.model_dump()) for image in images]
    if specs is not None:
        product.specs = [ProductSpec(**spec.model_dump()) for spec in specs]

    db.add(product)
    await db.commit()
    await db.refresh(product)
    await invalidate_prefix("catalog:products:")
    await invalidate_prefix("catalog:product:")
    await invalidate_prefix("catalog:search:tsv:")
    return product


@router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить товар",
    dependencies=[Depends(require_admin)],
)
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    await db.delete(product)
    await db.commit()
    await invalidate_prefix("catalog:products:")
    await invalidate_prefix("catalog:product:")
    await invalidate_prefix("catalog:search:tsv:")
    return None


@router.get(
    "/products/search",
    response_model=list[ProductRead],
    summary="Поиск товаров",
    description="Полнотекстовый поиск по названию и описанию.",
)
async def search_products(
    q: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
) -> list[Product] | list[dict]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query is required")
    cache_key = f"catalog:search:tsv:{query}:{limit}"
    cached = await get_json(cache_key)
    if cached is not None:
        return cached
    products = await ProductRepository(db).search_by_tsv(query, limit=limit)
    payload = [ProductRead.model_validate(p).model_dump() for p in products]
    await set_json(cache_key, payload)
    return payload
