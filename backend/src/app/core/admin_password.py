"""Apply changes to the deployment's admin password at application startup."""
from os import getenv

from sqlalchemy import select

from src.app.core.config import settings
from src.app.core.logger import get_logger
from src.app.core.security import get_password_hash, verify_password
from src.app.database.models.admin import Admin
from src.app.database.session import AsyncSessionFactory

logger = get_logger(__name__)


async def sync_admin_password() -> None:
    password = getenv("ADMIN_PASSWORD", "")
    if password and (not password.strip() or password in {"admin", "changeme"} or len(password.encode()) > 72):
        logger.warning("admin_env_password_ignored", reason="blank, default or over 72 bytes")
        password = ""
    async with AsyncSessionFactory.begin() as session:
        admin = await session.scalar(select(Admin).where(Admin.username == settings.ADMIN_USERNAME).with_for_update())
        if admin is None:
            if password:
                logger.warning("admin_env_password_user_not_found")
            return

        previous = admin.env_password_hash
        if previous is None:
            # Adopt the deployment configuration without restoring an old env password over a working login.
            admin.env_password_hash = get_password_hash(password) if password else ""
            result = "baseline_recorded"
        elif password and (not previous or not verify_password(password, previous)):
            admin.hashed_password = admin.env_password_hash = get_password_hash(password)
            result = "updated"
        else:
            return
    logger.info("admin_env_password_sync", result=result)
