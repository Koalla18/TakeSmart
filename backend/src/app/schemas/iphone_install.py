from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

JOB_APP_STATUSES = ("pending", "downloading", "installing", "installed", "not_owned", "failed", "skipped")


class StationCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)


class StationOut(BaseModel):
    id: UUID
    name: str
    version: str | None
    last_seen_at: datetime | None
    state: dict[str, Any]
    is_active: bool
    online: bool
    created_at: datetime


class StationCreatedOut(StationOut):
    token: str = Field(..., description="Показывается один раз: вписать в настройки станции")


class DeviceInfo(BaseModel):
    udid: str | None = Field(None, max_length=64)
    model: str | None = Field(None, max_length=80)
    ios_version: str | None = Field(None, max_length=24)
    name: str | None = Field(None, max_length=80)
    paired: bool | None = None

    @field_validator("udid", "model", "ios_version", "name", mode="before")
    @classmethod
    def _clip(cls, v: Any) -> Any:
        # Станция шлёт то, что отдал телефон: обрезаем, а не отвергаем весь пульс
        if isinstance(v, str):
            return v[:64] if len(v) > 80 else v
        return v


class AppleState(BaseModel):
    logged_in: bool = False
    purchases_count: int | None = None


class HeartbeatIn(BaseModel):
    version: str = Field(..., max_length=32)
    device: DeviceInfo | None = None
    apple: AppleState | None = None
    busy: bool = False


class HeartbeatOut(BaseModel):
    station: StationOut


class JobApp(BaseModel):
    bundle_id: str = Field(..., max_length=200)
    name: str = Field(..., max_length=160)
    status: str = "pending"
    version: str | None = Field(None, max_length=40)
    error: str | None = Field(None, max_length=300)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in JOB_APP_STATUSES:
            raise ValueError(f"Статус приложения: {', '.join(JOB_APP_STATUSES)}")
        return v

    @field_validator("name", "version", "error", mode="before")
    @classmethod
    def _clip(cls, v: Any) -> Any:
        return v[:300] if isinstance(v, str) else v


class SessionStartIn(BaseModel):
    device: DeviceInfo
    apps: list[JobApp] = Field(..., min_length=1, max_length=50)
    note: str | None = Field(None, max_length=300)


class JobProgressIn(BaseModel):
    apps: list[JobApp] | None = None
    log: str | None = Field(None, max_length=300)


class JobFinishIn(BaseModel):
    status: Literal["done", "failed", "cancelled"]
    apps: list[JobApp]
    log: str | None = Field(None, max_length=300)


class JobOut(BaseModel):
    id: UUID
    station_id: UUID | None
    status: str
    apps: list[dict[str, Any]]
    device_udid: str | None
    device_model: str | None
    ios_version: str | None
    note: str | None
    log: list[dict[str, Any]]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class InstallStatsOut(BaseModel):
    installed_today: int
    installed_month: int
    sessions_today: int
    sessions_month: int
    stations_online: int
