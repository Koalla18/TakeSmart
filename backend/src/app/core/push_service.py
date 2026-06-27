"""
Web Push уведомления для PWA «Заказы».

Настраивается через переменные окружения:
  VAPID_PUBLIC_KEY   — публичный VAPID-ключ (base64url, отдаётся фронту)
  VAPID_PRIVATE_KEY  — приватный VAPID-ключ (base64url)
  VAPID_SUBJECT      — mailto:/URL контакта (требование VAPID)

Если ключи не заданы — все вызовы тихо игнорируются (no-op).
pywebpush синхронный, поэтому отправка каждого пуша уходит в поток (to_thread),
чтобы не блокировать event loop. Просроченные подписки (404/410) удаляются из БД.
"""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from pywebpush import webpush, WebPushException
from sqlalchemy import delete, select

from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.database.models.push_subscription import PushSubscription
from src.app.database.session import AsyncSessionFactory

if TYPE_CHECKING:
    from src.app.database.models.order import Order

logger = get_logger(__name__)


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
            timeout=10,
        )
        return None
    except WebPushException as exc:
        return getattr(getattr(exc, "response", None), "status_code", None)
    except Exception as exc:  # noqa: BLE001
        logger.error("push_send_one_error", error=str(exc))
        return None


async def send_push_to_all(title: str, body: str, url: str = "/app") -> dict:
    """Рассылает Web Push всем сохранённым подпискам. Возвращает {sent,total,pruned}. Безопасно."""
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        logger.warning("push_not_configured", skipping=True)
        return {"sent": 0, "total": 0, "pruned": 0}

    dead: list[str] = []
    sent = 0
    async with AsyncSessionFactory() as session:
        rows = (await session.execute(select(PushSubscription))).scalars().all()
        if not rows:
            return {"sent": 0, "total": 0, "pruned": 0}
        payload = json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False)
        for sub in rows:
            info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
            code = await asyncio.to_thread(_send_one, info, payload)
            if code in (404, 410):
                dead.append(sub.endpoint)
            elif code is None:
                sent += 1
        if dead:
            await session.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(dead)))
            await session.commit()

    logger.info("push_sent", title=title, sent=sent, pruned=len(dead))
    return {"sent": sent, "total": len(rows), "pruned": len(dead)}


async def send_order_push(order: "Order") -> None:
    """Пуш о новом заказе (вешается в BackgroundTasks рядом с Telegram)."""
    try:
        title = "У вас новый заказ!"
        body = f"{order.order_number} · {order.customer_name or 'клиент'} · {_price(order.total_amount)}"
        await send_push_to_all(title, body, url="/app")
    except Exception as exc:  # noqa: BLE001
        logger.error("push_order_error", error=str(exc))
