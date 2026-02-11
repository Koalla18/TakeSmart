from datetime import datetime

from pydantic import BaseModel, EmailStr, Field
from pydantic.config import ConfigDict


class UserBase(BaseModel):
    email: EmailStr = Field(..., description="Email пользователя")


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, description="Пароль (минимум 8 символов)")


class UserRead(UserBase):
    id: int = Field(..., description="ID пользователя")
    is_active: bool = Field(..., description="Пользователь активен")
    is_admin: bool = Field(..., description="Пользователь администратор")
    created_at: datetime = Field(..., description="Дата регистрации")

    model_config = ConfigDict(from_attributes=True)

