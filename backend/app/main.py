from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .api.routers import analytics, auth, categories, health, media, orders, products, seed, uploads, weekly_slides
from .core.logging import setup_logging
from .db import engine
from .db.base import Base
from .db.redis import close_redis, init_redis
# Setup logging
setup_logging()
logger = logging.getLogger(__name__)
# Create uploads directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events."""
    logger.info("🚀 Starting up TakeSmart API...")
    # Create DB tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Database tables created")
    # Initialize Redis
    await init_redis()
    logger.info("✅ Redis connected")
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
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
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
