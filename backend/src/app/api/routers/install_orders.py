"""
Услуга «Приложения на iPhone», модель «аккаунт салона»: /installs/*

  /installs/accounts, /installs/catalog — Apple ID салона и каталог приложений из его истории покупок
  /installs/settings                    — цены, окно установки, витрина на сайте
  /installs/orders                      — заказы (админка)
  /installs/public/*                    — витрина и персональная страница заказа /i/<token>

Как это работает: приложения, которых больше нет в App Store, остаются в истории покупок
Apple ID салона. На время установки на телефоне покупателя в разделе «Контент и покупки»
вводится этот Apple ID, выбранное скачивается из App Store, после чего покупатель возвращает
свой аккаунт. iCloud покупателя не трогается.

Пароль Apple ID салона на сервере не хранится и отсюда никуда не отдаётся: его знает и вводит
сотрудник. Код подтверждения, который сотрудник передаёт покупателю через страницу заказа,
живёт в памяти процесса CODE_FRESH_SECONDS секунд и в базу не пишется.
"""
from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import ValidationError

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.push_service import send_push_to_all
from src.app.database.models.admin import Admin
from src.app.database.models.install_order import InstallAccount, InstallApp, InstallOrder
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.install_order import (
    AccountIn, AccountOut, AccountPatch, AppBulkIn, AppCreate, AppOut, AppPatch, ImportIn, ImportOut,
    InstallsConfig, OrderActionIn, OrderAppPatch, OrderCodeIn, OrderCreateIn, OrderOut, OrderStatsOut,
    PublicAppDoneIn, PublicCatalogApp, PublicCatalogOut, PublicCodeState, PublicFinishIn,
    PublicOrderCreatedOut, PublicOrderCreateIn, PublicOrderOut, StoreCheckIn, StoreCheckOut,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/installs", tags=["iPhone installs · заказы"])

ADMIN = [Depends(get_current_admin)]
CONFIG_KEY = "installs_config"
MAX_EVENTS = 100
OPEN_STATUSES = ("new", "ready", "active")

# Код подтверждения: order_id → (код, когда сотрудник его ввёл). Только в памяти процесса.
ORDER_CODES: dict[str, tuple[str, float]] = {}
CODE_FRESH_SECONDS = 90
CODE_REQUEST_GAP_SECONDS = 20

# Заявки с сайта: не больше PUBLIC_CREATE_LIMIT с одного адреса в час
PUBLIC_CREATE_HITS: dict[str, list[float]] = {}
PUBLIC_CREATE_LIMIT = 5
ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup"
ITUNES_CHUNK = 150


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mask_email(email: str | None) -> str | None:
    """Как помощник на Mac маскирует Apple ID: первые два символа и домен."""
    if not email or "@" not in email:
        return None
    name, domain = email.split("@", 1)
    return f"{name[:2]}***@{domain}"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _config(uow: UnitOfWork) -> InstallsConfig:
    raw = await uow.site_settings.get(CONFIG_KEY)
    if isinstance(raw, dict):
        try:
            return InstallsConfig(**raw)
        except ValidationError:
            logger.warning("installs_config_invalid")
    return InstallsConfig()


def _price_for(cfg: InstallsConfig, count: int) -> int:
    return count * (cfg.bulk_price if count >= cfg.bulk_min else cfg.price)


def _events(order: InstallOrder | None, who: str, msg: str) -> list[dict[str, Any]]:
    log = list((order.events if order else None) or [])
    log.append({"t": _now().isoformat(timespec="seconds"), "who": who, "msg": msg[:300]})
    return log[-MAX_EVENTS:]


def _fresh_code(order_id: UUID) -> tuple[str, int] | None:
    item = ORDER_CODES.get(str(order_id))
    if not item:
        return None
    age = time.time() - item[1]
    if age > CODE_FRESH_SECONDS:
        ORDER_CODES.pop(str(order_id), None)
        return None
    return item[0], int(age)


def _code_waiting(order: InstallOrder) -> bool:
    return order.status == "active" and order.code_requested_at is not None and (
        order.code_delivered_at is None or order.code_delivered_at < order.code_requested_at)


def _seconds_left(order: InstallOrder) -> int | None:
    if order.status != "active" or not order.expires_at:
        return None
    return max(0, int((order.expires_at - _now()).total_seconds()))


async def _expire(uow: UnitOfWork, order: InstallOrder) -> tuple[InstallOrder, bool]:
    """Окно установки вышло — заказ закрывается сам при первом же чтении."""
    if order.status == "active" and order.expires_at and order.expires_at <= _now():
        ORDER_CODES.pop(str(order.id), None)
        fresh = await uow.install_orders.update(order.id, status="expired",
                                                events=_events(order, "system", "Время на установку вышло"))
        return fresh or order, True
    return order, False


def _order_out(order: InstallOrder, cfg: InstallsConfig, accounts: dict[UUID, InstallAccount]) -> OrderOut:
    acc = accounts.get(order.account_id) if order.account_id else None
    fresh = _fresh_code(order.id)
    return OrderOut(
        id=order.id, number=order.number, token=order.token, account_id=order.account_id,
        account_label=(acc.label if acc else order.account_label), apple_id=(acc.apple_id if acc else None),
        status=order.status, mode=order.mode, source=order.source, apps=order.apps or [], price=order.price,
        customer_name=order.customer_name, customer_phone=order.customer_phone, note=order.note,
        created_by=order.created_by, created_at=order.created_at, paid_at=order.paid_at, started_at=order.started_at,
        expires_at=order.expires_at, finished_at=order.finished_at, seconds_left=_seconds_left(order),
        code_requests=order.code_requests, code_limit=cfg.code_limit, code_requested_at=order.code_requested_at,
        code_value=(fresh[0] if fresh else None), code_delivered_at=order.code_delivered_at,
        code_waiting=_code_waiting(order), events=order.events or [], rating=order.rating, feedback=order.feedback,
    )


async def _accounts_map(uow: UnitOfWork) -> dict[UUID, InstallAccount]:
    return {a.id: a for a in await uow.install_accounts.list_all()}


async def _pick_apps(uow: UnitOfWork, app_ids: list[UUID], *, public: bool) -> tuple[list[InstallApp], InstallAccount]:
    """Приложения заказа в том порядке, в каком их выбрали, и аккаунт салона, на котором они лежат."""
    ids = list(dict.fromkeys(app_ids))
    rows = {r.id: r for r in await uow.install_apps.get_many(ids)}
    if len(rows) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено в каталоге — обновите страницу")
    apps = [rows[i] for i in ids]
    account_ids = {a.account_id for a in apps}
    if len(account_ids) > 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Выбранные приложения лежат на разных Apple ID салона. Оформите их отдельными заказами: "
                            "на телефоне одновременно может быть введён только один аккаунт.")
    account = await uow.install_accounts.get_by_id(next(iter(account_ids)))
    if not account:
        raise HTTPException(status.HTTP_409_CONFLICT, "Аккаунт салона для этих приложений удалён")
    if public and (not account.is_active or any(not a.is_active for a in apps)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Часть приложений больше недоступна — обновите страницу")
    return apps, account


def _order_apps(apps: list[InstallApp]) -> list[dict[str, Any]]:
    return [{
        "key": uuid4().hex[:10], "app_id": str(a.id), "bundle_id": a.bundle_id, "store_id": a.store_id,
        "name": a.title or a.name, "icon_url": a.icon_url, "version": a.version, "status": "pending",
    } for a in apps]


async def _push(title: str, body: str, order: InstallOrder) -> None:
    try:
        await send_push_to_all(title, body, url=f"/admin?tab=installs&order={order.id}", tag=f"install-{order.number}")
    except Exception as exc:  # noqa: BLE001 — пуш не должен ронять заказ
        logger.error("install_push_error", error=str(exc))


# ═════════════════════════════════════════════════════════════════════════════
# Аккаунты салона
# ═════════════════════════════════════════════════════════════════════════════

def _account_out(a: InstallAccount, counts: dict[UUID, tuple[int, int]]) -> AccountOut:
    total, active = counts.get(a.id, (0, 0))
    return AccountOut(id=a.id, label=a.label, apple_id=a.apple_id, note=a.note, is_active=a.is_active,
                      apps_total=total, apps_active=active, created_at=a.created_at)


@router.get("/accounts", response_model=list[AccountOut], dependencies=ADMIN, summary="Apple ID салона")
async def list_accounts() -> list[AccountOut]:
    async with UnitOfWork() as uow:
        counts = await uow.install_apps.counts()
        return [_account_out(a, counts) for a in await uow.install_accounts.list_all()]


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN)
async def create_account(body: AccountIn) -> AccountOut:
    async with UnitOfWork() as uow:
        for a in await uow.install_accounts.list_all():
            if a.apple_id.lower() == body.apple_id.lower():
                raise HTTPException(status.HTTP_409_CONFLICT, "Такой Apple ID уже добавлен")
        account = await uow.install_accounts.create(label=body.label, apple_id=body.apple_id, note=body.note)
        await uow.commit()
        return _account_out(account, {})


@router.patch("/accounts/{account_id}", response_model=AccountOut, dependencies=ADMIN)
async def patch_account(account_id: UUID, body: AccountPatch) -> AccountOut:
    data = body.model_dump(exclude_unset=True)
    async with UnitOfWork() as uow:
        account = await uow.install_accounts.get_by_id(account_id)
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Аккаунт не найден")
        if data:
            account = await uow.install_accounts.update(account_id, **data)
            await uow.commit()
        return _account_out(account, await uow.install_apps.counts())


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN,
               summary="Удалить аккаунт вместе с его каталогом")
async def delete_account(account_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if await uow.install_orders.open_for_account(account_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "По этому аккаунту есть незакрытые заказы — сначала завершите или отмените их")
        if not await uow.install_accounts.delete(account_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Аккаунт не найден")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/accounts/{account_id}/import", response_model=ImportOut, dependencies=ADMIN,
             summary="Заполнить каталог из истории покупок, которую прочитал помощник на Mac")
async def import_catalog(account_id: UUID, body: ImportIn) -> ImportOut:
    async with UnitOfWork() as uow:
        account = await uow.install_accounts.get_by_id(account_id)
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Аккаунт не найден")
        station = await uow.install_stations.get_by_id(body.station_id)
        if not station:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Помощник не найден")
        apple = (station.state or {}).get("apple") or {}
        purchases = station.purchases or []
        if not apple.get("logged_in") or not purchases:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "На помощнике не выполнен вход в Apple ID или история покупок ещё читается. "
                                "Откройте вкладку «По кабелю», войдите в аккаунт салона и дождитесь списка.")
        expected, got = mask_email(account.apple_id), apple.get("email")
        if not body.force and (not got or (expected or "").lower() != str(got).lower()):
            raise HTTPException(status.HTTP_409_CONFLICT, {
                "code": "account_mismatch",
                "message": f"На помощнике сейчас введён другой Apple ID ({got or 'неизвестно'}), а каталог заполняется для {expected}.",
                "station_email": got, "account_email": expected,
            })
        known = await uow.install_apps.by_bundle(account_id)
        created_ids: list[UUID] = []
        updated = 0
        new_rows: list[InstallApp] = []
        for p in purchases:
            bundle = str(p.get("bundle_id") or "").strip()[:200]
            if not bundle:
                continue
            name = str(p.get("name") or bundle).strip()[:200] or bundle
            store_id = p.get("id") if isinstance(p.get("id"), int) and p.get("id") > 0 else None
            icon = p.get("icon") if isinstance(p.get("icon"), str) and p.get("icon").startswith("https://") else None
            version = str(p.get("version"))[:40] if p.get("version") else None
            genre = str(p.get("genre"))[:80] if p.get("genre") else None
            row = known.get(bundle)
            if row is None:
                app_id = uuid4()
                new_rows.append(InstallApp(id=app_id, account_id=account_id, store_id=store_id, bundle_id=bundle, name=name,
                                           icon_url=icon[:500] if icon else None, version=version, genre=genre))
                created_ids.append(app_id)
                known[bundle] = new_rows[-1]
                continue
            changed = False
            for field, value in (("name", name), ("store_id", store_id), ("version", version), ("genre", genre),
                                 ("icon_url", icon[:500] if icon else None)):
                if value is not None and getattr(row, field) != value:
                    setattr(row, field, value)
                    changed = True
            updated += int(changed)
        if new_rows:
            uow.install_apps.session.add_all(new_rows)
        await uow.commit()
    logger.info("install_catalog_imported", account=str(account_id), total=len(purchases), created=len(created_ids), updated=updated)
    return ImportOut(total=len(purchases), created=len(created_ids), updated=updated, created_ids=created_ids)


# ═════════════════════════════════════════════════════════════════════════════
# Каталог
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/catalog", response_model=list[AppOut], dependencies=ADMIN, summary="Каталог приложений")
async def list_catalog(account_id: UUID | None = None, only_active: bool = False) -> list[AppOut]:
    async with UnitOfWork() as uow:
        return [AppOut.model_validate(a) for a in await uow.install_apps.list_for(account_id=account_id, only_active=only_active)]


@router.post("/catalog", response_model=AppOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN,
             summary="Добавить приложение вручную")
async def create_app(body: AppCreate) -> AppOut:
    async with UnitOfWork() as uow:
        if not await uow.install_accounts.get_by_id(body.account_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Аккаунт не найден")
        if body.bundle_id in await uow.install_apps.by_bundle(body.account_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Это приложение уже есть в каталоге аккаунта")
        app = await uow.install_apps.create(account_id=body.account_id, name=body.name, bundle_id=body.bundle_id,
                                            store_id=body.store_id, icon_url=body.icon_url, version=body.version, is_active=True)
        await uow.commit()
        return AppOut.model_validate(app)


@router.post("/catalog/bulk", dependencies=ADMIN, summary="Показать или скрыть сразу несколько приложений")
async def bulk_catalog(body: AppBulkIn) -> dict:
    async with UnitOfWork() as uow:
        changed = await uow.install_apps.set_active(body.ids, body.is_active)
        await uow.commit()
    return {"changed": changed}


@router.post("/catalog/check-store", response_model=StoreCheckOut, dependencies=ADMIN,
             summary="Сверить каталог с российским App Store: что там ещё есть, а чего уже нет")
async def check_store(body: StoreCheckIn) -> StoreCheckOut:
    async with UnitOfWork() as uow:
        apps = [a for a in await uow.install_apps.list_for(account_id=body.account_id) if a.store_id]
        found: dict[int, dict[str, Any]] = {}
        failed_ids: set[int] = set()
        ids = [int(a.store_id) for a in apps]
        async with httpx.AsyncClient(timeout=15.0) as client:
            for i in range(0, len(ids), ITUNES_CHUNK):
                chunk = ids[i:i + ITUNES_CHUNK]
                try:
                    res = await client.get(ITUNES_LOOKUP_URL, params={"id": ",".join(map(str, chunk)), "country": "ru", "entity": "software"})
                    res.raise_for_status()
                    for item in res.json().get("results") or []:
                        if isinstance(item.get("trackId"), int):
                            found[item["trackId"]] = item
                except (httpx.HTTPError, ValueError) as exc:
                    logger.warning("install_store_check_failed", error=str(exc), size=len(chunk))
                    failed_ids.update(chunk)
        in_store = removed = 0
        for a in apps:
            sid = int(a.store_id)
            if sid in failed_ids:
                continue
            item = found.get(sid)
            a.in_store = item is not None
            if item:
                in_store += 1
                icon = item.get("artworkUrl512") or item.get("artworkUrl100")
                if not a.icon_url and isinstance(icon, str) and icon.startswith("https://"):
                    a.icon_url = icon[:500]
                if not a.genre and isinstance(item.get("primaryGenreName"), str):
                    a.genre = item["primaryGenreName"][:80]
            else:
                removed += 1
        await uow.commit()
    return StoreCheckOut(checked=in_store + removed, in_store=in_store, removed=removed, failed=len(failed_ids))


@router.patch("/catalog/{app_id}", response_model=AppOut, dependencies=ADMIN)
async def patch_app(app_id: UUID, body: AppPatch) -> AppOut:
    data = body.model_dump(exclude_unset=True)
    if "title" in data:
        data["title"] = (data["title"] or "").strip() or None
    async with UnitOfWork() as uow:
        app = await uow.install_apps.get_by_id(app_id)
        if not app:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено")
        if data:
            app = await uow.install_apps.update(app_id, **data)
            await uow.commit()
        return AppOut.model_validate(app)


@router.delete("/catalog/{app_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def delete_app(app_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.install_apps.delete(app_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ═════════════════════════════════════════════════════════════════════════════
# Настройки услуги
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/settings", response_model=InstallsConfig, dependencies=ADMIN)
async def get_settings() -> InstallsConfig:
    async with UnitOfWork() as uow:
        return await _config(uow)


@router.put("/settings", response_model=InstallsConfig, dependencies=ADMIN)
async def put_settings(body: InstallsConfig) -> InstallsConfig:
    async with UnitOfWork() as uow:
        await uow.site_settings.set(CONFIG_KEY, body.model_dump())
        await uow.commit()
    logger.info("installs_config_updated", storefront=body.storefront_enabled, price=body.price)
    return body


# ═════════════════════════════════════════════════════════════════════════════
# Заказы — админка
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/orders", response_model=list[OrderOut], dependencies=ADMIN, summary="Заказы на установку")
async def list_orders(scope: str = Query("all", pattern="^(all|open)$"), limit: int = Query(200, ge=1, le=500),
                      brief: bool = Query(False, description="без журнала событий — для частого опроса списка")) -> list[OrderOut]:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        accounts = await _accounts_map(uow)
        rows = await uow.install_orders.list_recent(limit, list(OPEN_STATUSES) if scope == "open" else None)
        out, dirty = [], False
        for row in rows:
            row, changed = await _expire(uow, row)
            dirty = dirty or changed
            if scope == "open" and row.status not in OPEN_STATUSES:
                continue
            item = _order_out(row, cfg, accounts)
            if brief:
                item.events = []
            out.append(item)
        if dirty:
            await uow.commit()
        return out


@router.get("/orders/stats", response_model=OrderStatsOut, dependencies=ADMIN, summary="Сводка по заказам")
async def orders_stats() -> OrderStatsOut:
    now = _now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    async with UnitOfWork() as uow:
        month = await uow.install_orders.since(month_start)
        counts = await uow.install_orders.status_counts()
        active = await uow.install_orders.list_recent(200, ["active"])
    live = [o for o in month if o.status != "cancelled"]
    paid = [o for o in live if o.paid_at]
    return OrderStatsOut(
        orders_today=sum(1 for o in live if o.created_at >= day_start), orders_month=len(live),
        apps_month=sum(sum(1 for a in o.apps or [] if a.get("status") == "installed") for o in live),
        revenue_today=sum(o.price for o in paid if o.paid_at >= day_start), revenue_month=sum(o.price for o in paid),
        waiting=counts.get("new", 0), active=counts.get("active", 0), code_waiting=sum(1 for o in active if _code_waiting(o)),
    )


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED, summary="Оформить заказ в салоне")
async def create_order(body: OrderCreateIn, admin: Admin = Depends(get_current_admin)) -> OrderOut:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        apps, account = await _pick_apps(uow, body.app_ids, public=False)
        order = await uow.install_orders.create(
            token=secrets.token_urlsafe(18), account_id=account.id, account_label=account.label, status="ready",
            mode=body.mode, source="admin", apps=_order_apps(apps),
            price=body.price if body.price is not None else _price_for(cfg, len(apps)),
            customer_name=body.customer_name, customer_phone=body.customer_phone, note=body.note,
            created_by=admin.username, paid_at=_now() if body.paid else None,
            events=_events(None, "admin", f"Заказ оформлен: {len(apps)} прил."),
        )
        await uow.commit()
        return _order_out(order, cfg, {account.id: account})


async def _admin_order(uow: UnitOfWork, order_id: UUID) -> InstallOrder:
    order = await uow.install_orders.get_by_id(order_id)
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")
    order, _ = await _expire(uow, order)
    return order


@router.get("/orders/{order_id}", response_model=OrderOut, dependencies=ADMIN)
async def get_order(order_id: UUID) -> OrderOut:
    async with UnitOfWork() as uow:
        order = await _admin_order(uow, order_id)
        await uow.commit()
        return _order_out(order, await _config(uow), await _accounts_map(uow))


@router.post("/orders/{order_id}/action", response_model=OrderOut, dependencies=ADMIN, summary="Действие с заказом")
async def order_action(order_id: UUID, body: OrderActionIn) -> OrderOut:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        order = await _admin_order(uow, order_id)
        now = _now()
        data: dict[str, Any] = {}
        act = body.action
        if act == "confirm_payment":
            if order.status == "cancelled":
                raise HTTPException(status.HTTP_409_CONFLICT, "Заказ отменён")
            data = {"paid_at": order.paid_at or now, "events": _events(order, "admin", "Оплата получена")}
            if order.status == "new":
                data["status"] = "ready"
        elif act == "start":
            if order.status not in ("new", "ready", "expired"):
                raise HTTPException(status.HTTP_409_CONFLICT, "Установку можно начать только у нового заказа")
            data = {"status": "active", "started_at": order.started_at or now,
                    "expires_at": now + timedelta(minutes=body.minutes or cfg.window_minutes),
                    "events": _events(order, "admin", "Установка начата")}
        elif act == "extend":
            if order.status not in ("active", "expired"):
                raise HTTPException(status.HTTP_409_CONFLICT, "Продлить можно только идущую или просроченную установку")
            base = order.expires_at if order.status == "active" and order.expires_at and order.expires_at > now else now
            minutes = body.minutes or 30
            data = {"status": "active", "started_at": order.started_at or now, "expires_at": base + timedelta(minutes=minutes),
                    "events": _events(order, "admin", f"Время продлено на {minutes} мин")}
        elif act == "done":
            if order.status == "cancelled":
                raise HTTPException(status.HTTP_409_CONFLICT, "Заказ отменён")
            data = {"status": "done", "finished_at": now, "events": _events(order, "admin", "Заказ закрыт")}
        elif act == "cancel":
            data = {"status": "cancelled", "finished_at": now, "events": _events(order, "admin", "Заказ отменён")}
        elif act == "reopen":
            if order.status not in ("done", "cancelled", "expired"):
                raise HTTPException(status.HTTP_409_CONFLICT, "Заказ и так открыт")
            data = {"status": "ready", "finished_at": None, "expires_at": None,
                    "events": _events(order, "admin", "Заказ открыт заново")}
        elif act == "reset_codes":
            data = {"code_requests": 0, "code_requested_at": None, "code_delivered_at": None,
                    "events": _events(order, "admin", "Счётчик кодов сброшен")}
        elif act == "set_mode":
            if not body.mode:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Не указано, где идёт установка")
            data = {"mode": body.mode}
        if data.get("status") in ("done", "cancelled") or act == "reset_codes":
            ORDER_CODES.pop(str(order.id), None)
        order = await uow.install_orders.update(order_id, **data)
        await uow.commit()
        return _order_out(order, cfg, await _accounts_map(uow))


@router.post("/orders/{order_id}/code", response_model=OrderOut, dependencies=ADMIN,
             summary="Передать покупателю код подтверждения с доверенного устройства салона")
async def deliver_code(order_id: UUID, body: OrderCodeIn) -> OrderOut:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        order = await _admin_order(uow, order_id)
        if order.status != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, "Код передаётся только пока идёт установка. Нажмите «Начать» или «Продлить».")
        ORDER_CODES[str(order.id)] = (body.code, time.time())
        order = await uow.install_orders.update(order_id, code_delivered_at=_now(),
                                                events=_events(order, "admin", "Код передан покупателю"))
        await uow.commit()
        return _order_out(order, cfg, await _accounts_map(uow))


def _set_app_status(order: InstallOrder, key: str, new_status: str) -> list[dict[str, Any]]:
    apps = [dict(a) for a in order.apps or []]
    for a in apps:
        if a.get("key") == key:
            a["status"] = new_status
            return apps
    raise HTTPException(status.HTTP_404_NOT_FOUND, "В заказе нет такого приложения")


@router.patch("/orders/{order_id}/apps/{key}", response_model=OrderOut, dependencies=ADMIN)
async def admin_mark_app(order_id: UUID, key: str, body: OrderAppPatch) -> OrderOut:
    async with UnitOfWork() as uow:
        order = await _admin_order(uow, order_id)
        order = await uow.install_orders.update(order_id, apps=_set_app_status(order, key, body.status))
        await uow.commit()
        return _order_out(order, await _config(uow), await _accounts_map(uow))


@router.delete("/orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def delete_order(order_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.install_orders.delete(order_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден")
        await uow.commit()
    ORDER_CODES.pop(str(order_id), None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ═════════════════════════════════════════════════════════════════════════════
# Публичная часть: витрина и страница заказа
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/public/catalog", response_model=PublicCatalogOut, summary="Витрина услуги (если включена)")
async def public_catalog() -> PublicCatalogOut:
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        apps = await uow.install_apps.list_for(only_active=True) if cfg.storefront_enabled else []
    return PublicCatalogOut(
        enabled=cfg.storefront_enabled, price=cfg.price, bulk_price=cfg.bulk_price, bulk_min=cfg.bulk_min,
        window_minutes=cfg.window_minutes, support_phone=cfg.support_phone, support_telegram=cfg.support_telegram,
        apps=[PublicCatalogApp(id=a.id, name=a.title or a.name, bundle_id=a.bundle_id, icon_url=a.icon_url,
                               version=a.version, genre=a.genre) for a in apps],
    )


@router.post("/public/orders", response_model=PublicOrderCreatedOut, status_code=status.HTTP_201_CREATED,
             summary="Заявка с сайта")
async def public_create_order(body: PublicOrderCreateIn, request: Request, background: BackgroundTasks) -> PublicOrderCreatedOut:
    ip = _client_ip(request)
    now = time.time()
    hits = [t for t in PUBLIC_CREATE_HITS.get(ip, []) if now - t < 3600]
    if len(hits) >= PUBLIC_CREATE_LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много заявок с этого адреса. Попробуйте позже или позвоните нам.")
    async with UnitOfWork() as uow:
        cfg = await _config(uow)
        if not cfg.storefront_enabled:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Заказ через сайт сейчас не принимается — приходите в салон")
        apps, account = await _pick_apps(uow, body.app_ids, public=True)
        order = await uow.install_orders.create(
            token=secrets.token_urlsafe(18), account_id=account.id, account_label=account.label, status="new",
            mode="self", source="site", apps=_order_apps(apps), price=_price_for(cfg, len(apps)),
            customer_name=body.name, customer_phone=body.phone,
            events=_events(None, "customer", f"Заявка с сайта: {len(apps)} прил."),
        )
        await uow.commit()
    hits.append(now)
    PUBLIC_CREATE_HITS[ip] = hits
    if len(PUBLIC_CREATE_HITS) > 5000:  # счётчик в памяти не растёт бесконечно
        for key in [k for k, v in PUBLIC_CREATE_HITS.items() if not v or now - v[-1] > 3600]:
            PUBLIC_CREATE_HITS.pop(key, None)
    background.add_task(_push, "Новая заявка: приложения на iPhone",
                        f"№{order.number} · {body.name} · {len(apps)} прил. · {order.price} ₽", order)
    return PublicOrderCreatedOut(number=order.number, token=order.token)


async def _public_order(uow: UnitOfWork, token: str) -> InstallOrder:
    order = await uow.install_orders.get_by_token(token) if 16 <= len(token) <= 40 else None
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заказ не найден. Проверьте ссылку.")
    order, changed = await _expire(uow, order)
    if changed:
        await uow.commit()
    return order


async def _public_out(uow: UnitOfWork, order: InstallOrder, response: Response) -> PublicOrderOut:
    response.headers["Cache-Control"] = "no-store"
    cfg = await _config(uow)
    account = await uow.install_accounts.get_by_id(order.account_id) if order.account_id else None
    fresh = _fresh_code(order.id) if order.status == "active" else None
    since_request = (_now() - order.code_requested_at).total_seconds() if order.code_requested_at else None
    retry_in = max(0, int(CODE_REQUEST_GAP_SECONDS - since_request)) if since_request is not None else 0
    return PublicOrderOut(
        number=order.number, status=order.status, mode=order.mode,
        apps=[{k: a.get(k) for k in ("key", "bundle_id", "store_id", "name", "icon_url", "version", "status")} for a in order.apps or []],
        price=order.price, paid=order.paid_at is not None, created_at=order.created_at, expires_at=order.expires_at,
        seconds_left=_seconds_left(order), window_minutes=cfg.window_minutes,
        apple_id=(account.apple_id if account and order.status == "active" else None),
        code=PublicCodeState(requests=order.code_requests, limit=cfg.code_limit, waiting=_code_waiting(order),
                             value=(fresh[0] if fresh else None), age_seconds=(fresh[1] if fresh else None),
                             fresh_seconds=CODE_FRESH_SECONDS, retry_in=retry_in),
        payment_text=cfg.payment_text if order.status == "new" else "",
        support_phone=cfg.support_phone, support_telegram=cfg.support_telegram, rating=order.rating,
    )


@router.get("/public/orders/{token}", response_model=PublicOrderOut, summary="Страница заказа")
async def public_get_order(token: str, response: Response) -> PublicOrderOut:
    async with UnitOfWork() as uow:
        return await _public_out(uow, await _public_order(uow, token), response)


@router.post("/public/orders/{token}/start", response_model=PublicOrderOut, summary="Покупатель начал установку")
async def public_start(token: str, response: Response) -> PublicOrderOut:
    async with UnitOfWork() as uow:
        order = await _public_order(uow, token)
        if order.status == "ready":
            cfg = await _config(uow)
            now = _now()
            order = await uow.install_orders.update(order.id, status="active", started_at=now,
                                                    expires_at=now + timedelta(minutes=cfg.window_minutes),
                                                    events=_events(order, "customer", "Установка начата"))
            await uow.commit()
        elif order.status != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, {
                "new": "Заказ ещё не подтверждён менеджером",
                "expired": "Время на установку вышло — попросите менеджера продлить",
                "done": "Заказ уже завершён", "cancelled": "Заказ отменён",
            }.get(order.status, "Сейчас начать нельзя"))
        return await _public_out(uow, order, response)


@router.post("/public/orders/{token}/code", response_model=PublicOrderOut, summary="Покупатель просит код подтверждения")
async def public_request_code(token: str, response: Response, background: BackgroundTasks) -> PublicOrderOut:
    async with UnitOfWork() as uow:
        order = await _public_order(uow, token)
        cfg = await _config(uow)
        if order.status != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, "Код выдаётся только пока идёт установка")
        if order.code_requests >= cfg.code_limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Попытки закончились — свяжитесь с менеджером, он выдаст ещё")
        now = _now()
        if order.code_requested_at and (now - order.code_requested_at).total_seconds() < CODE_REQUEST_GAP_SECONDS:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Код уже запрошен — подождите несколько секунд")
        ORDER_CODES.pop(str(order.id), None)
        order = await uow.install_orders.update(order.id, code_requests=order.code_requests + 1, code_requested_at=now,
                                                events=_events(order, "customer", "Покупатель просит код подтверждения"))
        await uow.commit()
        background.add_task(_push, f"Заказ №{order.number}: нужен код",
                            "Покупатель ждёт код подтверждения Apple ID — откройте заказ и введите его", order)
        return await _public_out(uow, order, response)


@router.post("/public/orders/{token}/apps/{key}", response_model=PublicOrderOut, summary="Покупатель отметил приложение")
async def public_mark_app(token: str, key: str, body: PublicAppDoneIn, response: Response) -> PublicOrderOut:
    async with UnitOfWork() as uow:
        order = await _public_order(uow, token)
        if order.status != "active":
            raise HTTPException(status.HTTP_409_CONFLICT, "Заказ сейчас не в работе")
        order = await uow.install_orders.update(order.id, apps=_set_app_status(order, key, "installed" if body.done else "pending"))
        await uow.commit()
        return await _public_out(uow, order, response)


@router.post("/public/orders/{token}/finish", response_model=PublicOrderOut, summary="Покупатель закончил и вернул свой аккаунт")
async def public_finish(token: str, body: PublicFinishIn, response: Response) -> PublicOrderOut:
    async with UnitOfWork() as uow:
        order = await _public_order(uow, token)
        data: dict[str, Any] = {}
        if order.status == "active":
            done = sum(1 for a in order.apps or [] if a.get("status") == "installed")
            data = {"status": "done", "finished_at": _now(),
                    "events": _events(order, "customer", f"Покупатель завершил установку: {done} из {len(order.apps or [])}")}
            ORDER_CODES.pop(str(order.id), None)
        elif order.status != "done":
            raise HTTPException(status.HTTP_409_CONFLICT, "Заказ сейчас не в работе")
        if body.rating is not None:
            data["rating"] = body.rating
        if body.text:
            data["feedback"] = body.text
        if data:
            order = await uow.install_orders.update(order.id, **data)
            await uow.commit()
        return await _public_out(uow, order, response)
