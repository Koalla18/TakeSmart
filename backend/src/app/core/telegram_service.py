"""
Сервис отправки уведомлений в Telegram.

Конфигурируется через переменные окружения:
  TELEGRAM_BOT_TOKEN — токен бота (от @BotFather)
  TELEGRAM_CHAT_ID   — id чата/канала, куда приходят уведомления

Если токен не задан — все вызовы тихо игнорируются (no-op).
"""
from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

import httpx

from src.app.core.config import settings
from src.app.core.logger import get_logger

if TYPE_CHECKING:
    from src.app.database.models.order import Order

logger = get_logger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _escape(text: str) -> str:
    """Экранирует спецсимволы для MarkdownV2."""
    special = r"\_*[]()~`>#+-=|{}.!"
    for ch in special:
        text = text.replace(ch, f"\\{ch}")
    return text


def _format_price(value: Decimal) -> str:
    """Форматирует сумму: 124990.00 → «124 990 ₽»."""
    return f"{value:,.0f}".replace(",", " ") + " ₽"


async def send_order_notification(order: "Order") -> None:
    """
    Отправляет уведомление о новом заказе в Telegram.
    Ошибки перехватываются — они не должны падать основной запрос.
    """
    token = settings.TELEGRAM_BOT_TOKEN
    chat_id = settings.TELEGRAM_CHAT_ID

    if not token or not chat_id:
        logger.debug("telegram_not_configured", skipping=True)
        return

    # ── Формируем тело сообщения ─────────────────────────────────────
    lines: list[str] = []
    lines.append("🛒 *Новый заказ\\!*")
    lines.append("")
    lines.append(f"📋 Номер: `{_escape(order.order_number)}`")
    lines.append(f"👤 Клиент: {_escape(order.customer_name)}")

    if order.customer_phone:
        lines.append(f"📞 Телефон: {_escape(order.customer_phone)}")
    if order.customer_email:
        lines.append(f"📧 Email: {_escape(order.customer_email)}")

    lines.append("")
    lines.append(f"📍 Город: {_escape(order.shipping_city)}")
    lines.append(f"🏠 Адрес: {_escape(order.shipping_address)}")

    if order.customer_note:
        lines.append("")
        lines.append(f"💬 Комментарий: {_escape(order.customer_note)}")

    # позиции заказа
    if order.items:
        lines.append("")
        lines.append("*Состав заказа:*")
        for item in order.items:
            name = _escape(item.product_name)
            qty = item.quantity
            price = _format_price(item.unit_price)
            total = _format_price(item.total_price)
            lines.append(f"  • {name} × {qty} — {price} \\= {total}")

    lines.append("")
    lines.append(f"💰 *Итого: {_escape(_format_price(order.total_amount))}*")

    text = "\n".join(lines)

    # ── Отправляем запрос ────────────────────────────────────────────
    url = _TELEGRAM_API.format(token=token)
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "MarkdownV2",
        "disable_web_page_preview": True,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                logger.warning(
                    "telegram_send_failed",
                    status=response.status_code,
                    body=response.text[:200],
                )
            else:
                logger.info("telegram_notification_sent", order=order.order_number)
    except Exception as exc:
        logger.error("telegram_send_error", error=str(exc))
