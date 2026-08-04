"""
Прокси картинок: GET /media?key=<s3-key> → отдаёт объект из S3 через наш домен.

Зачем: российский S3 (s3.twcstorage.ru) недоступен из-за рубежа/через VPN, а
takesmart.ru доступен везде. Когда IMAGE_PROXY=true, все ссылки на картинки
строятся как /api/media?key=<key> и идут сюда. Бэкенд (в РФ) спокойно тянет из S3
и отдаёт клиенту с длинным кэшем. Только чтение, только наш бакет (без SSRF).

ВАЖНО: ключ — query-параметр, а НЕ часть пути. Prod-nginx перехватывает любые
пути с расширениями картинок (.webp/.jpg) и отдаёт как статику (404), не доходя до
бэкенда. Путь «/api/media» без расширения он пропускает на бэкенд.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from src.app.core.static_service import static_service

router = APIRouter(prefix="/media", tags=["Media"])

# Ключи иммутабельны (uuid в имени) — можно кэшировать надолго.
_CACHE = "public, max-age=31536000, immutable"


@router.get("", summary="Отдать картинку из S3 через наш домен")
async def get_media(
    key: str = Query(..., description="S3-ключ объекта, напр. products/<id>/<uuid>.webp"),
    bucket: str | None = Query(None, description="Разрешённый bucket для старых ссылок"),
) -> Response:
    data, content_type = await run_in_threadpool(static_service.fetch_object, key, bucket)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": _CACHE})
