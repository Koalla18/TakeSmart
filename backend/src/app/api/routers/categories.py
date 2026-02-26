from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.app.api.admin.endpoints import oauth2_scheme
from src.app.core.logger import get_logger
from src.app.core.slugify import build_unique_slug
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.category import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    CategoryWithChildrenOut,
)
from src.app.schemas.common import PaginatedResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/categories", tags=["Categories"])


@router.get(
    "",
    response_model=PaginatedResponse[CategoryOut],
    summary="Список всех категорий",
)
async def list_categories(
    offset: int = Query(0, ge=0, description="Смещение"),
    limit: int = Query(20, ge=1, le=100, description="Размер страницы"),
    only_active: bool = Query(True, description="Только активные категории"),
) -> PaginatedResponse[CategoryOut]:
    async with UnitOfWork() as uow:
        if only_active:
            items = await uow.categories.get_active(offset=offset, limit=limit)
        else:
            items = await uow.categories.get_all(offset=offset, limit=limit)
        total = await uow.categories.count()

    logger.info("categories_listed", count=len(items), offset=offset, limit=limit)
    return PaginatedResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_next=(offset + limit) < total,
    )


@router.get(
    "/roots",
    response_model=list[CategoryWithChildrenOut],
    summary="Корневые категории с подкатегориями",
)
async def list_root_categories() -> list[CategoryWithChildrenOut]:
    async with UnitOfWork() as uow:
        items = await uow.categories.get_root_categories()
    logger.info("root_categories_listed", count=len(items))
    return items


@router.get(
    "/{category_id}",
    response_model=CategoryWithChildrenOut,
    summary="Получить категорию по ID",
    responses={404: {"description": "Категория не найдена"}},
)
async def get_category(category_id: UUID) -> CategoryWithChildrenOut:
    async with UnitOfWork() as uow:
        category = await uow.categories.get_with_children(category_id)

    if not category:
        logger.warning("category_not_found", category_id=str(category_id))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Категория с id={category_id} не найдена",
        )
    return category


@router.get(
    "/slug/{slug}",
    response_model=CategoryWithChildrenOut,
    summary="Получить категорию по slug",
    responses={404: {"description": "Категория не найдена"}},
)
async def get_category_by_slug(slug: str) -> CategoryWithChildrenOut:
    async with UnitOfWork() as uow:
        category = await uow.categories.get_by_slug(slug)
        if category:
            category = await uow.categories.get_with_children(category.id)

    if not category:
        logger.warning("category_not_found_by_slug", slug=slug)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Категория со slug='{slug}' не найдена",
        )
    return category


@router.post(
    "",
    response_model=CategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать категорию",
    responses={
        409: {"description": "Категория с таким именем уже существует"},
        422: {"description": "Ошибка валидации полей"},
    },
    dependencies=[Depends(oauth2_scheme)],
)
async def create_category(body: CategoryCreate) -> CategoryOut:
    async with UnitOfWork() as uow:
        # Проверяем уникальность name
        if await uow.categories.get_by_name(body.name):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Категория с именем '{body.name}' уже существует",
            )

        # Проверяем существование родителя
        if body.parent_id:
            parent = await uow.categories.get_by_id(body.parent_id)
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Родительская категория с id={body.parent_id} не найдена",
                )

        # Автогенерация уникального slug из name
        slug = await build_unique_slug(body.name, uow.categories.slug_exists)

        category = await uow.categories.create(
            **body.model_dump(),
            slug=slug,
        )
        await uow.commit()

    logger.info("category_created", category_id=str(category.id), slug=category.slug)
    return category


@router.patch(
    "/{category_id}",
    response_model=CategoryOut,
    summary="Обновить категорию",
    responses={
        404: {"description": "Категория не найдена"},
        409: {"description": "Имя уже занято"},
        422: {"description": "Ошибка валидации"},
    },
    dependencies=[Depends(oauth2_scheme)],
)
async def update_category(category_id: UUID, body: CategoryUpdate) -> CategoryOut:
    async with UnitOfWork() as uow:
        category = await uow.categories.get_by_id(category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Категория с id={category_id} не найдена",
            )

        # Проверяем уникальность нового name
        if body.name:
            existing = await uow.categories.get_by_name(body.name)
            if existing and existing.id != category_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Категория с именем '{body.name}' уже существует",
                )

        if body.parent_id:
            if body.parent_id == category_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Категория не может быть родителем самой себя",
                )
            parent = await uow.categories.get_by_id(body.parent_id)
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Родительская категория с id={body.parent_id} не найдена",
                )

        update_data = body.model_dump(exclude_unset=True)

        # Если меняется name — пересчитываем slug автоматически
        if body.name:
            update_data["slug"] = await build_unique_slug(
                body.name,
                uow.categories.slug_exists,
                exclude_id=category_id,
            )

        updated = await uow.categories.update(category_id, **update_data)
        await uow.commit()

    logger.info("category_updated", category_id=str(category_id), slug=updated.slug)
    return updated


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить категорию",
    responses={
        404: {"description": "Категория не найдена"},
        409: {"description": "Нельзя удалить — есть дочерние категории или товары"},
    },
)
async def delete_category(category_id: UUID) -> None:
    async with UnitOfWork() as uow:
        category = await uow.categories.get_with_children(category_id)
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Категория с id={category_id} не найдена",
            )

        if category.children:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Нельзя удалить категорию: у неё есть "
                    f"{len(category.children)} дочерняя(-их) категория(-й). "
                    "Сначала удалите или перенесите их."
                ),
            )

        category_with_products = await uow.categories.get_with_products(category_id)
        if category_with_products and category_with_products.products:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Нельзя удалить категорию: в ней находится "
                    f"{len(category_with_products.products)} товар(-а/-ов). "
                    "Сначала перенесите или удалите товары."
                ),
            )

        await uow.categories.delete(category_id)
        await uow.commit()

    logger.info("category_deleted", category_id=str(category_id))
