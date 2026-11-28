"""
Клиент Avito API (мессенджер). Документация: https://developers.avito.ru/api-catalog/messenger/documentation

  POST /token                                                   — токен по client_credentials (живёт ~24 ч)
  GET  /core/v1/accounts/self                                   — id аккаунта (user_id)
  POST /messenger/v3/webhook                                    — подписка на новые сообщения
  GET  /messenger/v2/accounts/{user_id}/chats/{chat_id}         — объявление и собеседник
  POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/messages — отправить текст
  POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/read    — пометить прочитанным
  GET  /messenger/v2/accounts/{user_id}/chats?unread_only=true  — непрочитанные чаты (догонялка)
  GET  /messenger/v3/accounts/{user_id}/chats/{chat_id}/messages/ — последние сообщения чата

Токен кэшируется в памяти процесса до истечения.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from src.app.core.config import settings
from src.app.core.logger import get_logger

logger = get_logger(__name__)

BASE = settings.AVITO_API_BASE.rstrip("/")
TIMEOUT = httpx.Timeout(20.0, connect=10.0)

_TOKENS: dict[str, tuple[str, float]] = {}  # client_id → (token, истекает в monotonic)


class AvitoError(Exception):
    pass


class SendUnconfirmed(AvitoError):
    """Авито мог принять сообщение, но подтверждение не получено."""


@dataclass
class AvitoCreds:
    client_id: str
    client_secret: str
    user_id: int | None = None

    @property
    def ready(self) -> bool:
        return bool(self.client_id and self.client_secret)


async def _token(creds: AvitoCreds, client: httpx.AsyncClient) -> str:
    cached = _TOKENS.get(creds.client_id)
    if cached and cached[1] > time.monotonic() + 60:
        return cached[0]
    try:
        resp = await client.post(f"{BASE}/token", data={
            "grant_type": "client_credentials",
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
        })
    except httpx.HTTPError as exc:
        raise AvitoError(f"Нет связи с Авито: {exc.__class__.__name__}") from exc
    if resp.status_code >= 400:
        raise AvitoError(f"Авито не выдал токен ({resp.status_code}): проверьте client_id и client_secret")
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise AvitoError("Авито не выдал токен: пустой ответ")
    _TOKENS[creds.client_id] = (token, time.monotonic() + int(data.get("expires_in", 3600)))
    return token


def forget_token(client_id: str) -> None:
    _TOKENS.pop(client_id, None)


async def _request(creds: AvitoCreds, method: str, path: str, json: Any = None,
                   params: dict[str, Any] | None = None, *, sending: bool = False) -> Any:
    if not creds.ready:
        raise AvitoError("Авито не подключён: нет client_id или client_secret")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        token = await _token(creds, client)
        try:
            resp = await client.request(method, f"{BASE}{path}", json=json, params=params, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            if sending and not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
                raise SendUnconfirmed() from exc
            raise AvitoError(f"Нет связи с Авито: {exc.__class__.__name__}") from exc
        if sending and (resp.status_code == 408 or resp.status_code >= 500):
            raise SendUnconfirmed()
        if resp.status_code == 401:
            forget_token(creds.client_id)
        if resp.status_code >= 400:
            logger.warning("avito_http_error", method=method, status=resp.status_code)
            raise AvitoError(f"Авито ответил ошибкой {resp.status_code}")
        try:
            return resp.json() if resp.content else {}
        except ValueError as exc:
            if sending:
                raise SendUnconfirmed() from exc
            raise AvitoError("Авито вернул некорректный ответ") from exc


def _need_user(creds: AvitoCreds) -> int:
    if not creds.user_id:
        raise AvitoError("Авито не подключён: нажмите «Подключить» в настройках бота")
    return creds.user_id


async def get_self(creds: AvitoCreds) -> dict[str, Any]:
    return await _request(creds, "GET", "/core/v1/accounts/self")


async def list_items(creds: AvitoCreds, page: int, per_page: int = 50) -> list[dict[str, Any]]:
    data = await _request(creds, "GET", "/core/v1/items", params={
        "page": page, "per_page": per_page, "status": "active",
    })
    if not isinstance(data, dict) or not isinstance(data.get("resources"), list):
        raise AvitoError("Не удалось прочитать список объявлений Авито")
    return [item for item in data["resources"] if isinstance(item, dict)]


async def subscribe_webhook(creds: AvitoCreds, url: str) -> None:
    await _request(creds, "POST", "/messenger/v3/webhook", json={"url": url})


async def get_chat(creds: AvitoCreds, chat_id: str) -> dict[str, Any]:
    return await _request(creds, "GET", f"/messenger/v2/accounts/{_need_user(creds)}/chats/{chat_id}")


async def send_text(creds: AvitoCreds, chat_id: str, text: str) -> dict[str, Any]:
    return await _request(creds, "POST", f"/messenger/v1/accounts/{_need_user(creds)}/chats/{chat_id}/messages",
                          json={"message": {"text": text}, "type": "text"}, sending=True)


async def mark_read(creds: AvitoCreds, chat_id: str) -> None:
    try:
        await _request(creds, "POST", f"/messenger/v1/accounts/{_need_user(creds)}/chats/{chat_id}/read")
    except AvitoError:
        pass  # не критично


async def list_chats(creds: AvitoCreds, unread_only: bool = True, limit: int = 50) -> list[dict[str, Any]]:
    flag = "true" if unread_only else "false"
    data = await _request(creds, "GET", f"/messenger/v2/accounts/{_need_user(creds)}/chats?unread_only={flag}&chat_types=u2i&limit={limit}")
    return list((data or {}).get("chats") or [])


async def list_messages(creds: AvitoCreds, chat_id: str, limit: int = 20) -> list[dict[str, Any]]:
    data = await _request(creds, "GET", f"/messenger/v3/accounts/{_need_user(creds)}/chats/{chat_id}/messages/?limit={limit}")
    if isinstance(data, list):
        return data
    return list((data or {}).get("messages") or [])


def same_id(a: Any, b: Any) -> bool:
    """ID Авито приходят то числом, то строкой — сравниваем как строки."""
    return a is not None and b is not None and str(a) == str(b)


def chat_meta(chat: dict[str, Any], own_user_id: int | None) -> dict[str, Any]:
    """Объявление и ник покупателя из ответа get_chat."""
    meta: dict[str, Any] = {}
    ctx = (chat.get("context") or {}).get("value") or {}
    if ctx:
        meta["item_id"] = ctx.get("id")
        meta["item_title"] = (ctx.get("title") or "")[:300] or None
        meta["item_price"] = (ctx.get("price_string") or "")[:60] or None
        meta["item_url"] = (ctx.get("url") or "")[:500] or None
    for user in chat.get("users") or []:
        if same_id(user.get("id"), own_user_id):
            continue
        meta["client_name"] = (user.get("name") or "")[:120] or None
        try:
            meta["client_avito_id"] = int(user.get("id"))
        except (TypeError, ValueError):
            pass
        break
    if meta.get("item_id") is not None:
        try:
            meta["item_id"] = int(meta["item_id"])
        except (TypeError, ValueError):
            meta.pop("item_id")
    return meta
