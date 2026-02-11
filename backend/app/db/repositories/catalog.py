from sqlalchemy import func, select

from app.db.models import Brand, Category, Product, ProductImage, ProductSpec
from app.db.repositories.base import BaseRepository


class CategoryRepository(BaseRepository[Category]):
    model = Category

    async def get_by_slug(self, slug: str) -> Category | None:
        result = await self.session.execute(select(Category).where(Category.slug == slug))
        return result.scalars().first()


class BrandRepository(BaseRepository[Brand]):
    model = Brand

    async def get_by_slug(self, slug: str) -> Brand | None:
        result = await self.session.execute(select(Brand).where(Brand.slug == slug))
        return result.scalars().first()


class ProductRepository(BaseRepository[Product]):
    model = Product

    async def get_by_slug(self, slug: str) -> Product | None:
        result = await self.session.execute(select(Product).where(Product.slug == slug))
        return result.scalars().first()

    async def list_active(self, offset: int = 0, limit: int = 100) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(Product.is_active.is_(True)).offset(offset).limit(limit)
        )
        return result.scalars().all()

    async def list_by_category(self, category_id: int, offset: int = 0, limit: int = 100) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(Product.category_id == category_id).offset(offset).limit(limit)
        )
        return result.scalars().all()

    async def list_by_brand(self, brand_id: int, offset: int = 0, limit: int = 100) -> list[Product]:
        result = await self.session.execute(
            select(Product).where(Product.brand_id == brand_id).offset(offset).limit(limit)
        )
        return result.scalars().all()

    async def search_by_embedding(self, vector: list[float], limit: int = 20) -> list[Product]:
        result = await self.session.execute(
            select(Product).order_by(Product.name_embedding.cosine_distance(vector)).limit(limit)
        )
        return result.scalars().all()

    async def search_by_name(self, query: str, limit: int = 20) -> list[Product]:
        pattern = f"%{query.lower()}%"
        result = await self.session.execute(
            select(Product).where(func.lower(Product.name).like(pattern)).limit(limit)
        )
        return result.scalars().all()

    async def search_by_tsv(self, query: str, limit: int = 20) -> list[Product]:
        ts_query = func.plainto_tsquery("russian", query)
        rank = func.ts_rank_cd(Product.tsv, ts_query)
        result = await self.session.execute(
            select(Product)
            .where(Product.tsv.op("@@")(ts_query))
            .order_by(rank.desc())
            .limit(limit)
        )
        return result.scalars().all()


class ProductImageRepository(BaseRepository[ProductImage]):
    model = ProductImage

    async def list_by_product(self, product_id: int) -> list[ProductImage]:
        result = await self.session.execute(
            select(ProductImage).where(ProductImage.product_id == product_id)
        )
        return result.scalars().all()


class ProductSpecRepository(BaseRepository[ProductSpec]):
    model = ProductSpec

    async def list_by_product(self, product_id: int) -> list[ProductSpec]:
        result = await self.session.execute(
            select(ProductSpec).where(ProductSpec.product_id == product_id)
        )
        return result.scalars().all()
