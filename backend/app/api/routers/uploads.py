from __future__ import annotations

import os
import re
import uuid

import aiofiles
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, Query

from ...api.deps import admin_required
from ...core.config import settings

router = APIRouter(prefix="/api/admin", tags=["uploads"])

# Map category slugs to folder names used in frontend/public/products/
CATEGORY_FOLDER_MAP: dict[str, str] = {
    "smartphones": "phone",
    "laptops": "PC",
    "tablets": "tablets",
    "headphones": "headphones",
    "watches": "smart bands",
    "accessories": "tag",
    "gaming": "portative console",
    "used": "used",
}

# Path to frontend/public/products/ — resolved relative to backend root
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PRODUCTS_PUBLIC_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "frontend", "public", "products"))


def _slugify(text: str) -> str:
    """Convert brand/product name to a slug-safe folder/filename component."""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


@router.post("/upload", summary="Upload image (admin)")
async def upload_file(
    file: UploadFile = File(...),
    category_slug: str | None = Form(None),
    brand: str | None = Form(None),
    product_name: str | None = Form(None),
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

    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"

    # ── Smart folder routing ──
    # When category_slug and brand are provided, save into
    # frontend/public/products/{category_folder}/{brand}/{product-slug}.{ext}
    if category_slug and brand:
        category_folder = CATEGORY_FOLDER_MAP.get(category_slug, _slugify(category_slug))
        brand_folder = _slugify(brand)

        # Build product-based filename (readable, not UUID)
        if product_name:
            base_name = _slugify(product_name)
        else:
            # Fallback: use original filename without extension
            original_name = ".".join(file.filename.split(".")[:-1]) if "." in file.filename else file.filename
            base_name = _slugify(original_name)

        target_dir = os.path.join(PRODUCTS_PUBLIC_DIR, category_folder, brand_folder)
        os.makedirs(target_dir, exist_ok=True)

        filename = f"{base_name}.{ext}"
        filepath = os.path.join(target_dir, filename)

        # Avoid overwriting: append counter if file exists
        counter = 1
        while os.path.exists(filepath):
            filename = f"{base_name}-{counter}.{ext}"
            filepath = os.path.join(target_dir, filename)
            counter += 1

        async with aiofiles.open(filepath, "wb") as f:
            await f.write(contents)

        url = f"/products/{category_folder}/{brand_folder}/{filename}"
        return {"url": url, "filename": filename, "path": f"{category_folder}/{brand_folder}/{filename}"}

    # ── Fallback: legacy flat uploads/ directory ──
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", settings.uploads_dir)
    uploads_dir = os.path.abspath(uploads_dir)
    os.makedirs(uploads_dir, exist_ok=True)

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

