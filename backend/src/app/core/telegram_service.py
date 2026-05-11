"""
Сервис отправки уведомлений в Telegram.

Конфигурируется через переменные окружения:
  TELEGRAM_BOT_TOKEN — токен бота (от @BotFather)
  TELEGRAM_CHAT_ID   — id чата/канала (одиночное значение)
  TELEGRAM_CHAT_IDS  — id чатов через запятую
  TELEGRAM_THREAD_ID — id темы (для форумных чатов)

Если токен не задан — все вызовы тихо игнорируются (no-op).
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from html import escape
from typing import TYPE_CHECKING

import httpx

from src.app.core.config import settings
from src.app.core.logger import get_logger

if TYPE_CHECKING:
    from src.app.database.models.order import Order

logger = get_logger(__name__)

_TELEGRAM_API_PATH = "/bot{token}/sendMessage"
_MAX_MESSAGE_LEN = 3900
_MAX_NAME_LEN = 80
_MAX_NOTE_LEN = 500


def _esc(text: str | None) -> str:
    """Экранирует специальные символы HTML."""
    if not text:
        return ""
    return escape(text)


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


def _build_telegram_url(token: str) -> str:
    base = settings.TELEGRAM_API_BASE_URL.rstrip("/")
    return f"{base}{_TELEGRAM_API_PATH.format(token=token)}"


def _error_payload(exc: Exception) -> dict[str, str]:
    return {
        "error": str(exc),
        "error_type": type(exc).__name__,
        "error_repr": repr(exc),
    }


async def send_order_notification(order: "Order") -> None:
    """
    Отправляет уведомление о новом заказе в Telegram (HTML-формат).
    Ошибки перехватываются — они не должны падать основной запрос.
    """
    token = settings.TELEGRAM_BOT_TOKEN
    chat_ids_raw = settings.TELEGRAM_CHAT_IDS
    chat_id_single = settings.TELEGRAM_CHAT_ID
    thread_id = settings.TELEGRAM_THREAD_ID

    if not token:
        logger.warning("telegram_not_configured", reason="missing_bot_token", skipping=True)
        return

    if not chat_ids_raw and not chat_id_single:
        logger.warning("telegram_not_configured", reason="missing_chat_id", skipping=True)
        return

    chat_ids: list[str] = []
    if chat_ids_raw:
        chat_ids.extend([cid.strip() for cid in chat_ids_raw.split(",") if cid.strip()])
    if chat_id_single:
        chat_ids.append(chat_id_single.strip())
    chat_ids = list(dict.fromkeys([cid for cid in chat_ids if cid]))

    if not chat_ids:
        logger.warning("telegram_not_configured", reason="empty_chat_ids", skipping=True)
        return

    sep = "─" * 28

    customer_name = _esc(order.customer_name) or "Без имени"
    lines: list[str] = [
        f"🛒 <b>Новый заказ #{_esc(order.order_number)}</b>",
        sep,
        f"👤 <b>{customer_name}</b>",
    ]

    if order.customer_phone:
        lines.append(f"📞 {_esc(order.customer_phone)}")
    if order.customer_email:
        lines.append(f"📧 {_esc(order.customer_email)}")

    if order.shipping_city:
        lines += ["", f"📍 <b>{_esc(order.shipping_city)}</b>"]
    if order.shipping_address:
        lines.append(f"🏠 {_esc(order.shipping_address)}")

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
    url = _build_telegram_url(token)

    try:
        retries = max(settings.TELEGRAM_RETRIES, 0)
        retry_delay = max(settings.TELEGRAM_RETRY_DELAY_SECONDS, 0.0)
        timeout = httpx.Timeout(settings.TELEGRAM_TIMEOUT_SECONDS)

        async with httpx.AsyncClient(timeout=timeout) as client:
            for chat_id in chat_ids:
                all_delivered = True
                for index, text_part in enumerate(messages, 1):
                    payload = {
                        "chat_id": chat_id,
                        "text": text_part,
                        "parse_mode": "HTML",
                        "disable_web_page_preview": True,
                    }
                    if thread_id is not None:
                        payload["message_thread_id"] = thread_id

                    delivered = False
                    for attempt in range(retries + 1):
                        try:
                            response = await client.post(url, json=payload)
                        except httpx.HTTPError as exc:
                            if attempt < retries:
                                logger.warning(
                                    "telegram_send_retry",
                                    chat_id=chat_id,
                                    chunk=index,
                                    attempt=attempt + 1,
                                    **_error_payload(exc),
                                )
                                await asyncio.sleep(retry_delay * (attempt + 1))
                                continue

                            logger.error(
                                "telegram_send_error",
                                chat_id=chat_id,
                                chunk=index,
                                **_error_payload(exc),
                            )
                            all_delivered = False
                            break

                        if response.status_code != 200:
                            body = response.text[:200]
                            if response.status_code >= 500 and attempt < retries:
                                logger.warning(
                                    "telegram_send_retry",
                                    chat_id=chat_id,
                                    chunk=index,
                                    attempt=attempt + 1,
                                    status=response.status_code,
                                    body=body,
                                )
                                await asyncio.sleep(retry_delay * (attempt + 1))
                                continue

                            logger.warning(
                                "telegram_send_failed",
                                chat_id=chat_id,
                                status=response.status_code,
                                chunk=index,
                                body=body,
                            )
                            all_delivered = False
                            break

                        delivered = True
                        break

                    if not delivered:
                        all_delivered = False
                        break

                if all_delivered:
                    logger.info(
                        "telegram_notification_sent",
                        order=order.order_number,
                        chat_id=chat_id,
                    )
    except Exception as exc:
        logger.error("telegram_send_error", **_error_payload(exc))