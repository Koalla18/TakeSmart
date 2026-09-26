from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

APP_CATEGORIES = ("bank", "messenger", "social", "service", "other")
REQUEST_STATUSES = ("new", "in_progress", "done", "cancelled")
JOB_APP_STATUSES = ("pending", "downloading", "installing", "installed", "not_owned", "failed", "skipped")


# ── Каталог приложений ───────────────────────────────────────────────────────

class IphoneAppBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    bundle_id: str = Field(..., min_length=3, max_length=200, examples=["ru.sberbankmobile"])
    app_store_id: int | None = Field(None, ge=1)
    category: str = Field("other", max_length=40)
    price: Decimal = Field(Decimal("0"), ge=0, le=Decimal("99999"))
    description: str | None = Field(None, max_length=300)
    icon_url: str | None = Field(None, max_length=500)
    is_active: bool = True
    sort_order: int = Field(0, ge=-1000, le=1000)

    @field_validator("bundle_id")
    @classmethod
    def _bundle(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", v):
            raise ValueError("Bundle ID: латиница, цифры, точки и дефисы")
        return v

    @field_validator("category")
    @classmethod
    def _category(cls, v: str) -> str:
        if v not in APP_CATEGORIES:
            raise ValueError(f"Категория: {', '.join(APP_CATEGORIES)}")
        return v


class IphoneAppCreate(IphoneAppBase):
    pass


class IphoneAppUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    bundle_id: str | None = Field(None, min_length=3, max_length=200)
    app_store_id: int | None = Field(None, ge=1)
    category: str | None = None
    price: Decimal | None = Field(None, ge=0, le=Decimal("99999"))
    description: str | None = Field(None, max_length=300)
    icon_url: str | None = Field(None, max_length=500)
    is_active: bool | None = None
    sort_order: int | None = Field(None, ge=-1000, le=1000)

    _bundle = field_validator("bundle_id")(lambda cls, v: IphoneAppBase._bundle(v) if v else v)  # type: ignore[arg-type]
    _category = field_validator("category")(lambda cls, v: IphoneAppBase._category(v) if v else v)  # type: ignore[arg-type]


class IphoneAppOut(IphoneAppBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Заявки ───────────────────────────────────────────────────────────────────

def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] in "78":
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    if len(digits) != 11:
        raise ValueError("Телефон: нужен российский номер из 11 цифр")
    return "+" + digits


class InstallRequestCreate(BaseModel):
    customer_name: str = Field(..., min_length=2, max_length=120)
    customer_phone: str = Field(..., min_length=10, max_length=32)
    device_model: str | None = Field(None, max_length=80)
    ios_version: str | None = Field(None, max_length=24)
    app_ids: list[UUID] = Field(..., min_length=1, max_length=12)
    comment: str | None = Field(None, max_length=500)

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("customer_name", "device_model", "ios_version", "comment")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v


class InstallRequestUpdate(BaseModel):
    status: str | None = None
    staff_note: str | None = Field(None, max_length=500)
    customer_name: str | None = Field(None, min_length=2, max_length=120)
    customer_phone: str | None = Field(None, min_length=10, max_length=32)
    device_model: str | None = Field(None, max_length=80)
    ios_version: str | None = Field(None, max_length=24)
    app_ids: list[UUID] | None = Field(None, min_length=1, max_length=12)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is not None and v not in REQUEST_STATUSES:
            raise ValueError(f"Статус: {', '.join(REQUEST_STATUSES)}")
        return v

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v else v


class InstallRequestOut(BaseModel):
    id: UUID
    request_number: str
    customer_name: str
    customer_phone: str
    device_model: str | None
    ios_version: str | None
    apps: list[dict[str, Any]]
    comment: str | None
    source: str
    status: str
    staff_note: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InstallRequestCreatedOut(BaseModel):
    id: UUID
    request_number: str


# ── Станции ──────────────────────────────────────────────────────────────────

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


class AppleState(BaseModel):
    logged_in: bool = False
    purchases_count: int | None = None
    owned_bundles: list[str] | None = Field(None, max_length=500)


class HeartbeatIn(BaseModel):
    version: str = Field(..., max_length=32)
    device: DeviceInfo | None = None
    apple: AppleState | None = None
    busy: bool = False


# ── Задания ──────────────────────────────────────────────────────────────────

class JobApp(BaseModel):
    bundle_id: str = Field(..., max_length=200)
    name: str = Field(..., max_length=120)
    price: Decimal = Field(Decimal("0"), ge=0)
    status: str = "pending"
    version: str | None = Field(None, max_length=40)
    error: str | None = Field(None, max_length=300)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in JOB_APP_STATUSES:
            raise ValueError(f"Статус приложения: {', '.join(JOB_APP_STATUSES)}")
        return v


class JobCreate(BaseModel):
    request_id: UUID
    station_id: UUID
    bundle_ids: list[str] | None = Field(None, max_length=12, description="Подмножество приложений заявки; пусто — все")


class JobOut(BaseModel):
    id: UUID
    request_id: UUID
    station_id: UUID | None
    status: str
    apps: list[dict[str, Any]]
    device_udid: str | None
    device_model: str | None
    ios_version: str | None
    log: list[dict[str, Any]]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class JobClaimIn(BaseModel):
    device: DeviceInfo


class JobProgressIn(BaseModel):
    apps: list[JobApp] | None = None
    log: str | None = Field(None, max_length=300)


class JobFinishIn(BaseModel):
    status: Literal["done", "failed", "cancelled"]
    apps: list[JobApp]
    log: str | None = Field(None, max_length=300)


class HeartbeatOut(BaseModel):
    station: StationOut
    next_job: JobOut | None
    request: InstallRequestOut | None


class InstallStatsOut(BaseModel):
    new_requests: int
    in_progress: int
    done_total: int
    installed_today: int
    installed_month: int
    revenue_month: Decimal
    stations_online: int
