from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.core.push_service import count_subscriptions, send_push_to_all
from src.app.database.models.admin import Admin
from src.app.database.models.push_subscription import PushSubscription
from src.app.database.session import get_db
from src.app.schemas.push import PushSubscriptionIn, PushUnsubscribeIn, VapidKeyOut

logger = get_logger(__name__)

router = APIRouter(prefix="/push", tags=["Push"])


@router.get("/vapid-public-key", response_model=VapidKeyOut, summary="Публичный VAPID-ключ для подписки")
async def vapid_public_key() -> VapidKeyOut:
    return VapidKeyOut(public_key=settings.VAPID_PUBLIC_KEY)


@router.post("/subscribe", status_code=status.HTTP_201_CREATED, summary="Подписать устройство на push")
async def subscribe(
    body: PushSubscriptionIn,
    admin: Admin = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    existing = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    ).scalar_one_or_none()
    if existing:
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        existing.user_agent = body.user_agent
        existing.admin_id = admin.id
    else:
        db.add(
            PushSubscription(
                endpoint=body.endpoint,
                p256dh=body.keys.p256dh,
                auth=body.keys.auth,
                user_agent=body.user_agent,
                admin_id=admin.id,
            )
        )
    await db.commit()
    logger.info("push_subscribed", admin=admin.username)
    return {"ok": True}


@router.post("/unsubscribe", summary="Отписать устройство", dependencies=[Depends(get_current_admin)])
async def unsubscribe(body: PushUnsubscribeIn, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    await db.commit()
    return {"ok": True}


async def _delayed_test(delay: int) -> None:
    await asyncio.sleep(delay)
    await send_push_to_all(
        "Тест уведомления", "Пуш в фоне работает ✅", "/app", tag="takesmart-test"
    )


@router.post("/test", summary="Отправить тестовый push", dependencies=[Depends(get_current_admin)])
async def test_push(background_tasks: BackgroundTasks, delay: int = 0) -> dict:
    # delay>0 — отправить позже (чтобы успеть закрыть приложение и проверить
    # доставку при ЗАКРЫТОМ приложении). Возвращаем число подписок сразу.
    if delay and delay > 0:
        delay = min(delay, 60)
        background_tasks.add_task(_delayed_test, delay)
        return {"scheduled": True, "delay": delay, "total": await count_subscriptions()}
    # await напрямую — чтобы вернуть, скольким устройствам ушло (для обратной связи в UI)
    return await send_push_to_all(
        "Тест уведомления", "Если вы это видите — пуши работают ✅", "/app", tag="takesmart-test"
    )
