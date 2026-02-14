from __future__ import annotations
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):


    auto_create_tables: bool = True
    uploads_dir: str = "uploads"
    cors_origins: list[str] = ["http://localhost:5173"]

    telegram_chat_id: str = ""
    telegram_bot_token: str = ""

    jwt_expire_hours: int = 24
    jwt_algorithm: str = "HS256"
    jwt_secret: str = "takesmart-secret-key-change-in-production"
    admin_password: str = "takesmart2024"
    admin_username: str = "admin"

    redis_url: str = "redis://localhost:6379/0"
    database_url: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()

