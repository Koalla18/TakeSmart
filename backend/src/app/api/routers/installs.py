"""
Услуга «Приложения на iPhone»: /installs/*

Два контура:
  админский   — станции (токен), история установок, сводка (JWT администратора);
  станционный — Mac в павильоне ходит по токену X-Station-Token: пульс,
                открыть сессию установки, сообщать ход, закрыть сессию.
Apple ID покупателя сюда не попадает никогда: станция шлёт только устройство,
факт входа и результат по каждому приложению.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import Response

from src.app.api.admin.endpoints import get_current_admin
from src.app.core.logger import get_logger
from src.app.database.models.iphone_install import InstallJob, InstallStation
from src.app.database.repositories.iphone_install_repository import station_online
from src.app.database.unit_of_work import UnitOfWork
from src.app.schemas.iphone_install import (
    HeartbeatIn, HeartbeatOut, InstallStatsOut, JobFinishIn, JobOut, JobProgressIn,
    SessionStartIn, StationCreate, StationCreatedOut, StationOut,
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


# ═════════════════════════════════════════════════════════════════════════════
# Админский контур
# ═════════════════════════════════════════════════════════════════════════════

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


@router.get("/sessions", response_model=list[JobOut], dependencies=ADMIN, summary="История установок")
async def admin_sessions(limit: int = Query(200, ge=1, le=500)) -> list[JobOut]:
    async with UnitOfWork() as uow:
        return [JobOut.model_validate(j) for j in await uow.install_jobs.list_recent(limit)]


@router.delete("/sessions/{job_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=ADMIN)
async def admin_delete_session(job_id: UUID) -> Response:
    async with UnitOfWork() as uow:
        if not await uow.install_jobs.delete(job_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Запись не найдена")
        await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=InstallStatsOut, dependencies=ADMIN, summary="Сводка раздела")
async def admin_stats() -> InstallStatsOut:
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    async with UnitOfWork() as uow:
        jobs = await uow.install_jobs.since(month_start)
        stations = await uow.install_stations.list_all()
    installed_today = installed_month = sessions_today = 0
    for job in jobs:
        n = sum(1 for a in job.apps or [] if a.get("status") == "installed")
        installed_month += n
        if job.created_at >= day_start:
            installed_today += n
            sessions_today += 1
    return InstallStatsOut(installed_today=installed_today, installed_month=installed_month, sessions_today=sessions_today,
                           sessions_month=len(jobs), stations_online=sum(1 for s in stations if station_online(s)))


# ═════════════════════════════════════════════════════════════════════════════
# Станционный контур
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/station/heartbeat", response_model=HeartbeatOut, summary="Пульс станции")
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
        await uow.commit()
        return HeartbeatOut(station=_station_out(fresh or station))


@router.post("/station/sessions", response_model=JobOut, status_code=status.HTTP_201_CREATED,
             summary="Станция начала установку на подключённый iPhone")
async def station_start_session(body: SessionStartIn, station: InstallStation = Depends(get_current_station)) -> JobOut:
    async with UnitOfWork() as uow:
        # Прошлая незакрытая сессия этой станции (обрыв, перезапуск) закрывается как failed
        for stale in await uow.install_jobs.running_for_station(station.id):
            await uow.install_jobs.update(stale.id, status="failed", finished_at=datetime.now(timezone.utc),
                                          log=_append_log(stale, "Закрыто: станция начала новую сессию"))
        job = await uow.install_jobs.create(
            station_id=station.id, status="running", apps=[a.model_dump(mode="json") for a in body.apps],
            device_udid=body.device.udid, device_model=body.device.model, ios_version=body.device.ios_version,
            note=body.note or None, started_at=datetime.now(timezone.utc),
            log=[{"t": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  "msg": f"Начали: {body.device.model or 'iPhone'} · iOS {body.device.ios_version or '?'} · {len(body.apps)} прил."}],
        )
        await uow.commit()
        return JobOut.model_validate(job)


async def _station_job(uow: UnitOfWork, job_id: UUID, station: InstallStation) -> InstallJob:
    job = await uow.install_jobs.get_by_id(job_id)
    if not job or job.station_id != station.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Сессия не найдена")
    return job


@router.post("/station/sessions/{job_id}/progress", response_model=JobOut, summary="Ход установки")
async def station_progress(job_id: UUID, body: JobProgressIn, station: InstallStation = Depends(get_current_station)) -> JobOut:
    async with UnitOfWork() as uow:
        job = await _station_job(uow, job_id, station)
        data: dict = {}
        if body.apps is not None:
            data["apps"] = [a.model_dump(mode="json") for a in body.apps]
        if body.log:
            data["log"] = _append_log(job, body.log)
        if data:
            job = await uow.install_jobs.update(job_id, **data)
            await uow.commit()
        return JobOut.model_validate(job)


@router.post("/station/sessions/{job_id}/finish", response_model=JobOut, summary="Сессия завершена")
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
        await uow.commit()
        logger.info("install_session_finished", job=str(job_id), status=body.status, installed=installed, total=len(apps))
        return JobOut.model_validate(job)
