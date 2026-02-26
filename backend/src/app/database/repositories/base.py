from __future__ import annotations

from typing import Any, Generic, Protocol, Sequence, TypeVar, runtime_checkable
from uuid import UUID

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.session import Base


@runtime_checkable
class HasId(Protocol):
    id: Any


ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """
    Базовый репозиторий с универсальными CRUD-операциями.
    Все конкретные репозитории наследуются от него.
    """

    def __init__(self, model: type[ModelType], session: AsyncSession) -> None:
        self.model = model
        self.session = session

    # ------------------------------------------------------------------ #
    #  CREATE                                                              #
    # ------------------------------------------------------------------ #

    async def create(self, **kwargs: Any) -> ModelType:
        """Создать и вернуть новый объект (без commit)."""
        instance = self.model(**kwargs)
        self.session.add(instance)
        await self.session.flush()
        await self.session.refresh(instance)
        return instance

    # ------------------------------------------------------------------ #
    #  READ                                                                #
    # ------------------------------------------------------------------ #

    async def get_by_id(self, obj_id: UUID) -> ModelType | None:
        """Получить объект по UUID."""
        pk_col = self.model.__table__.c["id"]  # type: ignore[attr-defined]
        result = await self.session.execute(
            select(self.model).where(pk_col == obj_id)  # type: ignore[arg-type]
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> Sequence[ModelType]:
        """Получить список объектов с пагинацией."""
        result = await self.session.execute(
            select(self.model).offset(offset).limit(limit)
        )
        return result.scalars().all()

    async def count(self) -> int:
        """Общее количество объектов в таблице."""
        result = await self.session.execute(
            select(func.count()).select_from(self.model)
        )
        return result.scalar_one()

    # ------------------------------------------------------------------ #
    #  UPDATE                                                              #
    # ------------------------------------------------------------------ #

    async def update(self, obj_id: UUID, **kwargs: Any) -> ModelType | None:
        """Обновить поля объекта по UUID и вернуть обновлённый объект."""
        pk_col = self.model.__table__.c["id"]  # type: ignore[attr-defined]
        await self.session.execute(
            update(self.model)
            .where(pk_col == obj_id)  # type: ignore[arg-type]
            .values(**kwargs)
            .execution_options(synchronize_session="fetch")
        )
        return await self.get_by_id(obj_id)

    # ------------------------------------------------------------------ #
    #  DELETE                                                              #
    # ------------------------------------------------------------------ #

    async def delete(self, obj_id: UUID) -> bool:
        """Удалить объект по UUID. Возвращает True если объект был удалён."""
        pk_col = self.model.__table__.c["id"]  # type: ignore[attr-defined]
        result = await self.session.execute(
            delete(self.model).where(pk_col == obj_id)  # type: ignore[arg-type]
        )
        return result.rowcount > 0  # type: ignore[union-attr]
