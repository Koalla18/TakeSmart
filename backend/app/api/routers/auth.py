from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ...core.security import authenticate_admin, create_access_token, verify_admin
from ...db.redis import get_redis_client
from ...schemas import LoginRequest, TokenResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Rate limiting для login: 10 попыток за 15 минут с одного IP
_LOGIN_RATE_WINDOW = 900   # 15 минут
_LOGIN_RATE_MAX    = 10


async def _check_login_rate_limit(request: Request) -> None:
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    ip = ip.split(",")[0].strip()
    key = f"login_ratelimit:{ip}"
    try:
        redis = get_redis_client()
        if redis is None:
            return
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _LOGIN_RATE_WINDOW)
        if count > _LOGIN_RATE_MAX:
            ttl = await redis.ttl(key)
            logger.warning("Login rate limit exceeded for IP %s (count=%s)", ip, count)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Слишком много попыток входа. Подождите {ttl} сек.",
                headers={"Retry-After": str(ttl)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Не удалось проверить rate limit для login: %s", exc)


@router.post("/login", response_model=TokenResponse, summary="Admin login")
async def login(request: Request, body: LoginRequest) -> TokenResponse:
    await _check_login_rate_limit(request)

    user = authenticate_admin(body.username, body.password)
    if not user:
        # Фиксированная задержка 300 мс — дополнительная защита от брутфорса
        await asyncio.sleep(0.3)
        logger.warning("Failed login attempt for username='%s' from IP=%s",
                       body.username,
                       request.headers.get("X-Forwarded-For", getattr(request.client, "host", "unknown")))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(data=user, expires_delta=timedelta(hours=24))
    logger.info("Admin login successful: username='%s'", body.username)
    return TokenResponse(access_token=access_token)


@router.get("/verify", summary="Verify admin token")
async def verify_auth(admin: dict = Depends(verify_admin)) -> dict:
    return {"valid": True, "username": admin.get("username")}
