from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=settings.jwt_expire_hours))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


async def verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    payload = verify_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    # Проверяем blacklist в Redis (если доступен)
    try:
        from ..db.redis import get_redis_client
        redis = get_redis_client()
        if redis is not None:
            exp = payload.get("exp")
            username = payload.get("username")
            if exp and username:
                blacklist_key = f"token_blacklist:{username}:{exp}"
                is_blacklisted = await redis.exists(blacklist_key)
                if is_blacklisted:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Token has been revoked. Please login again.",
                    )
    except HTTPException:
        raise
    except Exception:
        # Если Redis недоступен — пропускаем проверку blacklist
        pass

    return payload


def authenticate_admin(username: str, password: str) -> Optional[dict]:
    """
    Сравниваем через secrets.compare_digest — защита от timing attack.
    Обе ветки (неверный username И неверный password) занимают одинаковое время.
    """
    username_ok = secrets.compare_digest(username, settings.admin_username)
    password_ok = secrets.compare_digest(password, settings.admin_password)
    if username_ok and password_ok:
        return {"username": username, "role": "admin"}
    return None
