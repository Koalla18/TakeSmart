"""
Web Push уведомления для PWA «Заказы».

Настраивается через переменные окружения:
  VAPID_PUBLIC_KEY   — публичный VAPID-ключ (base64url, отдаётся фронту)
  VAPID_PRIVATE_KEY  — приватный VAPID-ключ (base64url)
  VAPID_SUBJECT      — mailto:/URL контакта (требование VAPID)

Если ключи не заданы — все вызовы тихо игнорируются (no-op).

Надёжность и скорость доставки:
  • TTL=PUSH_TTL — push-сервис (Apple APNs / Mozilla) хранит сообщение и
    дослыает, когда устройство снова появится в сети. С дефолтным ttl=0
    сообщение ВЫБРАСЫВАЕТСЯ, если устройство недоступно в этот миг (спящий
    Mac, мигнувшая сеть) — отсюда «иногда не приходит».
  • Urgency: high — просим сервис разбудить устройство немедленно, а не
    группировать доставку (быстрее).
  • Отправка всем подпискам идёт ПАРАЛЛЕЛЬНО (asyncio.gather + to_thread),
    pywebpush синхронный — так живое устройство не ждёт за чужими таймаутами.
Просроченные подписки (404/410) удаляются из БД.
"""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from pywebpush import webpush, WebPushException
from sqlalchemy import delete, func, select

from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.database.models.push_subscription import PushSubscription
from src.app.database.session import AsyncSessionFactory

if TYPE_CHECKING:
    from src.app.database.models.order import Order

logger = get_logger(__name__)

# Сколько push-сервис хранит недоставленное сообщение (сек). Заказ важен —
# держим до суток, чтобы не потерять, если устройство было офлайн.
PUSH_TTL = 24 * 60 * 60
# RFC 8030: просим доставить немедленно (разбудить устройство).
PUSH_HEADERS = {"Urgency": "high"}
# Таймаут на одну отправку (сек). Отправки идут параллельно, так что мёртвая
# подписка не задерживает остальные.
SEND_TIMEOUT = 10


def _price(value) -> str:
    try:
        return f"{value:,.0f}".replace(",", " ") + " ₽"
    except Exception:
        return f"{value} ₽"


def _send_one(sub_info: dict, payload: str) -> int | None:
    """Синхронная отправка одного пуша. Возвращает HTTP-код (для 404/410 → удалить), иначе None."""
    try:
        webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            ttl=PUSH_TTL,
            headers=dict(PUSH_HEADERS),
            timeout=SEND_TIMEOUT,
        )
        return None
    except WebPushException as exc:
        code = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("push_send_failed", status=code, error=str(exc)[:200])
        return code
    except Exception as exc:  # noqa: BLE001
        logger.error("push_send_one_error", error=str(exc))
        return None


async def send_push_to_all(title: str, body: str, url: str = "/app", tag: str = "takesmart-order") -> dict:
    """Рассылает Web Push всем сохранённым подпискам. Возвращает {sent,total,pruned}. Безопасно."""
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        logger.warning("push_not_configured", skipping=True)
        return {"sent": 0, "total": 0, "pruned": 0}

    async with AsyncSessionFactory() as session:
        rows = (await session.execute(select(PushSubscription))).scalars().all()
        if not rows:
            return {"sent": 0, "total": 0, "pruned": 0}

        payload = json.dumps(
            {"title": title, "body": body, "url": url, "tag": tag}, ensure_ascii=False
        )
        infos = [
            (sub.endpoint, {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}})
            for sub in rows
        ]
        # Параллельная отправка: живое устройство не ждёт за таймаутами мёртвых.
        codes = await asyncio.gather(
            *(asyncio.to_thread(_send_one, info, payload) for _, info in infos)
        )

        dead = [endpoint for (endpoint, _), code in zip(infos, codes) if code in (404, 410)]
        sent = sum(1 for code in codes if code is None)
        if dead:
            await session.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(dead)))
            await session.commit()

    logger.info("push_sent", title=title, sent=sent, total=len(rows), pruned=len(dead))
    return {"sent": sent, "total": len(rows), "pruned": len(dead)}


async def count_subscriptions() -> int:
    """Сколько активных подписок сейчас (для обратной связи в UI «Тест»)."""
    async with AsyncSessionFactory() as session:
        return int((await session.execute(select(func.count(PushSubscription.id)))).scalar() or 0)


async def send_order_push(order: "Order") -> None:
    """Пуш о новом заказе. Свой tag по номеру заказа — чтобы было видно каждый заказ."""
    try:
        title = "У вас новый заказ!"
        body = f"{order.order_number} · {order.customer_name or 'клиент'} · {_price(order.total_amount)}"
        await send_push_to_all(title, body, url="/app", tag=f"order-{order.order_number}")
    except Exception as exc:  # noqa: BLE001
        logger.error("push_order_error", error=str(exc))
