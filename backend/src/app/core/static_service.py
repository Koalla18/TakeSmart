from __future__ import annotations

import uuid
from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile, status

from src.app.core.config import settings
from src.app.core.logger import get_logger

logger = get_logger(__name__)


class StaticFileService:
    """
    Сервис для сохранения, валидации и удаления файлов из static/.

    Структура на диске:
        static/
          products/
            {product_id}/       ← папка конкретного товара
              {uuid}.webp
              {uuid}.jpg
          categories/
            {category_id}/
              {uuid}.webp
    """

    # ------------------------------------------------------------------ #
    #  Публичный интерфейс                                                 #
    # ------------------------------------------------------------------ #

    async def save_product_image(
        self,
        file: UploadFile,
        product_id: uuid.UUID,
    ) -> tuple[str, int]:
        logger.debug(
            "saving_product_image",
            product_id=str(product_id),
            filename=file.filename,
            content_type=file.content_type,
        )
        content = await self._validate_and_read(file)
        subfolder = Path(settings.PRODUCTS_IMAGES_DIR) / str(product_id)
        relative_path = await self._save(content, file.filename or "", subfolder)
        logger.info(
            "product_image_saved",
            product_id=str(product_id),
            path=relative_path,
            size_bytes=len(content),
        )
        return relative_path, len(content)

    async def save_category_image(
        self,
        file: UploadFile,
        category_id: uuid.UUID,
    ) -> tuple[str, int]:
        logger.debug(
            "saving_category_image",
            category_id=str(category_id),
            filename=file.filename,
            content_type=file.content_type,
        )
        content = await self._validate_and_read(file)
        subfolder = Path(settings.CATEGORIES_IMAGES_DIR) / str(category_id)
        relative_path = await self._save(content, file.filename or "", subfolder)
        logger.info(
            "category_image_saved",
            category_id=str(category_id),
            path=relative_path,
            size_bytes=len(content),
        )
        return relative_path, len(content)

    async def delete_file(self, relative_path: str) -> bool:
        abs_path = settings.STATIC_DIR / relative_path
        if abs_path.exists() and abs_path.is_file():
            abs_path.unlink()
            try:
                abs_path.parent.rmdir()
            except OSError:
                pass
            logger.info("file_deleted", path=relative_path)
            return True
        logger.warning("file_not_found_on_delete", path=relative_path)
        return False

    def build_url(self, relative_path: str) -> str:
        """
        Строит публичный URL файла в виде абсолютного URL-пути (без хоста).
        Браузер резолвит относительно origin → nginx проксирует на бэкенд.

        Пример: "products/abc/def.jpg"  →  "/static/products/abc/def.jpg"
        """
        return f"{settings.STATIC_URL}/{relative_path}"

    def build_url_or_none(self, relative_path: str | None) -> str | None:
        if not relative_path:
            return None
        return self.build_url(relative_path)

    # ------------------------------------------------------------------ #
    #  Приватные методы                                                    #
    # ------------------------------------------------------------------ #

    async def _validate_and_read(self, file: UploadFile) -> bytes:
        """Проверяет MIME-тип и размер файла, возвращает байты."""
        # 1. Проверяем MIME
        if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
            logger.warning(
                "invalid_mime_type",
                filename=file.filename,
                content_type=file.content_type,
            )
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"Недопустимый тип файла: {file.content_type!r}. "
                    f"Разрешены: {', '.join(settings.ALLOWED_IMAGE_TYPES)}"
                ),
            )

        # 2. Читаем содержимое
        content = await file.read()

        # 3. Проверяем размер
        if len(content) > settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = settings.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            logger.warning(
                "file_too_large",
                filename=file.filename,
                size_bytes=len(content),
                max_bytes=settings.MAX_UPLOAD_SIZE_BYTES,
            )
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Файл превышает максимально допустимый размер {max_mb:.0f} МБ.",
            )

        # 4. Дополнительно проверяем сигнатуру байт (magic bytes)
        self._validate_magic_bytes(content, file.content_type)

        return content

    @staticmethod
    def _validate_magic_bytes(content: bytes, mime_type: str) -> None:
        """
        Защита от подмены расширения: проверяем первые байты файла.
        Злоумышленник может назвать exe-файл 'image.jpg' —
        эта проверка это поймает.
        """
        signatures: dict[str, list[bytes]] = {
            "image/jpeg": [b"\xff\xd8\xff"],
            "image/png":  [b"\x89PNG\r\n\x1a\n"],
            "image/webp": [b"RIFF"],  # RIFF....WEBP
        }
        allowed_sigs = signatures.get(mime_type, [])
        if not allowed_sigs:
            return  # неизвестный тип — пропустим (уже проверен выше)

        if not any(content.startswith(sig) for sig in allowed_sigs):
            logger.warning("magic_bytes_mismatch", mime_type=mime_type)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Содержимое файла не соответствует заявленному типу.",
            )

    async def _save(
        self,
        content: bytes,
        original_filename: str,
        subfolder: Path,
    ) -> str:
        """
        Сохраняет байты в файл, возвращает относительный путь.
        Имя файла генерируется как UUID + расширение оригинала.
        """
        ext = Path(original_filename).suffix.lower() or ".jpg"
        filename = f"{uuid.uuid4()}{ext}"

        abs_dir = settings.STATIC_DIR / subfolder
        abs_dir.mkdir(parents=True, exist_ok=True)

        abs_path = abs_dir / filename

        async with aiofiles.open(abs_path, "wb") as f:
            await f.write(content)

        relative_path = str(subfolder / filename).replace("\\", "/")
        logger.debug("file_written_to_disk", path=relative_path)
        return relative_path


# Синглтон — один экземпляр на всё приложение
static_service = StaticFileService()
