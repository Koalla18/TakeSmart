from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


class LoginRequest(BaseModel):
    """
    Лимиты длины — защита от payload-атак (гигантские строки).
    extra="forbid" — лишние поля отвергаются.
    """
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Username не может быть пустым")
        if len(v) > 100:
            raise ValueError("Username слишком длинный")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not v:
            raise ValueError("Password не может быть пустым")
        if len(v) > 256:
            raise ValueError("Password слишком длинный")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
