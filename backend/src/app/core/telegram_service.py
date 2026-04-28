"""
Сервис отправки уведомлений в Telegram.

Конфигурируется через переменные окружения:
  TELEGRAM_BOT_TOKEN — токен бота (от @BotFather)
    TELEGRAM_CHAT_ID   — id чата/канала (одиночное значение)
    TELEGRAM_CHAT_IDS  — id чатов через запятую

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
_MAX_MESSAGE_LEN = 3900
_MAX_NAME_LEN = 80
_MAX_NOTE_LEN = 500


def _esc(text: str) -> str:
    """Экранирует специальные символы HTML."""
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    )


def _price(value: Decimal) -> str:
    """Форматирует сумму: 124990.00 → «124 990 ₽»."""
    return f"{value:,.0f}".replace(",", " ") + " ₽"


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _split_lines(lines: list[str], max_len: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for raw_line in lines:
        line = _truncate(raw_line, max_len)
        line_len = len(line)
        extra = 1 if current else 0

        if current and current_len + extra + line_len > max_len:
            chunks.append("\n".join(current))
            current = [line]
            current_len = line_len
            continue

        if current:
            current_len += 1 + line_len
            current.append(line)
        else:
            current = [line]
            current_len = line_len

    if current:
        chunks.append("\n".join(current))

    return chunks


async def send_order_notification(order: "Order") -> None:
    """
    Отправляет уведомление о новом заказе в Telegram (HTML-формат).
    Ошибки перехватываются — они не должны падать основной запрос.
    """
    token = settings.TELEGRAM_BOT_TOKEN
    chat_ids_raw = settings.TELEGRAM_CHAT_IDS or settings.TELEGRAM_CHAT_ID

    if not token:
        logger.warning("telegram_not_configured", reason="missing_bot_token", skipping=True)
        return

    if not chat_ids_raw:
        logger.warning("telegram_not_configured", reason="missing_chat_id", skipping=True)
        return

    chat_ids = [cid.strip() for cid in chat_ids_raw.split(",") if cid.strip()]

    if not chat_ids:
        logger.warning("telegram_not_configured", reason="empty_chat_ids", skipping=True)
        return

    sep = "─" * 28

    lines: list[str] = [
        f"🛒 <b>Новый заказ #{_esc(order.order_number)}</b>",
        sep,
        f"👤 <b>{_esc(order.customer_name)}</b>",
    ]

    if order.customer_phone:
        lines.append(f"📞 {_esc(order.customer_phone)}")
    if order.customer_email:
        lines.append(f"📧 {_esc(order.customer_email)}")

    lines += [
        "",
        f"📍 <b>{_esc(order.shipping_city)}</b>",
        f"🏠 {_esc(order.shipping_address)}",
    ]

    if order.customer_note:
        note = _truncate(_esc(order.customer_note), _MAX_NOTE_LEN)
        lines += ["", f"💬 <i>{note}</i>"]

    # ── Позиции заказа ───────────────────────────────────────────────
    if order.items:
        lines += ["", "📦 <b>Состав:</b>"]
        for i, item in enumerate(order.items, 1):
            name = _truncate(_esc(item.product_name), _MAX_NAME_LEN)
            qty = item.quantity
            unit = _price(item.unit_price)
            total = _price(item.total_price)
            lines.append(f"  {i}. {name} × {qty} — {unit} = <b>{total}</b>")

    lines += [
        "",
        sep,
        f"💰 <b>Итого: {_price(order.total_amount)}</b>",
    ]

    text = "\n".join(lines)
    messages = _split_lines(lines, _MAX_MESSAGE_LEN)

    if len(messages) > 1:
        logger.warning(
            "telegram_message_chunked",
            order=order.order_number,
            chunks=len(messages),
            length=len(text),
        )

    # ── Отправляем запрос ────────────────────────────────────────────
    url = _TELEGRAM_API.format(token=token)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for chat_id in chat_ids:
                for text_part in messages:
                    payload = {
                        "chat_id": chat_id,
                        "text": text_part,
                        "parse_mode": "HTML",
                        "disable_web_page_preview": True,
                    }
                    response = await client.post(url, json=payload)
                    if response.status_code != 200:
                        logger.warning(
                            "telegram_send_failed",
                            chat_id=chat_id,
                            status=response.status_code,
                            body=response.text[:200],
                        )
                    else:
                        logger.info("telegram_notification_sent", order=order.order_number, chat_id=chat_id)
    except Exception as exc:
        logger.error("telegram_send_error", error=str(exc))
