from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.database.session import get_db
from src.app.database.models.admin import Admin
from src.app.core.security import create_access_token, create_refresh_token, verify_password

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/admin/token")


async def authenticate_admin(username: str, password: str, db: AsyncSession):
    result = await db.execute(select(Admin).where(Admin.username == username))
    admin = result.scalar_one_or_none()
    if not admin or not verify_password(password, admin.hashed_password):
        return None
    return admin


@router.post("/token")
async def login_admin(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    admin = await authenticate_admin(form_data.username, form_data.password, db)
    if not admin:
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    return {
        "access_token": create_access_token(data={"sub": admin.username}),
        "refresh_token": create_refresh_token(data={"sub": admin.username}),
        "token_type": "bearer",
    }
