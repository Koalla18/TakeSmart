from __future__ import annotations
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .api.routers import analytics, auth, categories, health, media, orders, products, seed, uploads, weekly_slides
from .core.config import settings
from .core.logging import setup_logging
from .core.middleware import RequestIDMiddleware
from .db import engine
from .db.base import Base
from .db.redis import close_redis, init_redis
from .services.storage import init_storage

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

# ─── Пути к статическим папкам ──────────────────────────────────────────────
# STATIC_DIR: настраивается через STATIC_DIR env (по умолчанию — static/ рядом с backend/)
_APP_ROOT = Path(__file__).resolve().parent.parent  # backend/
STATIC_DIR = Path(os.getenv("STATIC_DIR", str(_APP_ROOT / "static"))).resolve()
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Legacy uploads dir (обратная совместимость)
UPLOAD_DIR = (_APP_ROOT / settings.uploads_dir).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def _init_db(retries: int = 5, delay: float = 3.0) -> None:
    """Try to create DB tables, retrying on failure."""
    try:
        parsed = urlparse(settings.database_url.replace("+asyncpg", ""))
        logger.info("🔌 DB target → host=%s port=%s db=%s user=%s",
                    parsed.hostname, parsed.port, parsed.path.lstrip("/"), parsed.username)
    except Exception:
        pass
    for attempt in range(1, retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("✅ Database tables created")
            return
        except Exception as exc:
            logger.error("❌ DB connection attempt %d/%d failed: %s", attempt, retries, exc)
            if attempt < retries:
                await asyncio.sleep(delay)
    raise RuntimeError(f"Could not connect to database after {retries} attempts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events."""
    logger.info("🚀 Starting up TakeSmart API...")
    logger.info("📂 Static dir: %s", STATIC_DIR)

    # Инициализируем хранилище файлов
    init_storage(STATIC_DIR)
    logger.info("✅ Storage service initialized")

    # Create DB tables (with retry)
    await _init_db()

    # Initialize Redis (optional — non-fatal if not configured)
    await init_redis()

    yield

    # Shutdown
    logger.info("🛑 Shutting down...")
    await close_redis()
    await engine.dispose()
    logger.info("✅ Cleanup complete")


app = FastAPI(
    title="TakeSmart API",
    description="""
# TakeSmart — E-commerce API

Бэкенд интернет-магазина бытовой техники и смартфонов.

## Аутентификация
Используйте `POST /api/auth/login` для получения JWT токена.
Передавайте токен в заголовке: `Authorization: Bearer <token>`

## Медиафайлы
Все изображения загружаются через `POST /api/admin/media/upload`.
Файлы автоматически конвертируются в **WebP** и сохраняются в `/static/`.
""",
    version="1.0.0",
    lifespan=lifespan,
)

# ─── Middleware ───────────────────────────────────────────────────────────────
# Request ID — добавляет X-Request-ID к каждому запросу/ответу
app.add_middleware(RequestIDMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Static files ─────────────────────────────────────────────────────────────
# /static/ — новая система медиафайлов (products, categories, slides)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# /uploads/ — legacy (обратная совместимость со старыми URL)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(categories.router)
app.include_router(orders.router)
app.include_router(analytics.router)
app.include_router(uploads.router)
app.include_router(seed.router)
app.include_router(weekly_slides.router)
app.include_router(media.router)


