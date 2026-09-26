"""
Услуга «Установка приложений на iPhone»: /installs/*

Три контура:
  публичный  — каталог для сайта и заявка покупателя;
  админский  — каталог, заявки, станции, задания, сводка (JWT администратора);
  станционный — Mac в павильоне ходит по токену X-Station-Token: пульс,
                взять задание, сообщать ход установки, закрыть задание.
Apple ID покупателя сюда не попадает никогда: станция шлёт только устройство,
факт входа и результат по каждому приложению.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.core.push_service import send_install_request_push
from src.app.database.models.iphone_install import InstallJob, InstallRequest, InstallStation
from src.app.database.repositories.iphone_install_repository import station_online
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.iphone_install import (
    HeartbeatIn, HeartbeatOut, InstallRequestCreate, InstallRequestCreatedOut, InstallRequestOut,
    InstallRequestUpdate, InstallStatsOut, IphoneAppCreate, IphoneAppOut, IphoneAppUpdate,
    JobClaimIn, JobCreate, JobFinishIn, JobOut, JobProgressIn, StationCreate, StationCreatedOut, StationOut,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/installs", tags=["iPhone installs"])

ADMIN = [Depends(get_current_admin)]
MAX_LOG = 200


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _station_out(s: InstallStation) -> StationOut:
    return StationOut(id=s.id, name=s.name, version=s.version, last_seen_at=s.last_seen_at, state=s.state or {},
                      is_active=s.is_active, online=station_online(s), created_at=s.created_at)


def _request_number() -> str:
    return f"IP-{uuid.uuid4().hex[:6].upper()}"


def _app_snapshot(app) -> dict:
    return {"app_id": str(app.id), "name": app.name, "bundle_id": app.bundle_id, "price": float(app.price or 0)}


def _append_log(job: InstallJob, message: str) -> list[dict]:
    log = list(job.log or [])
    log.append({"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "msg": message[:300]})
    return log[-MAX_LOG:]


async def get_current_station(x_station_token: str | None = Header(None, alias="X-Station-Token")) -> InstallStation:
    if not x_station_token or len(x_station_token) < 16:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нет токена станции")
    async with UnitOfWork() as uow:
        station = await uow.install_stations.get_by_token_hash(_hash_token(x_station_token))
    if not station:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Станция не найдена или отключена")
    return station


async def _resolve_apps(uow: UnitOfWork, app_ids: list[UUID]) -> list[dict]:
    apps = await uow.iphone_apps.get_by_ids(app_ids)
    by_id = {a.id: a for a in apps if a.is_active}
    missing = [str(i) for i in app_ids if i not in by_id]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено или отключено: " + ", ".join(missing[:3]))
    seen: set[UUID] = set()
    out = []
    for i in app_ids:
        if i in seen:
            continue
        seen.add(i)
        out.append(_app_snapshot(by_id[i]))
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Публичный контур: сайт
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/apps", response_model=list[IphoneAppOut], summary="Каталог приложений для сайта")
async def public_apps() -> list[IphoneAppOut]:
    async with UnitOfWork() as uow:
        rows = await uow.iphone_apps.list_all(active_only=True)
        return [IphoneAppOut.model_validate(r) for r in rows]


@router.post("/requests", response_model=InstallRequestCreatedOut, status_code=status.HTTP_201_CREATED,
             summary="Заявка покупателя с сайта")
async def create_public_request(body: InstallRequestCreate, background_tasks: BackgroundTasks) -> InstallRequestCreatedOut:
    async with UnitOfWork() as uow:
        apps = await _resolve_apps(uow, body.app_ids)
        req = await uow.install_requests.create(
            request_number=_request_number(), customer_name=body.customer_name, customer_phone=body.customer_phone,
            device_model=body.device_model or None, ios_version=body.ios_version or None, apps=apps,
            comment=body.comment or None, source="site", status="new",
        )
        await uow.commit()
        out = InstallRequestCreatedOut(id=req.id, request_number=req.request_number)
        names = ", ".join(a["name"] for a in apps)
        background_tasks.add_task(send_install_request_push, req.request_number, body.customer_name,
                                  body.device_model, names)
    logger.info("install_request_created", number=out.request_number, apps=len(apps), source="site")
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Админский контур
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/apps/all", response_model=list[IphoneAppOut], dependencies=ADMIN, summary="Весь каталог, включая отключённые")
async def admin_apps() -> list[IphoneAppOut]:
    async with UnitOfWork() as uow:
        return [IphoneAppOut.model_validate(r) for r in await uow.iphone_apps.list_all(active_only=False)]


DEFAULT_APPS = [
    ("СберБанк Онлайн", "ru.sberbankmobile", "bank", 500, 10, "Переводы, СБП, вклады, оплата услуг"),
    ("Т-Банк", "com.idamob.tinkoff.ios", "bank", 500, 20, "Карты, кэшбэк, переводы, инвестиции"),
    ("ВТБ Онлайн", "ru.vtb24.mobilebanking.iphone", "bank", 500, 30, "Счета, переводы, кредиты"),
    ("Альфа-Банк", "ru.alfabank.mobile.ios", "bank", 500, 40, "Карты, переводы, кэшбэк"),
    ("Газпромбанк", "ru.gazprombank.mobile", "bank", 500, 50, "Карты, вклады, переводы"),
    ("Совкомбанк Халва", "ru.sovcombank.halva", "bank", 500, 60, "Карта рассрочки, переводы"),
    ("ВКонтакте", "com.vk.vkclient", "social", 300, 70, "Сообщения, лента, музыка, клипы"),
    ("Telegram", "ph.telegra.Telegraph", "messenger", 300, 80, "Сообщения, каналы, звонки"),
]


@router.post("/apps/seed-defaults", response_model=list[IphoneAppOut], dependencies=ADMIN,
             summary="Заполнить каталог стандартным набором (только отсутствующие)")
async def admin_seed_defaults() -> list[IphoneAppOut]:
    async with UnitOfWork() as uow:
        added = []
        for name, bundle, category, price, order, descr in DEFAULT_APPS:
            if await uow.iphone_apps.get_by_bundle(bundle):
                continue
            added.append(await uow.iphone_apps.create(name=name, bundle_id=bundle, category=category, price=Decimal(price),
                                                      sort_order=order, description=descr, is_active=True))
        await uow.commit()
        return [IphoneAppOut.model_validate(a) for a in added]


@router.post("/apps", response_model=IphoneAppOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN)
async def admin_create_app(body: IphoneAppCreate) -> IphoneAppOut:
    async with UnitOfWork() as uow:
        if await uow.iphone_apps.get_by_bundle(body.bundle_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Приложение с таким Bundle ID уже есть")
        app = await uow.iphone_apps.create(**body.model_dump())
        await uow.commit()
        return IphoneAppOut.model_validate(app)


@router.patch("/apps/{app_id}", response_model=IphoneAppOut, dependencies=ADMIN)
async def admin_update_app(app_id: UUID, body: IphoneAppUpdate) -> IphoneAppOut:
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Нет полей для обновления")
    async with UnitOfWork() as uow:
        if "bundle_id" in data:
            other = await uow.iphone_apps.get_by_bundle(data["bundle_id"])
            if other and other.id != app_id:
                raise HTTPException(status.HTTP_409_CONFLICT, "Приложение с таким Bundle ID уже есть")
        app = await uow.iphone_apps.update(app_id, **data)
        if not app:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено")
        await uow.commit()
        return IphoneAppOut.model_validate(app)


@router.delete("/apps/{app_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def admin_delete_app(app_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.iphone_apps.delete(app_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Приложение не найдено")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/requests", response_model=list[InstallRequestOut], dependencies=ADMIN, summary="Заявки")
async def admin_requests(status_filter: str | None = Query(None, alias="status"),
                         limit: int = Query(200, ge=1, le=500)) -> list[InstallRequestOut]:
    async with UnitOfWork() as uow:
        rows = await uow.install_requests.list(status=status_filter, limit=limit)
        return [InstallRequestOut.model_validate(r) for r in rows]


@router.post("/requests/manual", response_model=InstallRequestOut, status_code=status.HTTP_201_CREATED,
             dependencies=ADMIN, summary="Заявка, оформленная у прилавка")
async def admin_create_request(body: InstallRequestCreate) -> InstallRequestOut:
    async with UnitOfWork() as uow:
        apps = await _resolve_apps(uow, body.app_ids)
        req = await uow.install_requests.create(
            request_number=_request_number(), customer_name=body.customer_name, customer_phone=body.customer_phone,
            device_model=body.device_model or None, ios_version=body.ios_version or None, apps=apps,
            comment=body.comment or None, source="counter", status="new",
        )
        await uow.commit()
        return InstallRequestOut.model_validate(req)


@router.patch("/requests/{request_id}", response_model=InstallRequestOut, dependencies=ADMIN)
async def admin_update_request(request_id: UUID, body: InstallRequestUpdate) -> InstallRequestOut:
    data = body.model_dump(exclude_unset=True)
    async with UnitOfWork() as uow:
        req = await uow.install_requests.get_by_id(request_id)
        if not req:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
        app_ids = data.pop("app_ids", None)
        if app_ids is not None:
            data["apps"] = await _resolve_apps(uow, app_ids)
        if not data:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Нет полей для обновления")
        req = await uow.install_requests.update(request_id, **data)
        await uow.commit()
        return InstallRequestOut.model_validate(req)


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def admin_delete_request(request_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.install_requests.delete(request_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stations", response_model=list[StationOut], dependencies=ADMIN)
async def admin_stations() -> list[StationOut]:
    async with UnitOfWork() as uow:
        return [_station_out(s) for s in await uow.install_stations.list_all()]


@router.post("/stations", response_model=StationCreatedOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN,
             summary="Новая станция: токен показывается один раз")
async def admin_create_station(body: StationCreate) -> StationCreatedOut:
    token = "ts_" + secrets.token_hex(24)
    async with UnitOfWork() as uow:
        station = await uow.install_stations.create(name=body.name.strip(), token_hash=_hash_token(token), state={})
        await uow.commit()
        base = _station_out(station)
    return StationCreatedOut(**base.model_dump(), token=token)


@router.delete("/stations/{station_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def admin_delete_station(station_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.install_stations.delete(station_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Станция не найдена")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/jobs", response_model=JobOut, status_code=status.HTTP_201_CREATED, dependencies=ADMIN,
             summary="Отправить заявку на станцию")
async def admin_create_job(body: JobCreate) -> JobOut:
    async with UnitOfWork() as uow:
        req = await uow.install_requests.get_by_id(body.request_id)
        if not req:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
        station = await uow.install_stations.get_by_id(body.station_id)
        if not station or not station.is_active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Станция не найдена")
        if await uow.install_jobs.active_for_station(station.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "У этой станции уже есть незавершённое задание")
        wanted = set(body.bundle_ids or [])
        apps = [
            {"bundle_id": a["bundle_id"], "name": a["name"], "price": float(a.get("price") or 0),
             "status": "pending", "version": None, "error": None}
            for a in (req.apps or []) if not wanted or a["bundle_id"] in wanted
        ]
        if not apps:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "В заявке нет приложений для установки")
        job = await uow.install_jobs.create(
            request_id=req.id, station_id=station.id, status="queued", apps=apps,
            device_model=req.device_model, ios_version=req.ios_version,
            log=[{"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "msg": f"В очередь на станцию «{station.name}»"}],
        )
        if req.status == "new":
            await uow.install_requests.update(req.id, status="in_progress")
        await uow.commit()
        return JobOut.model_validate(job)


@router.get("/jobs", response_model=list[JobOut], dependencies=ADMIN)
async def admin_jobs(request_id: UUID = Query(...)) -> list[JobOut]:
    async with UnitOfWork() as uow:
        return [JobOut.model_validate(j) for j in await uow.install_jobs.list_for_request(request_id)]


@router.get("/jobs/{job_id}", response_model=JobOut, dependencies=ADMIN)
async def admin_job(job_id: UUID) -> JobOut:
    async with UnitOfWork() as uow:
        job = await uow.install_jobs.get_by_id(job_id)
        if not job:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Задание не найдено")
        return JobOut.model_validate(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, dependencies=ADMIN)
async def admin_cancel_job(job_id: UUID) -> JobOut:
    async with UnitOfWork() as uow:
        job = await uow.install_jobs.get_by_id(job_id)
        if not job:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Задание не найдено")
        if job.status not in ("queued", "running"):
            raise HTTPException(status.HTTP_409_CONFLICT, "Задание уже завершено")
        job = await uow.install_jobs.update(
            job_id, status="cancelled", finished_at=datetime.now(timezone.utc),
            log=_append_log(job, "Отменено из админки"),
        )
        await uow.commit()
        return JobOut.model_validate(job)


@router.get("/stats", response_model=InstallStatsOut, dependencies=ADMIN, summary="Сводка раздела")
async def admin_stats() -> InstallStatsOut:
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    async with UnitOfWork() as uow:
        by_status = await uow.install_requests.count_by_status()
        jobs = await uow.install_jobs.finished_since(month_start)
        stations = await uow.install_stations.list_all()
    installed_today = installed_month = 0
    revenue = Decimal("0")
    for job in jobs:
        for app in job.apps or []:
            if app.get("status") != "installed":
                continue
            installed_month += 1
            revenue += Decimal(str(app.get("price") or 0))
            if job.finished_at and job.finished_at >= day_start:
                installed_today += 1
    return InstallStatsOut(
        new_requests=by_status.get("new", 0), in_progress=by_status.get("in_progress", 0),
        done_total=by_status.get("done", 0), installed_today=installed_today, installed_month=installed_month,
        revenue_month=revenue, stations_online=sum(1 for s in stations if station_online(s)),
    )


# ═════════════════════════════════════════════════════════════════════════════
# Станционный контур
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/station/heartbeat", response_model=HeartbeatOut, summary="Пульс станции + следующее задание")
async def station_heartbeat(body: HeartbeatIn, station: InstallStation = Depends(get_current_station)) -> HeartbeatOut:
    state = {
        "device": body.device.model_dump() if body.device else None,
        "apple": body.apple.model_dump() if body.apple else None,
        "busy": body.busy,
    }
    async with UnitOfWork() as uow:
        fresh = await uow.install_stations.update(
            station.id, last_seen_at=datetime.now(timezone.utc), version=body.version, state=state,
        )
        job = await uow.install_jobs.active_for_station(station.id)
        req = await uow.install_requests.get_by_id(job.request_id) if job else None
        await uow.commit()
        return HeartbeatOut(
            station=_station_out(fresh or station),
            next_job=JobOut.model_validate(job) if job else None,
            request=InstallRequestOut.model_validate(req) if req else None,
        )


async def _station_job(uow: UnitOfWork, job_id: UUID, station: InstallStation) -> InstallJob:
    job = await uow.install_jobs.get_by_id(job_id)
    if not job or job.station_id != station.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задание не найдено")
    return job


@router.post("/station/jobs/{job_id}/claim", response_model=JobOut, summary="Станция взяла задание в работу")
async def station_claim(job_id: UUID, body: JobClaimIn, station: InstallStation = Depends(get_current_station)) -> JobOut:
    async with UnitOfWork() as uow:
        job = await _station_job(uow, job_id, station)
        if job.status == "running":
            return JobOut.model_validate(job)
        ok = await uow.install_jobs.claim(
            job_id, station.id, device_udid=body.device.udid, device_model=body.device.model, ios_version=body.device.ios_version,
        )
        if not ok:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Задание уже в статусе {job.status}")
        job = await uow.install_jobs.get_by_id(job_id)
        await uow.install_jobs.update(job_id, log=_append_log(job, f"Станция взяла в работу: {body.device.model or 'iPhone'} · iOS {body.device.ios_version or '?'}"))
        await uow.commit()
        return JobOut.model_validate(await uow.install_jobs.get_by_id(job_id))


@router.post("/station/jobs/{job_id}/progress", response_model=JobOut, summary="Ход установки")
async def station_progress(job_id: UUID, body: JobProgressIn, station: InstallStation = Depends(get_current_station)) -> JobOut:
    async with UnitOfWork() as uow:
        job = await _station_job(uow, job_id, station)
        if job.status == "cancelled":
            raise HTTPException(status.HTTP_409_CONFLICT, "Задание отменено")
        data: dict = {}
        if body.apps is not None:
            data["apps"] = [a.model_dump(mode="json") for a in body.apps]
        if body.log:
            data["log"] = _append_log(job, body.log)
        if data:
            job = await uow.install_jobs.update(job_id, **data)
            await uow.commit()
        return JobOut.model_validate(job)


@router.post("/station/jobs/{job_id}/finish", response_model=JobOut, summary="Задание завершено")
async def station_finish(job_id: UUID, body: JobFinishIn, station: InstallStation = Depends(get_current_station)) -> JobOut:
    async with UnitOfWork() as uow:
        job = await _station_job(uow, job_id, station)
        apps = [a.model_dump(mode="json") for a in body.apps]
        installed = sum(1 for a in apps if a["status"] == "installed")
        summary = f"Готово: установлено {installed} из {len(apps)}" if body.status == "done" else f"Завершено со статусом {body.status}"
        job = await uow.install_jobs.update(
            job_id, status=body.status, apps=apps, finished_at=datetime.now(timezone.utc),
            log=_append_log(job, body.log or summary),
        )
        req = await uow.install_requests.get_by_id(job.request_id)
        if req and req.status in ("new", "in_progress"):
            all_ok = apps and all(a["status"] == "installed" for a in apps)
            await uow.install_requests.update(req.id, status="done" if (body.status == "done" and all_ok) else "in_progress")
        await uow.commit()
        logger.info("install_job_finished", job=str(job_id), status=body.status, installed=installed, total=len(apps))
        return JobOut.model_validate(job)
