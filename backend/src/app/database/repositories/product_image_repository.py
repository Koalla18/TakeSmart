from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.models.product_image import ProductImage
from src.app.database.repositories.base import BaseRepository


class ProductImageRepository(BaseRepository[ProductImage]):

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ProductImage, session)

    async def get_by_product(self, product_id: UUID) -> Sequence[ProductImage]:
        """Получить все изображения товара, отсортированные по sort_order."""
        result = await self.session.execute(
            select(ProductImage)
            .where(ProductImage.product_id == product_id)
            .order_by(ProductImage.sort_order)
        )
        return result.scalars().all()

    async def get_main_image(self, product_id: UUID) -> ProductImage | None:
        """Получить главное изображение товара."""
        result = await self.session.execute(
            select(ProductImage)
            .where(
                ProductImage.product_id == product_id,
                ProductImage.is_main.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def set_main(self, product_id: UUID, image_id: UUID, variant_color: str | None = None) -> None:
        """
        Сбросить флаг is_main у изображений того же цвета (или общих),
        затем выставить is_main=True у указанного.
        Scope: variant_color — сбрасывает is_main только среди фото с тем же variant_color.
        """
        # Сбрасываем is_main только среди фото с тем же variant_color
        if variant_color is not None:
            await self.session.execute(
                update(ProductImage)
                .where(
                    ProductImage.product_id == product_id,
                    ProductImage.variant_color == variant_color,
                )
                .values(is_main=False)
            )
        else:
            await self.session.execute(
                update(ProductImage)
                .where(
                    ProductImage.product_id == product_id,
                    ProductImage.variant_color.is_(None),
                )
                .values(is_main=False)
            )
        # Ставим нужное
        await self.session.execute(
            update(ProductImage)
            .where(
                ProductImage.id == image_id,
                ProductImage.product_id == product_id,
            )
            .values(is_main=True)
        )

    async def count_by_color(self, product_id: UUID, variant_color: str) -> int:
        """Количество изображений для конкретного цвета."""
        result = await self.session.execute(
            select(ProductImage)
            .where(
                ProductImage.product_id == product_id,
                ProductImage.variant_color == variant_color,
            )
        )
        return len(result.scalars().all())

    async def reorder(self, product_id: UUID, ordered_ids: list[UUID]) -> None:
        """
        Переставить порядок изображений.
        ordered_ids — список UUID в нужном порядке (индекс = sort_order).
        """
        for sort_order, image_id in enumerate(ordered_ids):
            await self.session.execute(
                update(ProductImage)
                .where(
                    ProductImage.id == image_id,
                    ProductImage.product_id == product_id,
                )
                .values(sort_order=sort_order)
            )

    async def delete_by_product(self, product_id: UUID) -> int:
        """Удалить все изображения товара. Возвращает количество удалённых."""
        images = await self.get_by_product(product_id)
        count = len(images)
        for image in images:
            await self.session.delete(image)
        return count

    async def count_by_product(self, product_id: UUID) -> int:
        """Количество изображений у товара."""
        images = await self.get_by_product(product_id)
        return len(images)
