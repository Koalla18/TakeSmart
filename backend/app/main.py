import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import router as auth_router
from app.api.cart import router as cart_router
from app.api.catalog import router as catalog_router
from app.api.health import router as health_router
from app.api.orders import router as orders_router
from app.core.cache import invalidate_prefix
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine

setup_logging()
logger = logging.getLogger("app")

app = FastAPI(title="Take Smart API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start) * 1000)
    logger.info("%s %s %s %sms", request.method, request.url.path, response.status_code, duration_ms)
    return response


@app.middleware("http")
async def invalidate_cache_after_write(request: Request, call_next):
    response = await call_next(request)
    if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
        path = request.url.path
        if path.startswith("/api/categories"):
            await invalidate_prefix("catalog:categories:")
        if path.startswith("/api/brands"):
            await invalidate_prefix("catalog:brands:")
        if path.startswith("/api/products"):
            await invalidate_prefix("catalog:products:")
            await invalidate_prefix("catalog:product:")
            await invalidate_prefix("catalog:search:tsv:")
    return response


@app.exception_handler(SQLAlchemyError)
async def db_exception_handler(_request: Request, exc: SQLAlchemyError):
    logger.exception("database error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Database error"})


@app.on_event("startup")
async def on_startup():
    if settings.enable_db_init:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("database schema ensured")


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(catalog_router)
app.include_router(cart_router)
app.include_router(orders_router)