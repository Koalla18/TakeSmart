"""
Эндпоинты авторизации администратора.

- POST /token          — логин (получение access + refresh токенов)
- POST /refresh        — обновление access-токена по refresh-токену
- GET  /me             — информация о текущем администраторе
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.core.logger import get_logger
from src.app.core.config import settings
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
REFRESH_COOKIE = "takesmart_admin_refresh"
COOKIE_PATH = "/api"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


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


def _refresh_cookie(response: Response, request: Request, token: str) -> None:
    secure = request.url.scheme == "https" or request.url.hostname not in _LOCAL_HOSTS
    response.set_cookie(REFRESH_COOKIE, token, httponly=True, secure=secure, samesite="strict",
                        path=COOKIE_PATH, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400)
    response.headers["Cache-Control"] = "no-store"


def _require_signing_key(request: Request) -> None:
    key = settings.SECRET_KEY.strip()
    local = request.url.hostname in _LOCAL_HOSTS and request.client and request.client.host in _LOCAL_HOSTS
    if (not key or key.lower().startswith("changeme")) and not local:
        logger.error("admin_signing_key_not_configured")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Настройте SECRET_KEY для входа в админку")


async def _consume_refresh(db: AsyncSession, token: str, payload: dict) -> bool:
    result = await db.execute(text("""
        INSERT INTO admin_refresh_consumed (digest, expires_at) VALUES (:digest, :expires_at)
        ON CONFLICT DO NOTHING RETURNING digest
    """), {"digest": sha256(token.encode()).hexdigest(),
            "expires_at": datetime.fromtimestamp(payload["exp"], tz=timezone.utc)})
    return result.scalar_one_or_none() is not None


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
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Admin:
    """
    Dependency: извлекает и **валидирует** JWT access-токен,
    возвращает объект Admin из БД.
    Используется для защиты админских эндпоинтов.
    """
    _require_signing_key(request)
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
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    _require_signing_key(request)
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
    _refresh_cookie(response, request, tokens.refresh_token)
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
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    _require_signing_key(request)
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невалидный или просроченный refresh-токен",
    )

    token = body.refresh_token if body else request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise credentials_exc
    try:
        payload = decode_token(token)
    except JWTError:
        logger.warning("auth_refresh_decode_failed")
        raise credentials_exc

    if payload.get("type") != "refresh" or not isinstance(payload.get("exp"), (int, float)):
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

    await db.execute(text("DELETE FROM admin_refresh_consumed WHERE expires_at <= now()"))
    if not await _consume_refresh(db, token, payload):
        raise credentials_exc
    await db.commit()

    tokens = TokenResponse(
        access_token=create_access_token(data={"sub": admin.username}),
        refresh_token=create_refresh_token(data={"sub": admin.username}),
    )
    _refresh_cookie(response, request, tokens.refresh_token)
    logger.info("auth_tokens_refreshed", username=admin.username)
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_admin(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        try:
            payload = decode_token(token)
        except JWTError:
            payload = {}
        if payload.get("type") == "refresh" and isinstance(payload.get("exp"), (int, float)):
            await _consume_refresh(db, token, payload)
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)


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
