"""
S3-based static file service (Timeweb S3-compatible storage).

Replaces the old local-disk StaticFileService.
Files are uploaded to S3 bucket and served via public URLs.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from fastapi import HTTPException, UploadFile, status

from src.app.core.config import settings
from src.app.core.logger import get_logger

logger = get_logger(__name__)


def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=BotoConfig(s3={"addressing_style": "path"}),
    )


class StaticFileService:
    """
    S3-backed file storage service.

    Bucket structure:
        products/{product_id}/{uuid}.jpg
        categories/{category_id}/{uuid}.webp
        slides/{slide_id}/{uuid}.png
    """

    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = _get_s3_client()
        return self._client

    # ------------------------------------------------------------------ #
    #  Public interface                                                    #
    # ------------------------------------------------------------------ #

    async def save_product_image(
        self, file: UploadFile, product_id: uuid.UUID,
    ) -> tuple[str, int]:
        content = await self._validate_and_read(file)
        key = self._make_key(settings.PRODUCTS_IMAGES_DIR, str(product_id), file.filename or "")
        self._upload(key, content, file.content_type or "image/jpeg")
        logger.info("product_image_saved_s3", product_id=str(product_id), key=key, size=len(content))
        return key, len(content)

    async def save_category_image(
        self, file: UploadFile, category_id: uuid.UUID,
    ) -> tuple[str, int]:
        content = await self._validate_and_read(file)
        key = self._make_key(settings.CATEGORIES_IMAGES_DIR, str(category_id), file.filename or "")
        self._upload(key, content, file.content_type or "image/jpeg")
        logger.info("category_image_saved_s3", category_id=str(category_id), key=key, size=len(content))
        return key, len(content)

    async def save_slide_image(
        self, file: UploadFile, slide_id: uuid.UUID,
    ) -> tuple[str, int]:
        content = await self._validate_and_read(file)
        key = self._make_key(settings.SLIDES_IMAGES_DIR, str(slide_id), file.filename or "")
        self._upload(key, content, file.content_type or "image/jpeg")
        logger.info("slide_image_saved_s3", slide_id=str(slide_id), key=key, size=len(content))
        return key, len(content)

    async def delete_file(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
            logger.info("file_deleted_s3", key=key)
            return True
        except Exception as exc:
            logger.warning("file_delete_failed_s3", key=key, error=str(exc))
            return False

    def _bare_key(self, value: str) -> str | None:
        """Приводит значение к «голому» S3-ключу (products/abc/def.jpg).
        Понимает полный S3-URL нашего бакета и legacy /static/. Внешний http-URL
        (не наш бакет) → None (его не трогаем)."""
        v = (value or "").strip()
        if not v:
            return None
        # Уже НАША прокси-ссылка (/api/media?key=...) — возможно вложенная (двойная).
        # Рекурсивно достаём настоящий ключ → build_url становится идемпотентным, а из
        # «битых» двойных URL фото всё равно отдаётся. (Двойной прокси возникал из-за
        # повторной валидации схемы в _build_detail.)
        low = v.lstrip("/")
        if low.startswith("api/media") or low.startswith("api/v1/media"):
            from urllib.parse import urlparse, parse_qs, unquote
            inner = (parse_qs(urlparse("/" + low).query).get("key") or [""])[0]
            return self._bare_key(unquote(inner)) if inner else None
        if v.startswith("http"):
            marker = f"/{settings.S3_BUCKET_NAME}/"
            idx = v.find(marker)
            if idx != -1:
                return v[idx + len(marker):]
            if settings.S3_PUBLIC_URL:
                base = settings.S3_PUBLIC_URL.rstrip("/") + "/"
                if v.startswith(base):
                    return v[len(base):]
            return None  # чужой URL — оставить как есть
        if v.startswith("/static/"):
            v = v[len("/static/"):]
        return v.lstrip("/")

    def build_url(self, key: str) -> str:
        """
        Build public URL for an S3 object.
        Example: "products/abc/def.jpg"
          → "https://s3.twcstorage.ru/<bucket>/products/abc/def.jpg"
        При IMAGE_PROXY=true → относительный «/api/media?key=products/abc/def.jpg»
        (раздаётся нашим бэкендом — доступно из-за рубежа, в отличие от S3).
        Ключ передаём query-параметром, а НЕ в пути: prod-nginx перехватывает любые
        пути с расширениями картинок (.webp/.jpg) и отдаёт как статику с диска (404),
        не доходя до бэкенда. Путь «/api/media» без расширения он пропускает.
        """
        bare = self._bare_key(key)
        if bare is None:
            return key  # внешний URL — без изменений
        if settings.IMAGE_PROXY:
            from urllib.parse import quote
            return f"/api/media?key={quote(bare, safe='/')}"
        if settings.S3_PUBLIC_URL:
            base = settings.S3_PUBLIC_URL.rstrip("/")
        else:
            base = f"{settings.S3_ENDPOINT_URL}/{settings.S3_BUCKET_NAME}"
        return f"{base}/{bare}"

    def build_url_or_none(self, key: str | None) -> str | None:
        if not key:
            return None
        return self.build_url(key)

    def fetch_object(self, key: str) -> tuple[bytes, str] | tuple[None, None]:
        """Скачивает объект из S3 (для прокси /api/media). (bytes, content_type) или (None, None)."""
        bare = self._bare_key(key)
        if not bare:
            return None, None
        try:
            obj = self.client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=bare)
            return obj["Body"].read(), obj.get("ContentType") or "application/octet-stream"
        except Exception as exc:  # noqa: BLE001
            logger.warning("s3_fetch_failed", key=bare, error=str(exc)[:160])
            return None, None

    # ------------------------------------------------------------------ #
    #  Private                                                             #
    # ------------------------------------------------------------------ #

    def _make_key(self, prefix: str, entity_id: str, original_filename: str) -> str:
        ext = Path(original_filename).suffix.lower() or ".jpg"
        filename = f"{uuid.uuid4()}{ext}"
        return f"{prefix}/{entity_id}/{filename}"

    def _upload(self, key: str, content: bytes, content_type: str) -> None:
        try:
            self.client.put_object(
                Bucket=settings.S3_BUCKET_NAME,
                Key=key,
                Body=content,
                ContentType=content_type,
                ACL="public-read",
            )
        except Exception as exc:
            logger.error("s3_upload_failed", key=key, error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ошибка загрузки файла в S3: {exc}",
            )

    async def _validate_and_read(self, file: UploadFile) -> bytes:
        if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Недопустимый тип файла: {file.content_type!r}. Разрешены: {', '.join(settings.ALLOWED_IMAGE_TYPES)}",
            )
        content = await file.read()
        if len(content) > settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = settings.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Файл превышает {max_mb:.0f} МБ.",
            )
        self._validate_magic_bytes(content, file.content_type)
        return content

    @staticmethod
    def _validate_magic_bytes(content: bytes, mime_type: str) -> None:
        signatures: dict[str, list[bytes]] = {
            "image/jpeg": [b"\xff\xd8\xff"],
            "image/png":  [b"\x89PNG\r\n\x1a\n"],
            "image/webp": [b"RIFF"],
        }
        allowed_sigs = signatures.get(mime_type, [])
        if not allowed_sigs:
            return
        if not any(content.startswith(sig) for sig in allowed_sigs):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Содержимое файла не соответствует заявленному типу.",
            )


# Singleton
static_service = StaticFileService()
