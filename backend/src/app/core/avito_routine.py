"""Grounded replies for routine turns that should not be escalated."""
from __future__ import annotations

import re

from src.app.core.avito_bot_engine import normalize

_PRIZE_CLAIM = re.compile(
    r"\b(?:розыгрыш\w*|выигра(?:л\w*|ш\w*)|(?:выдать|забрать|получить|дайте)\s+(?:мой\s+)?приз)\b",
    re.IGNORECASE,
)
_ADDRESS_REQUEST = re.compile(
    r"\b(?:напишите|укажите|пришлите|подскажите|уточните|нужен)\b[^.!?\n]{0,95}"
    r"\b(?:адрес(?:\s+(?:пвз|пункта|сдэк))?|пвз|пункт\s+выдачи)\b", re.IGNORECASE,
)
_DELIVERY = re.compile(r"\b(?:пвз|пункт\s+выдачи|сдэк|доставк\w*|курьер\w*)\b", re.IGNORECASE)
_ADDRESS_CORRECTION = re.compile(
    r"\b(?:ошиб(?:ся|лась)\s+(?:с\s+)?адрес\w*|не\s+тот\s+адрес|адрес\s+(?:не\s+тот|неверн\w*|неправильн\w*))\b",
    re.IGNORECASE,
)
_ADDRESS_FRAGMENT = re.compile(r"\b(?:улиц\w*|удиц\w*|ул\b|дом\b|корпус\b|проспект\w*|переул\w*|пвз\b)", re.I)
_ADDRESS_NUMBER = re.compile(r"(?:\b\d{1,5}[а-яa-z]?\b|https?://|\b[а-яa-z]{2,}\d{2,}\b)", re.I)
_OTHER_REQUEST = re.compile(r"\b(?:менеджер\w*|возврат\w*|жалоб\w*|претенз\w*|оплат\w*|сколько|поч[её]м)\b", re.I)


def unverified_prize_reply(pending: str, history: list[tuple[str, str]]) -> str | None:
    if not _PRIZE_CLAIM.search(pending):
        return None
    seen = any(author == "client" and normalize(message) == normalize(pending) for author, message in history[:-1])
    if seen:
        return "Без официального объявления магазина подтвердить выигрыш и выдать приз не получится."
    return ("У нас нет подтверждения этого розыгрыша, поэтому выдать приз не могу. "
            "Если видели объявление об акции, пришлите, пожалуйста, ссылку на официальную публикацию магазина.")


def incomplete_delivery_address_reply(pending: str, history: list[tuple[str, str]]) -> str | None:
    if _OTHER_REQUEST.search(pending) or _ADDRESS_NUMBER.search(pending):
        return None
    correction = bool(_ADDRESS_CORRECTION.search(pending))
    if not correction and not _ADDRESS_FRAGMENT.search(pending):
        return None
    staff_messages = [message for author, message in reversed(history[-10:]) if author != "client"]
    request = next((message for message in staff_messages[:3]
                    if _DELIVERY.search(message) and _ADDRESS_REQUEST.search(message)), None)
    if not request:
        return None
    prefix = "Ничего страшного." if correction else "Спасибо. Не хватает номера дома."
    if re.search(r"\b(?:пвз|пункт\s+выдачи|сдэк)\b", request, re.I):
        return f"{prefix} Пришлите, пожалуйста, улицу и номер дома пункта выдачи СДЭК или ссылку на него."
    return f"{prefix} Напишите, пожалуйста, улицу и номер дома для доставки."
