"""CRUD-эндпоинты для групп товаров (product groups)."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.product_group import (
    ProductGroupCreate,
    ProductGroupDetailOut,
    ProductGroupMerge,
    ProductGroupOut,
    ProductGroupSiblingOut,
    ProductGroupUnlink,
    ProductGroupUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/product-groups", tags=["Product Groups"])


@router.get(
    "",
    response_model=list[ProductGroupOut],
    summary="Список групп товаров",
    description="Возвращает все группы с количеством привязанных товаров.",
)
async def list_groups() -> list[ProductGroupOut]:
    async with UnitOfWork() as uow:
        groups = await uow.product_groups.get_all()
        result = []
        for g in groups:
            result.append(
                ProductGroupOut(
                    id=g.id,
                    name=g.name,
                    created_at=g.created_at,
                    products_count=len(g.products) if g.products else 0,
                )
            )
        return result


@router.post(
    "",
    response_model=ProductGroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать группу товаров",
    dependencies=[Depends(get_current_admin)],
)
async def create_group(body: ProductGroupCreate) -> ProductGroupOut:
    async with UnitOfWork() as uow:
        group = await uow.product_groups.create(**body.model_dump())
        await uow.commit()
        logger.info("product_group_created", group_id=str(group.id), name=group.name)
        return ProductGroupOut(
            id=group.id,
            name=group.name,
            created_at=group.created_at,
            products_count=0,
        )


@router.get(
    "/{group_id}",
    response_model=ProductGroupDetailOut,
    summary="Получить группу с карточками",
    responses={404: {"description": "Группа не найдена"}},
)
async def get_group(group_id: UUID) -> ProductGroupDetailOut:
    async with UnitOfWork() as uow:
        group = await uow.product_groups.get_with_products(group_id)
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Группа с id={group_id} не найдена",
            )
        siblings = [ProductGroupSiblingOut.from_product(p) for p in group.products]
        return ProductGroupDetailOut(
            id=group.id,
            name=group.name,
            created_at=group.created_at,
            products_count=len(siblings),
            siblings=siblings,
        )


@router.patch(
    "/{group_id}",
    response_model=ProductGroupOut,
    summary="Обновить группу товаров",
    responses={404: {"description": "Группа не найдена"}},
    dependencies=[Depends(get_current_admin)],
)
async def update_group(group_id: UUID, body: ProductGroupUpdate) -> ProductGroupOut:
    async with UnitOfWork() as uow:
        group = await uow.product_groups.get_with_products(group_id)
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Группа с id={group_id} не найдена",
            )
        update_data = body.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Необходимо передать хотя бы одно поле для обновления",
            )
        await uow.product_groups.update(group_id, **update_data)
        await uow.commit()
        group = await uow.product_groups.get_with_products(group_id)
        logger.info("product_group_updated", group_id=str(group_id))
        return ProductGroupOut(
            id=group.id,
            name=group.name,
            created_at=group.created_at,
            products_count=len(group.products) if group.products else 0,
        )


@router.delete(
    "/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить группу товаров",
    description="Удаляет группу. Товары остаются, но теряют привязку к группе (group_id=NULL).",
    responses={404: {"description": "Группа не найдена"}},
    dependencies=[Depends(get_current_admin)],
)
async def delete_group(group_id: UUID) -> None:
    async with UnitOfWork() as uow:
        group = await uow.product_groups.get_by_id(group_id)
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Группа с id={group_id} не найдена",
            )
        await uow.product_groups.delete(group_id)
        await uow.commit()
        logger.info("product_group_deleted", group_id=str(group_id))


@router.post(
    "/merge",
    response_model=ProductGroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Объединить товары в группу",
    description=(
        "Принимает список ID товаров (минимум 2). "
        "Если один из товаров уже в группе — остальные добавляются в эту группу. "
        "Иначе создаётся новая группа."
    ),
    dependencies=[Depends(get_current_admin)],
)
async def merge_products(body: ProductGroupMerge) -> ProductGroupOut:
    async with UnitOfWork() as uow:
        # Загрузить все указанные товары
        products = []
        for pid in body.product_ids:
            product = await uow.products.get_by_id(pid)
            if not product:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Товар с id={pid} не найден",
                )
            products.append(product)

        # Найти существующую группу среди выбранных товаров
        existing_group_id = None
        for p in products:
            if p.group_id:
                existing_group_id = p.group_id
                break

        if existing_group_id:
            # Добавляем остальные товары в существующую группу
            group = await uow.product_groups.get_with_products(existing_group_id)
            for p in products:
                if p.group_id != existing_group_id:
                    await uow.products.update(p.id, group_id=existing_group_id)
        else:
            # Создаём новую группу
            group_name = body.name or products[0].name
            group = await uow.product_groups.create(name=group_name)
            for p in products:
                await uow.products.update(p.id, group_id=group.id)

        await uow.commit()

        # Перезагрузим группу для подсчёта товаров
        group = await uow.product_groups.get_with_products(group.id)
        logger.info(
            "products_merged",
            group_id=str(group.id),
            product_count=len(group.products),
        )
        return ProductGroupOut(
            id=group.id,
            name=group.name,
            created_at=group.created_at,
            products_count=len(group.products) if group.products else 0,
        )


@router.post(
    "/unlink",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Убрать товары из группы",
    description="Отвязывает указанные товары от их группы (group_id=NULL). Если в группе не остаётся товаров — группа удаляется.",
    dependencies=[Depends(get_current_admin)],
)
async def unlink_products(body: ProductGroupUnlink) -> None:
    async with UnitOfWork() as uow:
        group_ids_to_check: set[UUID] = set()
        for pid in body.product_ids:
            product = await uow.products.get_by_id(pid)
            if not product:
                continue
            if product.group_id:
                group_ids_to_check.add(product.group_id)
            await uow.products.update(pid, group_id=None)

        await uow.commit()

        # Удаляем пустые группы
        for gid in group_ids_to_check:
            group = await uow.product_groups.get_with_products(gid)
            if group and (not group.products or len(group.products) == 0):
                await uow.product_groups.delete(gid)
                await uow.commit()
                logger.info("empty_group_deleted", group_id=str(gid))

        logger.info("products_unlinked", product_ids=[str(p) for p in body.product_ids])
