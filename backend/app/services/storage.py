"""
StorageService — управляет физическим хранилищем файлов.

Структура папки static/:
  static/
    products/
      <product_uuid>/
        hero.webp          ← конвертированный оригинал
        hero_thumb.webp    ← миниатюра 320×320
    categories/
      <category_uuid>/
        icon.webp
    slides/
      <slide_uuid>/
        banner.webp
    misc/                  ← файлы без привязки к сущности

Правила:
- Все изображения конвертируются в WebP (качество 85)
- Автоматически генерируется thumbnail 320×320 (cover fit)
- Имена файлов — slug от оригинального названия + UUID-суффикс (без коллизий)
- Никакого path traversal: все пути валидируются
- Максимальный размер файла: 10 МБ
- Разрешённые MIME: image/jpeg, image/png, image/webp, image/gif
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from io import BytesIO
from pathlib import Path
from typing import NamedTuple

import aiofiles
from fastapi import HTTPException, UploadFile
from PIL import Image
from slugify import slugify

logger = logging.getLogger(__name__)

# ─── Константы ────────────────────────────────────────────────────────────────
MAX_FILE_SIZE     = 10 * 1024 * 1024   # 10 МБ
THUMBNAIL_SIZE    = (320, 320)         # px
MAIN_MAX_SIZE     = (1200, 1200)       # px — сжимаем слишком большие
WEBP_QUALITY      = 85
ALLOWED_MIME      = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_EXT       = {"jpg", "jpeg", "png", "webp", "gif"}

# Типы сущностей: имя папки
ENTITY_FOLDERS: dict[str, str] = {
    "product":  "products",
    "category": "categories",
    "slide":    "slides",
    "misc":     "misc",
}


class UploadResult(NamedTuple):
    """Результат загрузки файла."""
    url: str               # /static/products/<id>/hero.webp
    thumbnail_url: str     # /static/products/<id>/hero_thumb.webp
    filename: str          # hero.webp
    content_type: str      # image/webp
    size: int              # байт
    width: int
    height: int


class StorageService:
    """Сервис для работы с файлами. Инициализируется один раз при старте."""

    def __init__(self, static_dir: str | Path) -> None:
        self.static_dir = Path(static_dir).resolve()
        self.static_dir.mkdir(parents=True, exist_ok=True)
        logger.info("📂 Static dir: %s", self.static_dir)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def upload(
        self,
        file: UploadFile,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
    ) -> UploadResult:
        """
        Загружает файл, конвертирует в WebP, генерирует thumbnail.
        Возвращает UploadResult с публичным URL.
        """
        await self._validate_file(file)
        contents = await file.read()

        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"Файл слишком большой. Максимум {MAX_FILE_SIZE // 1024 // 1024} МБ")

        folder = self._resolve_folder(entity_type, entity_id)
        base_name = self._safe_stem(file.filename or "image")
        suffix = uuid.uuid4().hex[:8]

        # Конвертируем + сжимаем в фоновом потоке (CPU-bound)
        main_bytes, thumb_bytes, width, height = await asyncio.to_thread(
            self._process_image, contents
        )

        main_filename  = f"{base_name}_{suffix}.webp"
        thumb_filename = f"{base_name}_{suffix}_thumb.webp"

        main_path  = folder / main_filename
        thumb_path = folder / thumb_filename

        await self._write(main_path, main_bytes)
        await self._write(thumb_path, thumb_bytes)

        rel_main  = main_path.relative_to(self.static_dir)
        rel_thumb = thumb_path.relative_to(self.static_dir)

        result = UploadResult(
            url           = f"/static/{rel_main.as_posix()}",
            thumbnail_url = f"/static/{rel_thumb.as_posix()}",
            filename      = main_filename,
            content_type  = "image/webp",
            size          = len(main_bytes),
            width         = width,
            height        = height,
        )
        logger.info("✅ Uploaded %s → %s (thumb: %s)", file.filename, result.url, result.thumbnail_url)
        return result

    async def delete(self, url: str) -> bool:
        """
        Удаляет файл и его thumbnail по публичному URL.
        url должен начинаться с /static/
        Возвращает True если файл существовал.
        """
        if not url.startswith("/static/"):
            logger.warning("Попытка удалить файл вне /static/: %s", url)
            return False

        rel = url.removeprefix("/static/").lstrip("/")
        path = (self.static_dir / rel).resolve()

        # Path traversal guard
        if not str(path).startswith(str(self.static_dir) + os.sep):
            logger.error("Path traversal attempt: %s → %s", url, path)
            raise HTTPException(status_code=400, detail="Недопустимый путь файла")

        deleted = False
        if path.exists():
            path.unlink()
            deleted = True
            logger.info("🗑️  Deleted %s", path)

        # Пробуем удалить thumbnail (name_suffix_thumb.webp)
        stem = path.stem   # base_suffix
        thumb_path = path.with_name(f"{stem}_thumb.webp")
        # Если у нас путь уже thumb — пропускаем
        if "_thumb" not in stem and thumb_path.exists():
            thumb_path.unlink()
            logger.info("🗑️  Deleted thumb %s", thumb_path)

        return deleted

    async def list_entity_files(
        self, entity_type: str, entity_id: uuid.UUID
    ) -> list[str]:
        """Список URL всех файлов сущности (только основные, без thumb)."""
        folder = self._resolve_folder(entity_type, entity_id)
        if not folder.exists():
            return []
        urls = []
        for p in sorted(folder.iterdir()):
            if p.is_file() and "_thumb" not in p.stem:
                rel = p.relative_to(self.static_dir)
                urls.append(f"/static/{rel.as_posix()}")
        return urls

    # ── Internal ───────────────────────────────────────────────────────────────

    def _resolve_folder(
        self, entity_type: str, entity_id: uuid.UUID | None
    ) -> Path:
        top = ENTITY_FOLDERS.get(entity_type, "misc")
        if entity_id:
            folder = self.static_dir / top / str(entity_id)
        else:
            folder = self.static_dir / top / "unbound"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    @staticmethod
    def _safe_stem(filename: str) -> str:
        """Безопасное имя файла без расширения (slug)."""
        name = Path(filename).stem
        safe = slugify(name, max_length=60) or "image"
        return safe

    @staticmethod
    def _process_image(
        data: bytes,
    ) -> tuple[bytes, bytes, int, int]:
        """CPU-bound: конвертирует, ресайзит, возвращает (main, thumb, w, h)."""
        with Image.open(BytesIO(data)) as img:
            # EXIF-ориентация
            img = StorageService._fix_orientation(img)
            # Конвертируем GIF → первый кадр
            if img.format == "GIF":
                img.seek(0)
            # Обязательно RGB/RGBA для WebP
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA")

            width, height = img.size

            # ── Main image: сжать если слишком большой ────────────────────────
            main_img = img.copy()
            main_img.thumbnail(MAIN_MAX_SIZE, Image.LANCZOS)
            main_width, main_height = main_img.size
            main_buf = BytesIO()
            main_img.save(main_buf, format="WEBP", quality=WEBP_QUALITY, method=6)
            main_bytes = main_buf.getvalue()

            # ── Thumbnail: cover-fit 320×320 ──────────────────────────────────
            thumb_img = img.copy()
            thumb_img = StorageService._cover_fit(thumb_img, THUMBNAIL_SIZE)
            thumb_buf = BytesIO()
            thumb_img.save(thumb_buf, format="WEBP", quality=75, method=6)
            thumb_bytes = thumb_buf.getvalue()

        return main_bytes, thumb_bytes, main_width, main_height

    @staticmethod
    def _fix_orientation(img: Image.Image) -> Image.Image:
        """Поворачиваем по EXIF (JPEGs с телефона)."""
        try:
            from PIL.ExifTags import TAGS
            exif = img.getexif()
            if exif:
                for tag, value in exif.items():
                    if TAGS.get(tag) == "Orientation":
                        rotations = {3: 180, 6: 270, 8: 90}
                        if value in rotations:
                            img = img.rotate(rotations[value], expand=True)
                        break
        except Exception:
            pass
        return img

    @staticmethod
    def _cover_fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
        """Обрезает по центру до нужного размера (cover)."""
        target_w, target_h = size
        orig_w, orig_h = img.size

        # Масштабируем так чтобы обе стороны >= target
        ratio = max(target_w / orig_w, target_h / orig_h)
        new_w = int(orig_w * ratio)
        new_h = int(orig_h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

        # Центрируем и обрезаем
        left   = (new_w - target_w) // 2
        top    = (new_h - target_h) // 2
        right  = left + target_w
        bottom = top  + target_h
        return img.crop((left, top, right, bottom))

    @staticmethod
    async def _validate_file(file: UploadFile) -> None:
        """Проверяем MIME и расширение."""
        if file.content_type not in ALLOWED_MIME:
            raise HTTPException(
                status_code=415,
                detail=f"Недопустимый MIME-тип: {file.content_type}. Разрешены: {', '.join(sorted(ALLOWED_MIME))}",
            )
        ext = Path(file.filename or "").suffix.lstrip(".").lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(
                status_code=415,
                detail=f"Недопустимое расширение .{ext}. Разрешены: {', '.join(sorted(ALLOWED_EXT))}",
            )

    @staticmethod
    async def _write(path: Path, data: bytes) -> None:
        async with aiofiles.open(path, "wb") as f:
            await f.write(data)


# ─── Singleton ────────────────────────────────────────────────────────────────
# Будет инициализирован в lifespan (main.py) после того как станет известна
# настройка STATIC_DIR из config.
_storage: StorageService | None = None


def get_storage() -> StorageService:
    if _storage is None:
        raise RuntimeError("StorageService не инициализирован. Вызовите init_storage() при старте приложения.")
    return _storage


def init_storage(static_dir: str | Path) -> StorageService:
    global _storage
    _storage = StorageService(static_dir)
    return _storage

