from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# ── Подключаем все модели, чтобы autogenerate их видел ──────────────────────
from src.app.database.session import Base
from src.app.database.models import (  # noqa: F401
    Category, Product, ProductSpec, ProductImage,
    ProductVariant, WeeklySlide, Order, OrderItem, Admin,
    Brand, TradeInOffer, PageVisit,
)

# ── Alembic Config ───────────────────────────────────────────────────────────
config = context.config

# Логирование из alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """
    Читает DATABASE_URL из переменной окружения или собирает из отдельных переменных.
    Используется asyncpg — нужен postgresql+asyncpg://
    """
    if url := os.getenv("DATABASE_URL"):
        return url

    host     = os.getenv("DB_HOST",     "localhost")
    port     = os.getenv("DB_PORT",     "5432")
    name     = os.getenv("DB_NAME",     "takesmart")
    user     = os.getenv("DB_USER",     "postgres")
    password = os.getenv("DB_PASSWORD", "postgres")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{name}"


# ── Offline mode ─────────────────────────────────────────────────────────────
def run_migrations_offline() -> None:
    """Генерирует SQL без подключения к БД (для review миграций)."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (async) ───────────────────────────────────────────────────────
def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Создаём async-движок и прогоняем миграции."""
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = get_url()

    connectable = async_engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


# ── Точка входа ───────────────────────────────────────────────────────────────
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
