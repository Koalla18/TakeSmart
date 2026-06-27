from pathlib import Path
from urllib.parse import quote_plus

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Корень проекта (два уровня вверх от этого файла: core → app → src → root)
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent


class Settings(BaseSettings):
    # Application
    APP_TITLE: str = "TakesMart API"
    APP_VERSION: str = "0.1.0"
    APP_DEBUG: bool = False
    BASE_URL: str = "http://localhost:8000"

    # PostgreSQL
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "takesmart"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "postgres"

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""

    @field_validator("REDIS_DB", mode="before")
    @classmethod
    def _parse_redis_db(cls, v: object) -> int:
        if isinstance(v, str) and not v.strip().isdigit():
            return 0
        return int(v)

    # Security / JWT
    SECRET_KEY: str = "changeme-set-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Admin credentials
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "changeme"

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost"

    # Static files / S3
    S3_ENDPOINT_URL: str = "https://s3.twcstorage.ru"
    S3_BUCKET_NAME: str = "9fbee474-1fa2-419a-ab9e-e0f8ecde4b7e"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "ru-1"
    S3_PUBLIC_URL: str = ""  # если пусто — строится автоматически
    MAX_UPLOAD_SIZE_BYTES: int = 5 * 1024 * 1024
    ALLOWED_IMAGE_TYPES: list[str] = ["image/jpeg", "image/png", "image/webp"]
    PRODUCTS_IMAGES_DIR: str = "products"
    CATEGORIES_IMAGES_DIR: str = "categories"
    SLIDES_IMAGES_DIR: str = "slides"

    # Telegram notifications
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    TELEGRAM_CHAT_IDS: str = ""
    TELEGRAM_THREAD_ID: int | None = None
    TELEGRAM_API_BASE_URL: str = "https://api.telegram.org"
    TELEGRAM_TIMEOUT_SECONDS: float = 5.0
    TELEGRAM_RETRIES: int = 1
    TELEGRAM_RETRY_DELAY_SECONDS: float = 1.0

    # Web Push (VAPID) — для PWA «Заказы»
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@takesmart.ru"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.DB_USER)}:{quote_plus(self.DB_PASSWORD)}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{quote_plus(self.REDIS_PASSWORD)}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"


settings = Settings()
