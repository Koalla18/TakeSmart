from __future__ import annotations

import os
import uuid

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from ...api.deps import admin_required
from ...core.config import settings

router = APIRouter(prefix="/api/admin", tags=["uploads"])


@router.post("/upload", summary="Upload image (admin)")
async def upload_file(
    file: UploadFile = File(...),
    _: dict = admin_required,
) -> dict:
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Недопустимый формат файла. Разрешены: JPG, PNG, WebP, GIF",
        )

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой. Максимум 10MB")

    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", settings.uploads_dir)
    uploads_dir = os.path.abspath(uploads_dir)
    os.makedirs(uploads_dir, exist_ok=True)

    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(uploads_dir, filename)

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(contents)

    return {"url": f"/{settings.uploads_dir}/{filename}", "filename": filename}


@router.delete("/upload/{filename}", summary="Delete uploaded file (admin)")
async def delete_uploaded_file(
    filename: str,
    _: dict = admin_required,
) -> dict:
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", settings.uploads_dir)
    uploads_dir = os.path.abspath(uploads_dir)
    filepath = os.path.join(uploads_dir, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return {"ok": True}
    raise HTTPException(status_code=404, detail="File not found")

