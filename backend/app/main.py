from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from sqlalchemy.engine.url import make_url

from .api.routers import analytics, auth, categories, health, orders, products, seed, uploads
from .core.config import settings
from .core.logging import configure_logging
from .db.base import Base
from .db.redis import close_redis, get_redis_client
from .db.session import engine

configure_logging()
logger = logging.getLogger(__name__)


async def _wait_for_db(retries: int = 30, delay: float = 1.0) -> None:
    url = make_url(settings.database_url)
    target = f"{url.drivername}://{url.host}:{url.port}/{url.database}"
    for attempt in range(1, retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(lambda _: None)
            logger.info("Database connected: %s", target)
            return
        except OperationalError as exc:
            logger.warning("Database not ready (%s/%s): %s", attempt, retries, exc)
            await asyncio.sleep(delay)
    raise RuntimeError(f"Database not ready after {retries} attempts: {target}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_redis_client()
    await _wait_for_db()
    if settings.auto_create_tables:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield
    await close_redis()


app = FastAPI(title="Take Smart API", lifespan=lifespan)

base_dir = os.path.dirname(os.path.dirname(__file__))
uploads_dir = os.path.join(base_dir, settings.uploads_dir)
os.makedirs(uploads_dir, exist_ok=True)
app.mount(f"/{settings.uploads_dir}", StaticFiles(directory=uploads_dir), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = (time.perf_counter() - start) * 1000
    logger.info("%s %s -> %s (%.2fms)", request.method, request.url.path, response.status_code, duration)
    return response


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(analytics.router)
app.include_router(uploads.router)
app.include_router(seed.router)
