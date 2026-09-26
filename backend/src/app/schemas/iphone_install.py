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
    email: str | None = Field(None, max_length=120)   # уже замаскирован помощником
    name: str | None = Field(None, max_length=120)


PURCHASE_KEYS = ("bundle_id", "name", "id", "version", "icon", "genre")


class HeartbeatIn(BaseModel):
    version: str = Field(..., max_length=32)
    device: DeviceInfo | None = None
    apple: AppleState | None = None
    busy: bool = False
    host_name: str | None = Field(None, max_length=80)
    # Состояние консоли целиком (вход, установка, что стоит на телефоне, журнал) — свободная форма
    console: dict[str, Any] | None = None
    # История покупок шлётся только когда изменилась (см. purchases_version)
    purchases: list[dict[str, Any]] | None = Field(None, max_length=3000)
    purchases_version: int = Field(0, ge=0)

    @field_validator("purchases")
    @classmethod
    def _purchases(cls, v: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
        if v is None:
            return None
        clean = []
        for item in v:
            row = {k: item.get(k) for k in PURCHASE_KEYS}
            if not row.get("bundle_id"):
                continue
            for k in ("bundle_id", "name", "version", "icon", "genre"):
                if isinstance(row.get(k), str):
                    row[k] = row[k][:400]
            clean.append(row)
        return clean


COMMAND_TYPES = ("login", "code", "reset_login", "logout", "refresh_purchases", "install", "cancel", "settings")


class StationCommandIn(BaseModel):
    """Команда помощнику из раздела админки. Apple ID покупателя внутри login живёт в памяти сервера
    до ближайшего пульса и никуда не пишется."""
    type: Literal["login", "code", "reset_login", "logout", "refresh_purchases", "install", "cancel", "settings"]
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def _payload(cls, v: dict[str, Any], info: Any) -> dict[str, Any]:
        kind = info.data.get("type")
        if kind == "login":
            email, password = str(v.get("email") or "").strip(), str(v.get("password") or "")
            if "@" not in email or not password:
                raise ValueError("Нужны почта и пароль Apple ID")
            return {"email": email[:120], "password": password[:200]}
        if kind == "code":
            code = str(v.get("code") or "").strip()
            if not code:
                raise ValueError("Нужен код подтверждения")
            return {"code": code[:16]}
        if kind == "install":
            apps = v.get("apps")
            if not isinstance(apps, list) or not 1 <= len(apps) <= 50:
                raise ValueError("Отметьте от 1 до 50 приложений")
            clean = []
            for a in apps:
                if not isinstance(a, dict) or not (a.get("bundle_id") or a.get("id")):
                    raise ValueError("У приложения нет bundle или App Store ID")
                clean.append({"bundle_id": str(a.get("bundle_id") or "")[:200], "id": a.get("id") if isinstance(a.get("id"), int) else None,
                              "name": str(a.get("name") or a.get("bundle_id") or a.get("id"))[:160]})
            return {"apps": clean, "note": (str(v.get("note"))[:300] if v.get("note") else None)}
        if kind == "settings":
            return {"auto_logout": bool(v["auto_logout"])} if "auto_logout" in v else {}
        return {}


class StationCommandOut(BaseModel):
    id: str
    type: str
    payload: dict[str, Any]


class HeartbeatOut(BaseModel):
    station: StationOut
    commands: list[StationCommandOut] = Field(default_factory=list)
    watch: bool = False                 # раздел открыт у сотрудника — пульс чаще
    purchases_version: int = 0          # какую версию списка покупок сервер уже держит


class ConsoleOut(BaseModel):
    station: StationOut
    console: dict[str, Any]
    purchases: list[dict[str, Any]]
    purchases_version: int
    pending_commands: int


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
