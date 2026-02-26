from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, UploadFile, File, status

from src.app.core.static_service import static_service
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.product_image import ProductImageOut, ReorderRequest

router = APIRouter(prefix="/products/{product_id}/images", tags=["Product Images"])


# ------------------------------------------------------------------ #
#  Эндпоинты                                                          #
# ------------------------------------------------------------------ #

@router.get("", summary="Список изображений товара")
async def list_images(product_id: UUID) -> list[ProductImageOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Товар не найден")

        images = await uow.product_images.get_by_product(product_id)
        return [
            ProductImageOut(
                **{k: v for k, v in vars(img).items() if not k.startswith("_")},
                url=static_service.build_url(img.file_path),
            )
            for img in images
        ]


@router.post("", status_code=status.HTTP_201_CREATED, summary="Загрузить изображение товара")
async def upload_image(
    product_id: UUID,
    file: UploadFile = File(..., description="Изображение товара (JPEG / PNG / WebP, макс. 5 МБ)"),
) -> ProductImageOut:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Товар не найден")

        # Определяем sort_order = количество уже загруженных изображений
        current_count = await uow.product_images.count_by_product(product_id)
        is_first = current_count == 0

        # Сохраняем файл на диск
        relative_path, file_size = await static_service.save_product_image(file, product_id)

        # Записываем в БД
        image = await uow.product_images.create(
            product_id=product_id,
            file_path=relative_path,
            original_filename=file.filename or "upload",
            mime_type=file.content_type or "image/jpeg",
            file_size=file_size,
            sort_order=current_count,
            is_main=is_first,  # первое загруженное фото автоматически становится главным
        )

        # Если это первое фото — обновляем main_image_url на товаре
        if is_first:
            await uow.products.update(product_id, main_image_url=relative_path)

        await uow.commit()

    return ProductImageOut(
        **{k: v for k, v in vars(image).items() if not k.startswith("_")},
        url=static_service.build_url(image.file_path),
    )


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить изображение")
async def delete_image(product_id: UUID, image_id: UUID) -> None:
    async with UnitOfWork() as uow:
        image = await uow.product_images.get_by_id(image_id)
        if not image or image.product_id != product_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Изображение не найдено")

        was_main = image.is_main
        file_path = image.file_path

        # Удаляем запись из БД
        await uow.product_images.delete(image_id)

        # Удаляем файл с диска
        await static_service.delete_file(file_path)

        # Если удалили главное фото — назначаем главным следующее по порядку
        if was_main:
            remaining = await uow.product_images.get_by_product(product_id)
            if remaining:
                await uow.product_images.set_main(product_id, remaining[0].id)
                await uow.products.update(product_id, main_image_url=remaining[0].file_path)
            else:
                await uow.products.update(product_id, main_image_url=None)

        await uow.commit()


@router.patch("/{image_id}/set-main", summary="Сделать изображение главным")
async def set_main_image(product_id: UUID, image_id: UUID) -> ProductImageOut:
    async with UnitOfWork() as uow:
        image = await uow.product_images.get_by_id(image_id)
        if not image or image.product_id != product_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Изображение не найдено")

        await uow.product_images.set_main(product_id, image_id)
        await uow.products.update(product_id, main_image_url=image.file_path)
        await uow.commit()

        updated = await uow.product_images.get_by_id(image_id)

    return ProductImageOut(
        **{k: v for k, v in vars(updated).items() if not k.startswith("_")},
        url=static_service.build_url(updated.file_path),
    )


@router.patch("/reorder", summary="Изменить порядок изображений")
async def reorder_images(product_id: UUID, body: ReorderRequest) -> list[ProductImageOut]:
    async with UnitOfWork() as uow:
        product = await uow.products.get_by_id(product_id)
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Товар не найден")

        await uow.product_images.reorder(product_id, body.ordered_ids)
        await uow.commit()

        images = await uow.product_images.get_by_product(product_id)

    return [
        ProductImageOut(
            **{k: v for k, v in vars(img).items() if not k.startswith("_")},
            url=static_service.build_url(img.file_path),
        )
        for img in images
    ]
