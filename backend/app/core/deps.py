from datetime import datetime, timedelta, timezone
import logging

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.models import User
from app.db.repositories import SessionRepository, UserRepository
from app.db.session import get_db

logger = logging.getLogger(__name__)


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> User:
    auth_header = request.headers.get("Authorization")
    user_repo = UserRepository(db)

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        payload = decode_access_token(token)
        if not payload or "sub" not in payload:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        try:
            user_id = int(payload["sub"])
        except ValueError as exc:
            logger.info("Invalid token subject: %s", exc)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user = await user_repo.get(user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    if session_token:
        session_repo = SessionRepository(db)
        session = await session_repo.get_by_token(session_token)
        if not session or session.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
        user = await user_repo.get(session.user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def get_session_expiration() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=settings.session_exp_hours)
