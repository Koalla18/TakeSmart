"""
Страница GTA VI (/gta6 на витрине): рассказ об игре и подборка PlayStation 5,
к которым магазин дарит игру. Состав подборки и показ на сайте задаются в
админке; всё хранится одним JSON в site_settings — без отдельной таблицы.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import ValidationError

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.gta6 import IMAGE_SLOTS, MAX_PRODUCTS, Gta6Config, Gta6ImageOut, Gta6PageOut
from src.app.schemas.product import ProductOut

logger = get_logger(__name__)
router = APIRouter(prefix="/gta6", tags=["GTA VI"])

ADMIN = [Depends(get_current_admin)]
CONFIG_KEY = "gta6_config"
# Картинки страницы складываются в S3 под одним постоянным «владельцем»
IMAGES_OWNER = uuid.UUID("6a7a6000-0000-4000-8000-000000000006")


def parse_config(raw: Any) -> Gta6Config:
    if not isinstance(raw, dict):
        return Gta6Config()
    try:
        return Gta6Config(**raw)
    except ValidationError:
        logger.warning("gta6_config_invalid")
        return Gta6Config()


async def _config(uow: UnitOfWork) -> Gta6Config:
    return parse_config(await uow.site_settings.get(CONFIG_KEY))


async def _save(uow: UnitOfWork, cfg: Gta6Config) -> None:
    await uow.site_settings.set(CONFIG_KEY, cfg.model_dump(mode="json"))


@router.get(
    "",
    response_model=Gta6PageOut,
    summary="Страница GTA VI (публичная)",
    description=(
        "Настройки страницы и активные товары подборки в порядке, заданном в админке. "
        "Отдаётся и при `enabled=false` — так сотрудник видит черновик по ссылке с ?preview=1; "
        "покупателям сайт страницу в этом случае не показывает."
    ),
)
async def get_page() -> Gta6PageOut:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        found = await uow.products.get_by_ids(cfg.product_ids)
        by_id = {p.id: p for p in found}
        products = [
            ProductOut.model_validate(by_id[pid])
            for pid in cfg.product_ids
            if pid in by_id and by_id[pid].is_active
        ]
    return Gta6PageOut(
        enabled=cfg.enabled,
        gift_enabled=cfg.gift_enabled,
        gift_title=cfg.gift_title,
        gift_text=cfg.gift_text,
        trailer_url=cfg.trailer_url,
        images={slot: static_service.build_url(url) for slot, url in cfg.images.items()},
        products=products,
    )


@router.get("/settings", response_model=Gta6Config, dependencies=ADMIN, summary="Настройки страницы GTA VI")
async def get_settings() -> Gta6Config:
    async with UnitOfWork() as uow:
        return await _config(uow)


@router.put("/settings", response_model=Gta6Config, dependencies=ADMIN, summary="Сохранить настройки страницы GTA VI")
async def put_settings(body: Gta6Config) -> Gta6Config:
    async with UnitOfWork() as uow:
        current = await _config(uow)
        # Картинки меняются только загрузкой/удалением по слоту — сохранение формы их не трогает
        body.images = current.images
        found = await uow.products.get_by_ids(body.product_ids)
        known = {p.id for p in found}
        body.product_ids = [pid for pid in body.product_ids if pid in known]
        await _save(uow, body)
        await uow.commit()
    logger.info("gta6_config_updated", enabled=body.enabled, products=len(body.product_ids))
    return body


@router.post(
    "/products/{product_id}",
    response_model=Gta6Config,
    dependencies=ADMIN,
    summary="Добавить товар на страницу GTA VI",
    description="Ставит товар в конец подборки. Если он уже там — ничего не меняет.",
)
async def add_product(product_id: uuid.UUID) -> Gta6Config:
    async with UnitOfWork() as uow:
        if await uow.products.get_by_id(product_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Товар не найден")
        cfg = await _config(uow)
        if product_id not in cfg.product_ids:
            if len(cfg.product_ids) >= MAX_PRODUCTS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"В подборке уже {MAX_PRODUCTS} товаров — больше нельзя")
            cfg.product_ids = [*cfg.product_ids, product_id]
            await _save(uow, cfg)
            await uow.commit()
    logger.info("gta6_product_added", product_id=str(product_id))
    return cfg


def _check_slot(slot: str) -> None:
    if slot not in IMAGE_SLOTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Нет такого места под картинку: '{slot}'")


@router.post(
    "/images/{slot}",
    response_model=Gta6ImageOut,
    dependencies=ADMIN,
    summary="Загрузить картинку в блок страницы",
)
async def upload_image(
    slot: str,
    file: UploadFile = File(..., description="Изображение (JPEG / PNG / WebP, макс. 5 МБ)"),
) -> Gta6ImageOut:
    _check_slot(slot)
    key, _ = await static_service.save_slide_image(file, IMAGES_OWNER)
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        cfg.images = {**cfg.images, slot: key}
        await _save(uow, cfg)
        await uow.commit()
    logger.info("gta6_image_uploaded", slot=slot)
    return Gta6ImageOut(slot=slot, url=static_service.build_url(key))


@router.delete(
    "/images/{slot}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=ADMIN,
    summary="Убрать картинку из блока (вернётся стандартное оформление)",
)
async def delete_image(slot: str) -> None:
    _check_slot(slot)
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        if slot in cfg.images:
            cfg.images = {k: v for k, v in cfg.images.items() if k != slot}
            await _save(uow, cfg)
            await uow.commit()
    logger.info("gta6_image_removed", slot=slot)
