"""Repository для работы с моделью MediaFile."""
from __future__ import annotations

import uuid

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.media import MediaFile


class MediaRepository:
    @staticmethod
    async def create(session: AsyncSession, data: dict) -> MediaFile:
        media = MediaFile(**data)
        session.add(media)
        await session.commit()
        await session.refresh(media)
        return media

    @staticmethod
    async def get_by_id(session: AsyncSession, media_id: uuid.UUID) -> MediaFile | None:
        result = await session.execute(select(MediaFile).where(MediaFile.id == media_id))
        return result.scalars().first()

    @staticmethod
    async def list_for_entity(
        session: AsyncSession,
        entity_type: str,
        entity_id: uuid.UUID,
    ) -> list[MediaFile]:
        result = await session.execute(
            select(MediaFile)
            .where(MediaFile.entity_type == entity_type, MediaFile.entity_id == entity_id)
            .order_by(MediaFile.is_primary.desc(), MediaFile.sort_order, MediaFile.created_at)
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_primary(
        session: AsyncSession,
        entity_type: str,
        entity_id: uuid.UUID,
    ) -> MediaFile | None:
        result = await session.execute(
            select(MediaFile).where(
                MediaFile.entity_type == entity_type,
                MediaFile.entity_id == entity_id,
                MediaFile.is_primary.is_(True),
            )
        )
        return result.scalars().first()

    @staticmethod
    async def set_primary(
        session: AsyncSession,
        entity_type: str,
        entity_id: uuid.UUID,
        media_id: uuid.UUID,
    ) -> None:
        """Сбрасывает is_primary у всех файлов сущности и устанавливает для media_id."""
        from sqlalchemy import update
        await session.execute(
            update(MediaFile)
            .where(MediaFile.entity_type == entity_type, MediaFile.entity_id == entity_id)
            .values(is_primary=False)
        )
        await session.execute(
            update(MediaFile)
            .where(MediaFile.id == media_id)
            .values(is_primary=True)
        )
        await session.commit()

    @staticmethod
    async def delete(session: AsyncSession, media: MediaFile) -> None:
        await session.delete(media)
        await session.commit()

    @staticmethod
    async def delete_all_for_entity(
        session: AsyncSession,
        entity_type: str,
        entity_id: uuid.UUID,
    ) -> list[str]:
        """Удаляет все записи сущности, возвращает список URL для удаления файлов."""
        result = await session.execute(
            select(MediaFile).where(
                MediaFile.entity_type == entity_type,
                MediaFile.entity_id == entity_id,
            )
        )
        files = list(result.scalars().all())
        urls = [f.url for f in files]
        # Собираем и thumbnail_url
        for f in files:
            if f.thumbnail_url:
                urls.append(f.thumbnail_url)

        await session.execute(
            delete(MediaFile).where(
                MediaFile.entity_type == entity_type,
                MediaFile.entity_id == entity_id,
            )
        )
        await session.commit()
        return urls

    @staticmethod
    async def update_sort_order(
        session: AsyncSession,
        media_id: uuid.UUID,
        sort_order: int,
    ) -> MediaFile | None:
        from sqlalchemy import update
        await session.execute(
            update(MediaFile).where(MediaFile.id == media_id).values(sort_order=sort_order)
        )
        await session.commit()
        return await MediaRepository.get_by_id(session, media_id)

