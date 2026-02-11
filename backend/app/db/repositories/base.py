import logging
from typing import Any, Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ModelType = TypeVar("ModelType")


class BaseRepository(Generic[ModelType]):
    model: type[ModelType]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.logger = logging.getLogger(self.__class__.__name__)

    async def get(self, obj_id: int) -> ModelType | None:
        self.logger.info("get %s id=%s", self.model.__name__, obj_id)
        return await self.session.get(self.model, obj_id)

    async def list(self, offset: int = 0, limit: int = 100) -> list[ModelType]:
        self.logger.info("list %s offset=%s limit=%s", self.model.__name__, offset, limit)
        result = await self.session.execute(select(self.model).offset(offset).limit(limit))
        return result.scalars().all()

    async def create(self, obj_in: dict[str, Any]) -> ModelType:
        self.logger.info("create %s", self.model.__name__)
        obj = self.model(**obj_in)
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def update(self, db_obj: ModelType, obj_in: dict[str, Any]) -> ModelType:
        self.logger.info("update %s", self.model.__name__)
        for field, value in obj_in.items():
            if hasattr(db_obj, field):
                setattr(db_obj, field, value)
        self.session.add(db_obj)
        await self.session.commit()
        await self.session.refresh(db_obj)
        return db_obj

    async def delete(self, db_obj: ModelType) -> None:
        self.logger.info("delete %s", self.model.__name__)
        await self.session.delete(db_obj)
        await self.session.commit()
