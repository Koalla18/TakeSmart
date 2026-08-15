from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, UploadFile, File, status, Depends
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.hero_banner import HeroBannerCreate, HeroBannerOut, HeroBannerUpdate

logger = get_logger(__name__)

router = APIRouter(prefix="/hero-banners", tags=["Hero Banners"])


@router.get("", response_model=list[HeroBannerOut], summary="Активные баннеры лендинга")
async def list_hero_banners() -> list[HeroBannerOut]:
    async with UnitOfWork() as uow:
        banners = await uow.hero_banners.get_active()
    return list(banners)


@router.get("/all", response_model=list[HeroBannerOut], summary="Все баннеры (для админки)", dependencies=[Depends(get_current_admin)])
async def list_all_hero_banners() -> list[HeroBannerOut]:
    async with UnitOfWork() as uow:
        banners = await uow.hero_banners.get_all_sorted(limit=100)
    return list(banners)


@router.post(
    "",
    response_model=HeroBannerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать баннер",
    dependencies=[Depends(get_current_admin)],
)
async def create_hero_banner(body: HeroBannerCreate) -> HeroBannerOut:
    async with UnitOfWork() as uow:
        banner = await uow.hero_banners.create(**body.model_dump())
        await uow.commit()
        await uow.hero_banners.session.refresh(banner)
    logger.info("hero_banner_created", banner_id=str(banner.id), title=banner.title)
    return banner


@router.patch(
    "/{banner_id}",
    response_model=HeroBannerOut,
    summary="Обновить баннер",
    responses={404: {"description": "Баннер не найден"}},
    dependencies=[Depends(get_current_admin)],
)
async def update_hero_banner(banner_id: UUID, body: HeroBannerUpdate) -> HeroBannerOut:
    async with UnitOfWork() as uow:
        banner = await uow.hero_banners.get_by_id(banner_id)
        if not banner:
            raise HTTPException(status_code=404, detail=f"Баннер {banner_id} не найден")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(banner, field, value)
        await uow.commit()
        await uow.hero_banners.session.refresh(banner)
    logger.info("hero_banner_updated", banner_id=str(banner_id))
    return banner


@router.delete(
    "/{banner_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Удалить баннер",
    responses={404: {"description": "Баннер не найден"}},
    dependencies=[Depends(get_current_admin)],
)
async def delete_hero_banner(banner_id: UUID) -> None:
    async with UnitOfWork() as uow:
        banner = await uow.hero_banners.get_by_id(banner_id)
        if not banner:
            raise HTTPException(status_code=404, detail=f"Баннер {banner_id} не найден")
        await uow.hero_banners.session.delete(banner)
        await uow.commit()
    logger.info("hero_banner_deleted", banner_id=str(banner_id))


@router.post(
    "/{banner_id}/image",
    summary="Загрузить изображение баннера",
    responses={404: {"description": "Баннер не найден"}},
    dependencies=[Depends(get_current_admin)],
)
async def upload_banner_image(
    banner_id: UUID,
    file: UploadFile = File(..., description="Изображение баннера (JPEG / PNG / WebP, макс. 5 МБ)"),
) -> dict:
    async with UnitOfWork() as uow:
        banner = await uow.hero_banners.get_by_id(banner_id)
        if not banner:
            raise HTTPException(status_code=404, detail=f"Баннер {banner_id} не найден")

        relative_path, _ = await static_service.save_slide_image(file, banner_id)
        image_url = static_service.build_url(relative_path)
        banner.image = image_url
        await uow.commit()

    logger.info("hero_banner_image_uploaded", banner_id=str(banner_id), url=image_url)
    return {"url": image_url}
