from __future__ import annotations

import logging

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)

PAYMENT_METHODS = {
    "cash": "💵 Наличные",
    "card": "💳 Картой при получении",
    "online": "🌐 Онлайн оплата",
}

DELIVERY_METHODS = {
    "pickup": "🏪 Самовывоз",
    "courier": "🚗 Курьер",
    "post": "📦 Почта",
}


def format_items(items: list) -> str:
    if not items:
        return "Товары не указаны"

    lines = []
    for item in items:
        name = item.get("name", "Товар")
        qty = item.get("quantity", 1)
        price = item.get("price", 0)
        total = price * qty
        lines.append(f"  • {name}\n    {qty} шт. × {price:,}₽ = {total:,}₽")
    return "\n".join(lines)


def format_price(amount: int) -> str:
    if not amount:
        return "0₽"
    return f"{amount:,}₽".replace(",", " ")


async def send_telegram_notification(order_data: dict) -> bool:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.info("Telegram not configured, skipping notification")
        return False

    items = order_data.get("items")
    items_text = format_items(items) if items else "Товары не указаны"

    total = order_data.get("total_amount")
    total_text = format_price(total) if total else "Не указана"

    payment = order_data.get("payment_method")
    payment_text = PAYMENT_METHODS.get(payment, "❓ Не указан") if payment else "❓ Не указан"

    delivery = order_data.get("delivery_method")
    delivery_text = DELIVERY_METHODS.get(delivery, "❓ Не указан") if delivery else "❓ Не указан"

    address = order_data.get("delivery_address")
    address_text = address if address else "Не указан"

    message = (
        f"""🛒 <b>НОВЫЙ ЗАКАЗ #{order_data.get('id', 'N/A')}</b>

━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Клиент:</b> {order_data.get('name', 'Не указано')}
📞 <b>Телефон:</b> {order_data.get('phone', 'Не указан')}
📧 <b>Email:</b> {order_data.get('email', 'Не указан')}

━━━━━━━━━━━━━━━━━━━━━━

🛍 <b>ТОВАРЫ:</b>
{items_text}

💰 <b>ИТОГО: {total_text}</b>

━━━━━━━━━━━━━━━━━━━━━━

💳 <b>Оплата:</b> {payment_text}
🚚 <b>Доставка:</b> {delivery_text}
📍 <b>Адрес:</b> {address_text}

━━━━━━━━━━━━━━━━━━━━━━

💬 <b>Комментарий:</b>
{order_data.get('comment') or '—'}

📅 <b>Дата:</b> {order_data.get('created_at', 'Не указана')}"""
    )

    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    payload = {"chat_id": settings.telegram_chat_id, "text": message, "parse_mode": "HTML"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=10.0)
            if response.status_code == 200:
                logger.info("Telegram notification sent for order %s", order_data.get("id"))
                return True
            logger.warning("Telegram API error %s: %s", response.status_code, response.text)
            return False
    except Exception as exc:
        logger.exception("Failed to send Telegram notification: %s", exc)
        return False

