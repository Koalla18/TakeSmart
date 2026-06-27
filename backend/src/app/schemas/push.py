from __future__ import annotations

from pydantic import BaseModel


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: str | None = None


class PushUnsubscribeIn(BaseModel):
    endpoint: str


class VapidKeyOut(BaseModel):
    public_key: str
