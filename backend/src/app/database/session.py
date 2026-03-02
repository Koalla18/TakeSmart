from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.app.core.config import settings

# Асинхронный движок
engine = create_async_engine(
    settings.database_url,
    echo=settings.APP_DEBUG,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,  # проверяет соединение перед использованием
)

# Фабрика сессий
AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    """Базовый класс для всех моделей SQLAlchemy."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency для получения сессии БД в роутерах."""
    async with AsyncSessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
