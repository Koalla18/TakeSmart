"""
Эндпоинты авторизации администратора.

- POST /token          — логин (получение access + refresh токенов)
- POST /refresh        — обновление access-токена по refresh-токену
- GET  /me             — информация о текущем администраторе
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core.logger import get_logger
from src.app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from src.app.database.models.admin import Admin
from src.app.database.session import get_db

logger = get_logger(__name__)

router = APIRouter()

# OAuth2-схема — указывает Swagger, куда отправлять форму логина
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/admin/token")


# ── Pydantic-схемы ответов ─────────────────────────────────────── #

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class AdminMeResponse(BaseModel):
    id: int
    username: str


# ── Вспомогательные функции ────────────────────────────────────── #

async def authenticate_admin(
    username: str, password: str, db: AsyncSession
) -> Admin | None:
    """Проверяет логин/пароль, возвращает объект Admin или None."""
    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if not admin or not verify_password(password, admin.hashed_password):
        return None
    return admin


async def get_current_admin(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    """
    Dependency: извлекает и **валидирует** JWT access-токен,
    возвращает объект Admin из БД.
    Используется для защиты админских эндпоинтов.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невалидный или просроченный токен",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(token)
    except JWTError:
        logger.warning("auth_jwt_decode_failed")
        raise credentials_exc

    # Проверяем, что это именно access-токен
    if payload.get("type") != "access":
        logger.warning("auth_wrong_token_type", token_type=payload.get("type"))
        raise credentials_exc

    username: str | None = payload.get("sub")
    if username is None:
        raise credentials_exc

    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if admin is None:
        logger.warning("auth_admin_not_found", username=username)
        raise credentials_exc

    return admin


# ── Эндпоинты ─────────────────────────────────────────────────── #

@router.post(
    "/token",
    response_model=TokenResponse,
    summary="Авторизация администратора",
    description=(
        "Принимает username и password в формате application/x-www-form-urlencoded "
        "(стандарт OAuth2 Password Flow). Возвращает пару access + refresh токенов."
    ),
    responses={
        400: {"description": "Неверный логин или пароль"},
    },
)
async def login_admin(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    admin = await authenticate_admin(form_data.username, form_data.password, db)
    if not admin:
        logger.warning("auth_login_failed", username=form_data.username)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный логин или пароль",
        )

    tokens = TokenResponse(
        access_token=create_access_token(data={"sub": admin.username}),
        refresh_token=create_refresh_token(data={"sub": admin.username}),
    )
    logger.info("auth_login_success", username=admin.username)
    return tokens


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Обновление токенов",
    description=(
        "Принимает refresh-токен в теле запроса. "
        "Возвращает новую пару access + refresh токенов. "
        "Старый refresh-токен после этого считается использованным."
    ),
    responses={
        401: {"description": "Невалидный или просроченный refresh-токен"},
    },
)
async def refresh_tokens(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невалидный или просроченный refresh-токен",
    )

    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        logger.warning("auth_refresh_decode_failed")
        raise credentials_exc

    if payload.get("type") != "refresh":
        logger.warning("auth_refresh_wrong_type", token_type=payload.get("type"))
        raise credentials_exc

    username: str | None = payload.get("sub")
    if username is None:
        raise credentials_exc

    # Проверяем что админ всё ещё существует
    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if admin is None:
        logger.warning("auth_refresh_admin_gone", username=username)
        raise credentials_exc

    tokens = TokenResponse(
        access_token=create_access_token(data={"sub": admin.username}),
        refresh_token=create_refresh_token(data={"sub": admin.username}),
    )
    logger.info("auth_tokens_refreshed", username=admin.username)
    return tokens


@router.get(
    "/me",
    response_model=AdminMeResponse,
    summary="Текущий администратор",
    description="Возвращает информацию о текущем авторизованном администраторе.",
    responses={
        401: {"description": "Не авторизован"},
    },
)
async def admin_me(
    current_admin: Admin = Depends(get_current_admin),
) -> AdminMeResponse:
    return AdminMeResponse(id=current_admin.id, username=current_admin.username)
