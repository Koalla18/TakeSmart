from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    
    # Admin credentials
    admin_username: str = "admin"
    admin_password: str = "takesmart2024"
    jwt_secret: str = "takesmart-secret-key-change-in-production"
    
    # Telegram bot
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


settings = Settings()
