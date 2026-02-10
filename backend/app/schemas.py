from datetime import datetime

from pydantic import BaseModel, EmailStr


class OrderCreate(BaseModel):
    name: str
    phone: str
    email: EmailStr
    comment: str | None = None


class OrderRead(BaseModel):
    id: int
    name: str
    phone: str
    email: str
    comment: str | None
    created_at: datetime

    class Config:
        from_attributes = True
