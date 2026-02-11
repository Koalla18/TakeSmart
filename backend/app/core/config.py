from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 30
    session_exp_hours: int = 72

    cors_origins: list[str] = ["http://localhost:5173"]
    product_embedding_dim: int = 128
    cache_ttl_seconds: int = 60
    enable_db_init: bool = True
    session_cookie_name: str = "take_smart_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"


settings = Settings()
