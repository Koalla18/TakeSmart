from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src.app.core.config import settings
from src.app.core.logger import setup_logging, get_logger
from src.app.core.middleware import LoggingMiddleware
from src.app.redis.client import get_redis_pool, close_redis_pool
from src.app.api.routers import (
    health_router,
    product_images_router,
    categories_router,
    products_router,
    product_groups_router,
    orders_router,
    weekly_slides_router,
)
from src.app.api.admin.endpoints import router as admin_router

# Логирование инициализируется ДО создания app — чтобы поймать все события старта
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("app_starting", env="debug" if settings.APP_DEBUG else "production")

    settings.STATIC_DIR.mkdir(parents=True, exist_ok=True)
    (settings.STATIC_DIR / settings.PRODUCTS_IMAGES_DIR).mkdir(exist_ok=True)
    (settings.STATIC_DIR / settings.CATEGORIES_IMAGES_DIR).mkdir(exist_ok=True)
    logger.info("static_dirs_ready", path=str(settings.STATIC_DIR))

    await get_redis_pool()
    logger.info("redis_connected", url=settings.redis_url)

    logger.info("app_ready", title=settings.APP_TITLE, version=settings.APP_VERSION)
    yield

    logger.info("app_shutting_down")
    await close_redis_pool()
    logger.info("app_stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_TITLE,
        version=settings.APP_VERSION,
        debug=settings.APP_DEBUG,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------ #
    #  Глобальные обработчики ошибок                                      #
    # ------------------------------------------------------------------ #

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = []
        for error in exc.errors():
            error_type = error.get("type", "")

            # JSON decode error — тело запроса не является валидным JSON
            if error_type == "json_invalid":
                details.append(
                    {
                        "field": None,
                        "message": "Тело запроса должно быть валидным JSON. Убедитесь что Content-Type: application/json",
                    }
                )
                continue

            # Обычные ошибки валидации полей — фильтруем числовые позиции (не имена полей)
            field_parts = [
                str(loc) for loc in error["loc"] if loc != "body" and not isinstance(loc, int)
            ]
            field = " → ".join(field_parts) if field_parts else None
            details.append({"field": field, "message": error["msg"]})

        logger.warning(
            "validation_error",
            path=str(request.url.path),
            method=request.method,
            errors=details,
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "status_code": 422,
                "error": "Ошибка валидации данных",
                "details": details,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """Перехватывает все необработанные исключения."""
        logger.exception(
            "unhandled_exception",
            path=str(request.url.path),
            method=request.method,
            error=str(exc),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status_code": 500,
                "error": "Внутренняя ошибка сервера",
                "details": None,
            },
        )

    # ------------------------------------------------------------------ #
    #  Middleware                                                          #
    # ------------------------------------------------------------------ #
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------ #
    #  Статика                                                             #
    # ------------------------------------------------------------------ #
    app.mount(
        settings.STATIC_URL,
        StaticFiles(directory=settings.STATIC_DIR),
        name="static",
    )

    # ------------------------------------------------------------------ #
    #  Роутеры                                                             #
    # ------------------------------------------------------------------ #
    prefix = "/api/v1"
    app.include_router(health_router,         prefix=prefix)
    app.include_router(categories_router,     prefix=prefix)
    app.include_router(products_router,       prefix=prefix)
    app.include_router(product_groups_router,  prefix=prefix)
    app.include_router(product_images_router, prefix=prefix)
    app.include_router(orders_router,         prefix=prefix)
    app.include_router(weekly_slides_router,  prefix=prefix)
    app.include_router(admin_router,          prefix=f"{prefix}/admin", tags=["admin"])

    return app


app = create_app()
