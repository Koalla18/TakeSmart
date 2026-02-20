from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str = ""  # Опционально — если пустой rate limiting отключается

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

    # CORS — comma-separated list of allowed origins
    # Leave empty to allow only localhost (dev) origins
    allowed_origins: str = ""

    def get_allowed_origins(self) -> list[str]:
        """Return list of allowed CORS origins."""
        dev_origins = [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "http://localhost:3000",
        ]
        if self.allowed_origins:
            extra = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
            return list(set(dev_origins + extra))
        return dev_origins


settings = Settings()
