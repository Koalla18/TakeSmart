import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, get_session_expiration
from app.core.security import (
    create_access_token,
    generate_session_token,
    hash_password,
    verify_password,
)
from app.db.models import User
from app.db.repositories import SessionRepository, UserRepository
from app.db.session import get_db
from app.schemas.auth import AuthResponse, LoginRequest, LogoutResponse, RegisterRequest
from app.schemas.user import UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Регистрация пользователя",
    responses={400: {"description": "Пользователь уже существует"}},
)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> User:
    repo = UserRepository(db)
    if await repo.get_by_email(payload.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = await repo.create(
        {
            "email": payload.email,
            "hashed_password": hash_password(payload.password),
        }
    )
    logger.info("user registered id=%s", user.id)
    return user


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Вход пользователя",
    responses={401: {"description": "Неверные учетные данные"}},
)
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_email(payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(str(user.id))
    session_token = generate_session_token()
    expires_at = get_session_expiration()
    await SessionRepository(db).create(
        {
            "user_id": user.id,
            "token": session_token,
            "expires_at": expires_at,
        }
    )

    response.set_cookie(
        settings.session_cookie_name,
        session_token,
        httponly=True,
        max_age=int((expires_at - datetime.now(timezone.utc)).total_seconds()),
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.access_token_exp_minutes * 60,
        session_expires_at=expires_at,
        user=UserRead.model_validate(user),
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    summary="Выход пользователя",
)
async def logout(
    response: Response,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> LogoutResponse:
    if session_token:
        await SessionRepository(db).delete_by_token(session_token)
        response.delete_cookie(settings.session_cookie_name)
    return LogoutResponse(ok=True)


@router.get(
    "/me",
    response_model=UserRead,
    summary="Профиль текущего пользователя",
)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
