"""
Media API — загрузка и управление медиафайлами.

POST   /api/admin/media/upload                     — загрузить файл (admin)
GET    /api/admin/media/{entity_type}/{entity_id}  — список файлов сущности (admin)
DELETE /api/admin/media/{media_id}                 — удалить файл (admin)
PATCH  /api/admin/media/{media_id}/primary         — сделать главным (admin)
PATCH  /api/admin/media/{media_id}/sort            — изменить порядок (admin)
PATCH  /api/admin/media/{media_id}/alt             — изменить alt-текст (admin)

GET    /api/media/{entity_type}/{entity_id}        — публичный список файлов сущности
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import admin_required, db_session
from ...models.media import MediaFile
from ...repositories.media import MediaRepository
from ...schemas.media import (
    MediaFileAltText,
    MediaFileRead,
    MediaFileSortOrder,
    MediaFileSetPrimary,
    ALLOWED_ENTITY_TYPES,
)
from ...services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media"])


def _validate_entity_type(entity_type: str) -> str:
    if entity_type not in ALLOWED_ENTITY_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Недопустимый entity_type '{entity_type}'. Разрешены: {', '.join(sorted(ALLOWED_ENTITY_TYPES))}",
        )
    return entity_type


# ─── Upload ───────────────────────────────────────────────────────────────────

@router.post(
    "/api/admin/media/upload",
    response_model=MediaFileRead,
    status_code=201,
    summary="Upload media file",
    description="""
Upload an image for a specific entity (product, category, slide, misc).

- Автоматически конвертируется в **WebP** (quality 85)
- Генерируется **thumbnail 320×320** (WebP)
- Максимальный размер: **10 МБ**
- Разрешены: JPG, PNG, WebP, GIF
- Файлы сохраняются в `static/{entity_type}/{entity_id}/`

В БД записывается только URL — файлы доступны по `/static/...`
""",
)
async def upload_media(
    file: UploadFile = File(..., description="Изображение (JPG/PNG/WebP/GIF, макс. 10 МБ)"),
    entity_type: str = Form(..., description="Тип сущности: product | category | slide | misc"),
    entity_id: str | None = Form(None, description="UUID сущности (необязательно для misc)"),
    alt_text: str | None = Form(None, description="Alt-текст для SEO/доступности"),
    is_primary: bool = Form(False, description="Сделать главным фото"),
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> MediaFileRead:
    _validate_entity_type(entity_type)

    parsed_entity_id: uuid.UUID | None = None
    if entity_id:
        try:
            parsed_entity_id = uuid.UUID(entity_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Некорректный entity_id: {entity_id}")

    storage = get_storage()
    result = await storage.upload(file, entity_type, parsed_entity_id)

    # Если is_primary — сбрасываем предыдущее главное фото
    if is_primary and parsed_entity_id:
        await db.execute(
            update(MediaFile)
            .where(MediaFile.entity_type == entity_type, MediaFile.entity_id == parsed_entity_id)
            .values(is_primary=False)
        )

    media = await MediaRepository.create(db, {
        "entity_type":       entity_type,
        "entity_id":         parsed_entity_id,
        "url":               result.url,
        "thumbnail_url":     result.thumbnail_url,
        "original_filename": file.filename or "image",
        "filename":          result.filename,
        "content_type":      result.content_type,
        "size":              result.size,
        "width":             result.width,
        "height":            result.height,
        "is_primary":        is_primary,
        "sort_order":        0,
        "alt_text":          alt_text,
    })

    logger.info(
        "Media uploaded: id=%s entity=%s:%s url=%s",
        media.id, entity_type, parsed_entity_id, result.url,
    )
    return MediaFileRead.model_validate(media)


# ─── List (admin) ─────────────────────────────────────────────────────────────

@router.get(
    "/api/admin/media/{entity_type}/{entity_id}",
    response_model=list[MediaFileRead],
    summary="List media files for entity (admin)",
)
async def list_media_admin(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> list[MediaFileRead]:
    _validate_entity_type(entity_type)
    files = await MediaRepository.list_for_entity(db, entity_type, entity_id)
    return [MediaFileRead.model_validate(f) for f in files]


# ─── List (public) ────────────────────────────────────────────────────────────

@router.get(
    "/api/media/{entity_type}/{entity_id}",
    response_model=list[MediaFileRead],
    summary="List media files for entity (public)",
    description="Публичный список медиафайлов сущности (для отображения на фронте).",
)
async def list_media_public(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
) -> list[MediaFileRead]:
    _validate_entity_type(entity_type)
    files = await MediaRepository.list_for_entity(db, entity_type, entity_id)
    return [MediaFileRead.model_validate(f) for f in files]


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete(
    "/api/admin/media/{media_id}",
    status_code=204,
    summary="Delete media file (admin)",
    description="Удаляет запись из БД и физический файл + thumbnail с диска.",
)
async def delete_media(
    media_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> None:
    media = await MediaRepository.get_by_id(db, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    storage = get_storage()
    await storage.delete(media.url)
    if media.thumbnail_url:
        await storage.delete(media.thumbnail_url)

    await MediaRepository.delete(db, media)
    logger.info("Media deleted: id=%s url=%s", media_id, media.url)


# ─── Set primary ──────────────────────────────────────────────────────────────

@router.patch(
    "/api/admin/media/{media_id}/primary",
    response_model=MediaFileRead,
    summary="Set file as primary (admin)",
    description="Устанавливает файл как главное фото сущности. Сбрасывает предыдущее.",
)
async def set_primary_media(
    media_id: uuid.UUID,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> MediaFileRead:
    media = await MediaRepository.get_by_id(db, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")
    if not media.entity_id:
        raise HTTPException(status_code=400, detail="Файл не привязан к сущности")

    await MediaRepository.set_primary(db, media.entity_type, media.entity_id, media_id)
    updated = await MediaRepository.get_by_id(db, media_id)
    return MediaFileRead.model_validate(updated)


# ─── Sort order ───────────────────────────────────────────────────────────────

@router.patch(
    "/api/admin/media/{media_id}/sort",
    response_model=MediaFileRead,
    summary="Update sort order (admin)",
)
async def update_sort_order(
    media_id: uuid.UUID,
    body: MediaFileSortOrder,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> MediaFileRead:
    media = await MediaRepository.get_by_id(db, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    updated = await MediaRepository.update_sort_order(db, media_id, body.sort_order)
    return MediaFileRead.model_validate(updated)


# ─── Alt text ─────────────────────────────────────────────────────────────────

@router.patch(
    "/api/admin/media/{media_id}/alt",
    response_model=MediaFileRead,
    summary="Update alt text (admin)",
)
async def update_alt_text(
    media_id: uuid.UUID,
    body: MediaFileAltText,
    db: AsyncSession = Depends(db_session),
    _: dict = admin_required,
) -> MediaFileRead:
    media = await MediaRepository.get_by_id(db, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    await db.execute(
        update(MediaFile).where(MediaFile.id == media_id).values(alt_text=body.alt_text)
    )
    await db.commit()
    updated = await MediaRepository.get_by_id(db, media_id)
    return MediaFileRead.model_validate(updated)
