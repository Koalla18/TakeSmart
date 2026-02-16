from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str = "redis://localhost:6379/0"

    # Upload settings
    uploads_dir: str = "uploads"

    # Admin credentials
    admin_username: str = "admin"
    admin_password: str = "takesmart2024"

    # JWT settings
    jwt_secret: str = "takesmart-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    # Telegram bot
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


settings = Settings()
