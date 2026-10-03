from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ORDER_STATUSES = ("new", "ready", "active", "done", "expired", "cancelled")


def _clean(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


# ── Аккаунт салона ───────────────────────────────────────────────────────────
class AccountIn(BaseModel):
    label: str = Field(..., min_length=2, max_length=80)
    apple_id: str = Field(..., min_length=5, max_length=160)
    note: str | None = Field(None, max_length=300)

    @field_validator("label", "apple_id", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("apple_id")
    @classmethod
    def _email(cls, v: str) -> str:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Apple ID — это почта, например shop@icloud.com")
        return v

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, v: Any) -> Any:
        return _clean(v)


class AccountPatch(BaseModel):
    label: str | None = Field(None, min_length=2, max_length=80)
    apple_id: str | None = Field(None, min_length=5, max_length=160)
    note: str | None = Field(None, max_length=300)
    is_active: bool | None = None

    @field_validator("apple_id")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v.strip()):
            raise ValueError("Apple ID — это почта, например shop@icloud.com")
        return v.strip() if v else v


class AccountOut(BaseModel):
    id: UUID
    label: str
    apple_id: str
    note: str | None
    is_active: bool
    apps_total: int = 0
    apps_active: int = 0
    created_at: datetime


# ── Каталог ──────────────────────────────────────────────────────────────────
class AppOut(BaseModel):
    id: UUID
    account_id: UUID | None
    store_id: int | None
    bundle_id: str
    name: str
    title: str | None
    icon_url: str | None
    version: str | None
    genre: str | None
    category: str | None
    is_bank: bool
    source: str
    in_store: bool | None
    is_active: bool
    sort: int

    model_config = {"from_attributes": True}


class AppCreate(BaseModel):
    account_id: UUID | None = None  # пусто — запись в общий пул
    name: str = Field(..., min_length=1, max_length=200)
    bundle_id: str = Field(..., min_length=3, max_length=200)
    store_id: int | None = Field(None, ge=1)
    icon_url: str | None = Field(None, max_length=500)
    version: str | None = Field(None, max_length=40)
    category: str | None = Field(None, max_length=40)
    is_bank: bool = False

    @field_validator("name", "bundle_id", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("icon_url", "version", "category", mode="before")
    @classmethod
    def _opt(cls, v: Any) -> Any:
        return _clean(v)

    @field_validator("icon_url")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        if v and not v.startswith(("https://", "/")):
            raise ValueError("Ссылка на иконку должна начинаться с https://")
        return v


class AppPatch(BaseModel):
    bundle_id: str | None = Field(None, min_length=3, max_length=200)  # только у записей общего пула
    title: str | None = Field(None, max_length=120)
    icon_url: str | None = Field(None, max_length=500)
    store_id: int | None = Field(None, ge=1)
    category: str | None = Field(None, max_length=40)
    is_bank: bool | None = None
    is_active: bool | None = None
    sort: int | None = Field(None, ge=-10000, le=10000)

    @field_validator("icon_url")
    @classmethod
    def _icon(cls, v: str | None) -> str | None:
        if v and not v.strip().startswith(("https://", "/")):
            raise ValueError("Ссылка на иконку должна начинаться с https://")
        return v.strip() if v else v


class AppBulkIn(BaseModel):
    ids: list[UUID] = Field(..., min_length=1, max_length=3000)
    is_active: bool


class ImportIn(BaseModel):
    station_id: UUID
    force: bool = False


class ImportOut(BaseModel):
    total: int
    created: int
    updated: int
    created_ids: list[UUID]


class StoreCheckIn(BaseModel):
    account_id: UUID | None = None


class StoreCheckOut(BaseModel):
    checked: int
    in_store: int
    removed: int
    failed: int


# ── Настройки услуги ─────────────────────────────────────────────────────────
class InstallsConfig(BaseModel):
    price: int = Field(350, ge=0, le=100000)
    bulk_price: int = Field(300, ge=0, le=100000)
    bulk_min: int = Field(3, ge=2, le=50)
    window_minutes: int = Field(60, ge=10, le=24 * 60)
    code_limit: int = Field(3, ge=1, le=20)
    storefront_enabled: bool = False
    payment_text: str = Field("", max_length=600)
    support_phone: str = Field("", max_length=40)
    support_telegram: str = Field("", max_length=80)
    # Только для чтения: задан ли пароль менеджера (сам хэш наружу не отдаётся)
    staff_code_set: bool = False


class StaffCodeIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=40, description="Пароль менеджера для режима установки")

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 4:
            raise ValueError("Пароль менеджера — минимум 4 символа")
        return v


# ── Заказы ───────────────────────────────────────────────────────────────────
class OrderCreateIn(BaseModel):
    app_ids: list[UUID] = Field(..., min_length=1, max_length=30)
    account_id: UUID | None = None  # каким Apple ID салона ставить; пусто — единственный активный
    mode: Literal["staff", "self"] = "staff"
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str | None = Field(None, max_length=32)
    note: str | None = Field(None, max_length=300)
    price: int | None = Field(None, ge=0, le=1_000_000)
    paid: bool = True

    @field_validator("customer_name", "customer_phone", "note", mode="before")
    @classmethod
    def _opt(cls, v: Any) -> Any:
        return _clean(v)


class OrderOut(BaseModel):
    id: UUID
    number: int
    token: str
    account_id: UUID | None
    account_label: str | None
    apple_id: str | None = None
    status: str
    mode: str
    source: str
    apps: list[dict[str, Any]]
    price: int
    customer_name: str | None
    customer_phone: str | None
    note: str | None
    created_by: str | None
    created_at: datetime
    paid_at: datetime | None
    started_at: datetime | None
    expires_at: datetime | None
    finished_at: datetime | None
    seconds_left: int | None = None
    code_requests: int
    code_limit: int
    code_requested_at: datetime | None
    code_value: str | None
    code_delivered_at: datetime | None
    code_waiting: bool = False
    events: list[dict[str, Any]]
    rating: int | None
    feedback: str | None


class OrderActionIn(BaseModel):
    action: Literal["confirm_payment", "start", "extend", "done", "cancel", "reopen", "reset_codes", "set_mode"]
    minutes: int | None = Field(None, ge=5, le=24 * 60)
    mode: Literal["staff", "self"] | None = None


class OrderCodeIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=12)

    @field_validator("code")
    @classmethod
    def _digits(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) != 6:
            raise ValueError("Код подтверждения Apple — 6 цифр")
        return digits


class OrderAppPatch(BaseModel):
    status: Literal["pending", "installed"]


class OrderStatsOut(BaseModel):
    orders_today: int
    orders_month: int
    apps_month: int
    revenue_today: int
    revenue_month: int
    waiting: int      # новые заявки с сайта, ждут подтверждения
    active: int       # сейчас идёт установка
    code_waiting: int  # покупатель ждёт код


# ── Публичная часть ──────────────────────────────────────────────────────────
class PublicOrderCreateIn(BaseModel):
    app_ids: list[UUID] = Field(..., min_length=1, max_length=30)
    name: str = Field(..., min_length=2, max_length=80)
    phone: str = Field(..., min_length=10, max_length=32)
    consent: bool

    @field_validator("name", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) == 10:
            digits = "7" + digits
        if len(digits) == 11 and digits[0] == "8":
            digits = "7" + digits[1:]
        if not (len(digits) == 11 and digits[0] == "7"):
            raise ValueError("Укажите телефон полностью, например +7 912 345-67-89")
        return "+" + digits

    @field_validator("consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Нужно согласие на обработку персональных данных")
        return v


class PublicAppDoneIn(BaseModel):
    done: bool = True


class PublicFinishIn(BaseModel):
    rating: int | None = Field(None, ge=1, le=5)
    text: str | None = Field(None, max_length=500)

    @field_validator("text", mode="before")
    @classmethod
    def _opt(cls, v: Any) -> Any:
        return _clean(v)


class PublicCatalogApp(BaseModel):
    id: UUID
    name: str
    bundle_id: str
    icon_url: str | None
    version: str | None
    genre: str | None
    category: str | None
    is_bank: bool


class PublicCatalogOut(BaseModel):
    enabled: bool               # витрина (приём заявок с сайта) включена
    staff_mode: bool            # задан пароль менеджера → доступен режим установки
    price: int
    bulk_price: int
    bulk_min: int
    window_minutes: int
    support_phone: str
    support_telegram: str
    apps: list[PublicCatalogApp]


class PublicStaffCheckIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=40)


class PublicStaffOrderIn(BaseModel):
    """Менеджер в салоне: выбрал приложения на /apps и ввёл свой пароль, чтобы начать установку."""
    app_ids: list[UUID] = Field(..., min_length=1, max_length=30)
    code: str = Field(..., min_length=1, max_length=40)
    account_id: UUID | None = None


class PublicOrderCreatedOut(BaseModel):
    number: int
    token: str


class PublicCodeState(BaseModel):
    requests: int
    limit: int
    waiting: bool               # покупатель попросил код, менеджер ещё не ввёл
    value: str | None           # код, пока он свежий
    age_seconds: int | None
    fresh_seconds: int
    retry_in: int               # через сколько секунд можно попросить ещё раз


class PublicOrderOut(BaseModel):
    number: int
    status: str
    mode: str
    apps: list[dict[str, Any]]
    price: int
    paid: bool
    created_at: datetime
    expires_at: datetime | None
    seconds_left: int | None
    window_minutes: int
    apple_id: str | None        # только пока идёт установка
    code: PublicCodeState
    payment_text: str
    support_phone: str
    support_telegram: str
    rating: int | None
