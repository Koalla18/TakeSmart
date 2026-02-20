from __future__ import annotations
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .api.routers import analytics, auth, categories, health, media, orders, products, seed, uploads, weekly_slides
from .core.logging import setup_logging
from .core.config import settings
from .db import engine
from .db.base import Base
from .db.redis import close_redis, init_redis
# Setup logging
setup_logging()
logger = logging.getLogger(__name__)
# Create uploads directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
async def _init_db(retries: int = 5, delay: float = 3.0) -> None:
    """Try to create DB tables, retrying on failure."""
    # Log parsed host/port for diagnostics (never log password)
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
    # Create DB tables (with retry)
    await _init_db()
    logger.info("✅ Database tables created")
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
    description="E-commerce backend for electronics and smartphones",
    version="1.0.0",
    lifespan=lifespan,
)
# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Mount static files for uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
# Include routers
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
