"""
Прокси картинок: GET /media/<s3-key> → отдаёт объект из S3 через наш домен.

Зачем: российский S3 (s3.twcstorage.ru) недоступен из-за рубежа/через VPN, а
takesmart.ru доступен везде. Когда IMAGE_PROXY=true, все ссылки на картинки
строятся как /api/media/<key> и идут сюда. Бэкенд (в РФ) спокойно тянет из S3 и
отдаёт клиенту с длинным кэшем. Только чтение, только наш бакет (без SSRF).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from src.app.core.static_service import static_service

router = APIRouter(prefix="/media", tags=["Media"])

# Ключи иммутабельны (uuid в имени) — можно кэшировать надолго.
_CACHE = "public, max-age=31536000, immutable"


@router.get("/{key:path}", summary="Отдать картинку из S3 через наш домен")
async def get_media(key: str) -> Response:
    data, content_type = await run_in_threadpool(static_service.fetch_object, key)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": _CACHE})
