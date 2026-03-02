from __future__ import annotations

import logging
import logging.config
from typing import Any

import structlog
from structlog.types import EventDict, Processor

from src.app.core.config import settings


def _add_app_info(
    logger: Any, method: str, event_dict: EventDict
) -> EventDict:
    """Добавляет имя приложения и версию в каждую запись лога."""
    event_dict["app"] = settings.APP_TITLE
    event_dict["version"] = settings.APP_VERSION
    return event_dict


def _drop_color_message_key(
    logger: Any, method: str, event_dict: EventDict
) -> EventDict:
    """
    Uvicorn кладёт 'color_message' рядом с 'message' — убираем дубль,
    чтобы не мусорить в JSON-логах.
    """
    event_dict.pop("color_message", None)
    return event_dict


def _extract_from_record(
    logger: Any, method: str, event_dict: EventDict
) -> EventDict:
    """
    Извлекает стандартные поля из logging.LogRecord
    (модуль, строка, имя логгера) и добавляет в structlog-событие.
    """
    record: logging.LogRecord | None = event_dict.get("_record")
    if record is not None:
        event_dict["logger"] = record.name
        event_dict["module"] = record.module
        event_dict["lineno"] = record.lineno
        event_dict["func"] = record.funcName
    return event_dict


def _safe_add_logger_name(
    logger: Any, method: str, event_dict: EventDict
) -> EventDict:
    """
    Безопасная версия structlog.stdlib.add_logger_name — иногда structlog
    вызывает процессоры с logger=None (например при форматтере), поэтому
    пытаемся не ломаться и используем уже извлечённое из Record значение.
    """
    # Если logger передан как объект logging.Logger, используем его имя
    if logger is not None:
        try:
            name = logger.name
        except Exception:
            name = None
    else:
        name = None

    # Если имя не удалось получить от logger, смотрим в event_dict
    if not name:
        name = event_dict.get("logger")

    if name:
        event_dict["logger"] = name

    return event_dict


def setup_logging() -> None:
    """
    Инициализирует единую систему логирования для всего приложения.

    В режиме DEBUG (APP_DEBUG=True):
        - цветной вывод в консоль через structlog ConsoleRenderer
        - видны DEBUG-сообщения из SQLAlchemy (SQL-запросы)

    В продакшене (APP_DEBUG=False):
        - JSON-формат, один объект на строку
        - уровень INFO (без SQL-запросов)

    Все сторонние библиотеки (uvicorn, sqlalchemy, fastapi)
    автоматически перехватываются и выводятся в том же формате.
    """

    log_level = logging.DEBUG if settings.APP_DEBUG else logging.INFO

    # ------------------------------------------------------------------ #
    #  Общие процессоры для обоих режимов                                 #
    # ------------------------------------------------------------------ #
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,       # контекст запроса (request_id и т.д.)
        structlog.stdlib.add_log_level,                # level: "info"
        _safe_add_logger_name,                          # logger: "uvicorn.access" (безопасно)
        structlog.stdlib.ExtraAdder(),                 # extra-поля из logging.getLogger().info(..., extra={})
        _drop_color_message_key,
        _add_app_info,
        structlog.processors.TimeStamper(fmt="iso"),   # timestamp: "2026-02-24T12:00:00Z"
        structlog.processors.StackInfoRenderer(),      # stack_info если передан
        structlog.processors.UnicodeDecoder(),
    ]

    # ------------------------------------------------------------------ #
    #  Финальный рендерер зависит от режима                               #
    # ------------------------------------------------------------------ #
    if settings.APP_DEBUG:
        # Цветной human-friendly вывод для разработки
        final_renderer: Processor = structlog.dev.ConsoleRenderer(
            colors=True,
            exception_formatter=structlog.dev.plain_traceback,
        )
    else:
        # Структурированный JSON для продакшена (Loki, ELK, CloudWatch и т.д.)
        final_renderer = structlog.processors.JSONRenderer()

    # ------------------------------------------------------------------ #
    #  Конфигурация structlog                                             #
    # ------------------------------------------------------------------ #
    structlog.configure(
        processors=[
            *shared_processors,
            # Форматирует exc_info в строку перед финальным рендером
            structlog.processors.format_exc_info,
            final_renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # ------------------------------------------------------------------ #
    #  Перехват стандартного logging → structlog                          #
    # ------------------------------------------------------------------ #
    #  Все библиотеки (uvicorn, sqlalchemy, fastapi, asyncpg) используют
    #  стандартный logging — перенаправляем его в structlog.
    # ------------------------------------------------------------------ #
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "structlog": {
                    "()": structlog.stdlib.ProcessorFormatter,
                    "processors": [
                        _extract_from_record,
                        structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                        *shared_processors,
                        structlog.processors.format_exc_info,
                        final_renderer,
                    ],
                    "foreign_pre_chain": shared_processors,
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "formatter": "structlog",
                }
            },
            "root": {
                "handlers": ["console"],
                "level": log_level,
            },
            "loggers": {
                # Uvicorn
                "uvicorn": {"handlers": ["console"], "level": "INFO", "propagate": False},
                "uvicorn.error": {"handlers": ["console"], "level": "INFO", "propagate": False},
                "uvicorn.access": {"handlers": ["console"], "level": "INFO", "propagate": False},
                # SQLAlchemy — SQL-запросы видны только в DEBUG
                "sqlalchemy.engine": {
                    "handlers": ["console"],
                    "level": "DEBUG" if settings.APP_DEBUG else "WARNING",
                    "propagate": False,
                },
                "sqlalchemy.pool": {
                    "handlers": ["console"],
                    "level": "DEBUG" if settings.APP_DEBUG else "WARNING",
                    "propagate": False,
                },
                # FastAPI / Starlette
                "fastapi": {"handlers": ["console"], "level": "INFO", "propagate": False},
                "starlette": {"handlers": ["console"], "level": "INFO", "propagate": False},
                # asyncpg
                "asyncpg": {"handlers": ["console"], "level": "WARNING", "propagate": False},
            },
        }
    )


def get_logger(name: str | None = None) -> structlog.BoundLogger:
    """
    Фабрика логгеров — используется во всём приложении.

    Пример:
        from src.app.core.logger import get_logger
        logger = get_logger(__name__)
        logger.info("product_created", product_id=str(product.id), name=product.name)
    """
    return structlog.get_logger(name)
