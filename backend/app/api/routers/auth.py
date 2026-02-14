from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status

from ...core.security import authenticate_admin, create_access_token, verify_admin
from ...schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse, summary="Admin login")
async def login(request: LoginRequest) -> TokenResponse:
    user = authenticate_admin(request.username, request.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(data=user, expires_delta=timedelta(hours=24))
    return TokenResponse(access_token=access_token)


@router.get("/verify", summary="Verify admin token")
async def verify_auth(admin: dict = verify_admin) -> dict:
    return {"valid": True, "username": admin.get("username")}

