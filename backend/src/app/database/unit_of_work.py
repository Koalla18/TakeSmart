from __future__ import annotations

from types import TracebackType
from typing import Self

from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.session import AsyncSessionFactory
from src.app.database.repositories.category_repository import CategoryRepository
from src.app.database.repositories.product_repository import ProductRepository
from src.app.database.repositories.product_image_repository import ProductImageRepository
from src.app.database.repositories.product_spec_repository import ProductSpecRepository
from src.app.database.repositories.product_variant_repository import ProductVariantRepository
from src.app.database.repositories.product_group_repository import ProductGroupRepository
from src.app.database.repositories.weekly_slide_repository import WeeklySlideRepository
from src.app.database.repositories.hero_banner_repository import HeroBannerRepository
from src.app.database.repositories.order_repository import OrderRepository, OrderItemRepository
from src.app.database.repositories.brand_repository import BrandRepository
from src.app.database.repositories.trade_in_offer_repository import TradeInOfferRepository


class UnitOfWork:
    """
    Unit of Work — контекстный менеджер, который объединяет все репозитории
    в рамках одной транзакции БД.

    Использование:
        async with UnitOfWork() as uow:
            category = await uow.categories.get_by_slug("smartphones")
            product = await uow.products.create(name="iPhone 16", ...)
            await uow.commit()
    """

    def __init__(self) -> None:
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> Self:
        self._session = AsyncSessionFactory()
        self._init_repositories()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            await self.rollback()
        await self._session.close()

    def _init_repositories(self) -> None:
        """Инициализирует все репозитории с текущей сессией."""
        self.categories = CategoryRepository(self._session)
        self.products = ProductRepository(self._session)
        self.product_images = ProductImageRepository(self._session)
        self.product_specs = ProductSpecRepository(self._session)
        self.product_variants = ProductVariantRepository(self._session)
        self.product_groups = ProductGroupRepository(self._session)
        self.weekly_slides = WeeklySlideRepository(self._session)
        self.hero_banners = HeroBannerRepository(self._session)
        self.orders = OrderRepository(self._session)
        self.order_items = OrderItemRepository(self._session)
        self.brands = BrandRepository(self._session)
        self.trade_in_offers = TradeInOfferRepository(self._session)

    async def commit(self) -> None:
        """Зафиксировать все изменения транзакции."""
        await self._session.commit()

    async def rollback(self) -> None:
        """Откатить все изменения текущей транзакции."""
        await self._session.rollback()

    async def flush(self) -> None:
        """Отправить изменения в БД без commit (полезно для получения авто-id)."""
        await self._session.flush()
