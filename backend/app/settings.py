from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
import secrets


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "sqlite:///./takesmart.db"
    
    # Admin credentials (MUST be set in .env for production)
    admin_username: str = Field(default="admin", min_length=3)
    admin_password: str = Field(default="takesmart2024", min_length=8)
    jwt_secret: str = Field(
        default_factory=lambda: secrets.token_urlsafe(32),
        description="Secret key for JWT tokens. Auto-generated if not set."
    )
    jwt_expiry_hours: int = Field(default=24, ge=1, le=168)
    
    # Telegram bot
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    
    # Security settings
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_upload_size_mb: int = Field(default=10, ge=1, le=50)
    allowed_upload_types: str = "image/jpeg,image/png,image/webp,image/gif"
    
    # Rate limiting (requests per minute)
    rate_limit_auth: int = Field(default=10, ge=1)
    rate_limit_orders: int = Field(default=30, ge=1)
    
    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    @property
    def allowed_upload_types_list(self) -> list[str]:
        return [t.strip() for t in self.allowed_upload_types.split(",")]


settings = Settings()
