from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.site_setting import PublicSettingsOut, SettingUpdateIn

logger = get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["Settings"])

# Ключ → ожидаемый тип. Всё, чего нет в списке, снаружи не читается и не пишется.
PUBLIC_KEYS: dict[str, type] = {
    "preorder_section_enabled": bool,
    "preorder_in_catalog": bool,
    "new_models_feed_query": str,
}


def _public(values: dict) -> PublicSettingsOut:
    known = {k: v for k, v in values.items() if k in PUBLIC_KEYS and isinstance(v, PUBLIC_KEYS[k])}
    return PublicSettingsOut(**known)


@router.get(
    "/public",
    response_model=PublicSettingsOut,
    summary="Настройки витрины (публичные)",
    description="Переключатели, по которым сайт решает, что показывать. Ключи без значения в БД отдаются дефолтами.",
)
async def get_public_settings() -> PublicSettingsOut:
    async with UnitOfWork() as uow:
        values = await uow.site_settings.get_all()
    return _public(values)


@router.put(
    "/{key}",
    response_model=PublicSettingsOut,
    summary="Изменить настройку витрины",
    responses={404: {"description": "Неизвестный ключ"}, 422: {"description": "Значение не того типа"}},
    dependencies=[Depends(get_current_admin)],
)
async def update_setting(key: str, body: SettingUpdateIn) -> PublicSettingsOut:
    expected = PUBLIC_KEYS.get(key)
    if expected is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Настройка '{key}' не существует")
    if not isinstance(body.value, expected) or (expected is bool and type(body.value) is not bool):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Настройка '{key}' ожидает значение типа {expected.__name__}",
        )
    if expected is str and len(body.value) > 500:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Слишком длинное значение (до 500 символов)")
    async with UnitOfWork() as uow:
        await uow.site_settings.set(key, body.value)
        await uow.commit()
        values = await uow.site_settings.get_all()
    logger.info("site_setting_updated", key=key, value=body.value)
    return _public(values)
