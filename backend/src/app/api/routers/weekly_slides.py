from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from src.app.core.logger import get_logger
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.weekly_slide import WeeklySlideCreate, WeeklySlideOut, WeeklySlideUpdate

logger = get_logger(__name__)

router = APIRouter(prefix="/weekly-slides", tags=["Weekly Slides"])


@router.get(
    "",
    response_model=list[WeeklySlideOut],
    summary="Список активных слайдов «Товары недели»",
)
async def list_weekly_slides() -> list[WeeklySlideOut]:
    async with UnitOfWork() as uow:
        slides = await uow.weekly_slides.get_active()
    return list(slides)


@router.get(
    "/all",
    response_model=list[WeeklySlideOut],
    summary="Все слайды (включая неактивные) — для админки",
)
async def list_all_weekly_slides() -> list[WeeklySlideOut]:
    async with UnitOfWork() as uow:
        slides = await uow.weekly_slides.get_all(limit=100)
    return list(slides)


@router.post(
    "",
    response_model=WeeklySlideOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать слайд",
)
async def create_weekly_slide(body: WeeklySlideCreate) -> WeeklySlideOut:
    async with UnitOfWork() as uow:
        slide = await uow.weekly_slides.create(**body.model_dump())
        await uow.commit()
        await uow.weekly_slides.session.refresh(slide)
    logger.info("weekly_slide_created", slide_id=str(slide.id), title=slide.title)
    return slide


@router.patch(
    "/{slide_id}",
    response_model=WeeklySlideOut,
    summary="Обновить слайд",
    responses={404: {"description": "Слайд не найден"}},
)
async def update_weekly_slide(slide_id: UUID, body: WeeklySlideUpdate) -> WeeklySlideOut:
    async with UnitOfWork() as uow:
        slide = await uow.weekly_slides.get_by_id(slide_id)
        if not slide:
            raise HTTPException(status_code=404, detail=f"Слайд {slide_id} не найден")

        data = body.model_dump(exclude_unset=True)
        for field, value in data.items():
            setattr(slide, field, value)

        await uow.commit()
        await uow.weekly_slides.session.refresh(slide)
    logger.info("weekly_slide_updated", slide_id=str(slide_id))
    return slide


@router.delete(
    "/{slide_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить слайд",
    responses={404: {"description": "Слайд не найден"}},
)
async def delete_weekly_slide(slide_id: UUID) -> None:
    async with UnitOfWork() as uow:
        slide = await uow.weekly_slides.get_by_id(slide_id)
        if not slide:
            raise HTTPException(status_code=404, detail=f"Слайд {slide_id} не найден")
        await uow.weekly_slides.session.delete(slide)
        await uow.commit()
    logger.info("weekly_slide_deleted", slide_id=str(slide_id))
