from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserRead


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="Email для регистрации")
    password: str = Field(..., min_length=8, description="Пароль (минимум 8 символов)")


class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="Email пользователя")
    password: str = Field(..., description="Пароль")


class AuthResponse(BaseModel):
    access_token: str = Field(..., description="JWT токен доступа")
    token_type: str = Field("bearer", description="Тип токена")
    expires_in: int = Field(..., description="Время жизни токена в секундах")
    session_expires_at: datetime = Field(..., description="Когда сессия истекает")
    user: UserRead = Field(..., description="Профиль пользователя")


class LogoutResponse(BaseModel):
    ok: bool = Field(True, description="Флаг успешного выхода")

