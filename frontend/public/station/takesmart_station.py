#!/usr/bin/env python3
"""
TakeSmart Station — установка приложений на iPhone покупателя (как у bmrng).

Работает на Mac в павильоне в фоне. Вся работа идёт в админке TakeSmart, раздел
«Приложения»: там видно подключённый iPhone, покупатель вводит Apple ID, вы
отмечаете приложения из истории его покупок и жмёте «Установить». Помощник раз в
секунду забирает команды из админки (пульс), выполняет их (ipatool — скачивание
оригинального файла Apple, ideviceinstaller — установка по кабелю) и отдаёт
состояние обратно. Пароль и код покупателя через сервер только проходят —
не сохраняются и не пишутся в журнал; после установки помощник сам выходит из
Apple ID и удаляет файлы. Запасной вход — страница http://127.0.0.1:8765.

Зависимости: Python 3.9+ из macOS и утилиты из Homebrew:
    brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller

Первый запуск:
    python3 takesmart_station.py --setup --backend https://takesmart.ru --token ts_...
Дальше просто:
    python3 takesmart_station.py
"""
from __future__ import annotations

import argparse
import json
import os
import plistlib
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

VERSION = "0.3.6"
CONFIG_DIR = Path.home() / "Library" / "Application Support" / "TakeSmart Station"
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_PATH = CONFIG_DIR / "station.log"
HEARTBEAT_SECONDS = 3.0      # когда админку никто не смотрит
HEARTBEAT_WATCHED_SECONDS = 1.0  # раздел «Приложения» открыт — команды и состояние ходят быстрее
TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]

IPHONE_MODELS = {
    "iPhone10,1": "iPhone 8", "iPhone10,4": "iPhone 8", "iPhone10,2": "iPhone 8 Plus", "iPhone10,5": "iPhone 8 Plus",
    "iPhone10,3": "iPhone X", "iPhone10,6": "iPhone X", "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max",
    "iPhone11,6": "iPhone XS Max", "iPhone11,8": "iPhone XR", "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro",
    "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE (2020)", "iPhone13,1": "iPhone 12 mini",
    "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
    "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro",
    "iPhone14,3": "iPhone 13 Pro Max", "iPhone14,6": "iPhone SE (2022)", "iPhone14,7": "iPhone 14",
    "iPhone14,8": "iPhone 14 Plus", "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
    "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro",
    "iPhone16,2": "iPhone 15 Pro Max", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
    "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
    "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max", "iPhone18,3": "iPhone 17",
    "iPhone18,4": "iPhone Air",
}


# ─────────────────────────────────────────────────────────────────────────────
# Служебное
# ─────────────────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    line = f"{datetime.now().strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def find_tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for d in TOOL_DIRS:
        p = Path(d) / name
        if p.exists():
            return str(p)
    return None


def run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as exc:
        return 127, "", str(exc)


def last_json(text: str) -> dict:
    """ipatool печатает по одному JSON на строку; берём последний объект."""
    for line in reversed([ln for ln in text.splitlines() if ln.strip()]):
        try:
            data = json.loads(line)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    return {}


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    name, domain = email.split("@", 1)
    return f"{name[:2]}***@{domain}"


def pick(d: dict, *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def error_text(data: dict, out: str, err: str) -> str:
    return str(data.get("error") or err.strip() or out.strip())[:300]


class Config:
    def __init__(self) -> None:
        self.backend_url = ""
        self.token = ""
        self.ui_port = 8765
        self.auto_logout = True
        self.simulate = False
        self.keychain_passphrase = ""
        self.cors_origins: list[str] = []

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        if CONFIG_PATH.exists():
            try:
                for k, v in json.loads(CONFIG_PATH.read_text()).items():
                    if hasattr(cfg, k) and k != "simulate":
                        setattr(cfg, k, v)
            except (OSError, json.JSONDecodeError):
                pass
        return cfg

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        data = {k: v for k, v in self.__dict__.items() if k != "simulate"}
        CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        os.chmod(CONFIG_PATH, 0o600)


# ─────────────────────────────────────────────────────────────────────────────
# iPhone по кабелю
# ─────────────────────────────────────────────────────────────────────────────

SIM_DEVICE = {"udid": "SIMULATED-0000-DEVICE", "model": "iPhone 15 Pro (эмуляция)", "ios_version": "18.6",
              "name": "iPhone покупателя (эмуляция)", "paired": True}


class DeviceTools:
    def __init__(self, simulate: bool) -> None:
        self.simulate = simulate
        self.idevice_id = find_tool("idevice_id")
        self.ideviceinfo = find_tool("ideviceinfo")
        self.idevicepair = find_tool("idevicepair")
        self.ideviceinstaller = find_tool("ideviceinstaller")
        self._sim_installed: dict[str, dict] = {"com.vk.vkclient": {"name": "ВКонтакте", "version": "8.5"}}

    @property
    def missing(self) -> list[str]:
        if self.simulate:
            return []
        return [n for n, p in (("idevice_id", self.idevice_id), ("ideviceinfo", self.ideviceinfo),
                                ("idevicepair", self.idevicepair), ("ideviceinstaller", self.ideviceinstaller)) if not p]

    _info_cache: dict[str, dict] = {}
    _last_seen: dict[str, float] = {}
    _last_pair_attempt: dict[str, float] = {}
    _last_validate: dict[str, float] = {}

    def detect(self) -> dict | None:
        if self.simulate:
            return dict(SIM_DEVICE)
        if not self.idevice_id:
            return None
        now = time.time()
        code, out, _ = run([self.idevice_id, "-l"], timeout=10)
        udids = [u.strip() for u in out.splitlines() if u.strip()]
        if code != 0 or not udids:
            # usbmuxd иногда пропускает один ответ: телефон считаем отключённым, только если его нет 6 с подряд
            recent = [u for u, t in self._last_seen.items() if now - t < 6]
            if not recent:
                return None
            udids = recent[:1]
        udid = udids[0]
        self._last_seen[udid] = now
        info = self._info_cache.get(udid)
        if info and info.get("paired"):
            # Доверие перепроверяем раз в 15 с, а не каждый пульс
            if now - self._last_validate.get(udid, 0) > 15:
                self._last_validate[udid] = now
                if run([self.idevicepair, "-u", udid, "validate"], timeout=10)[0] != 0:
                    self._info_cache.pop(udid, None)
                    info = None
            if info:
                return dict(info)
        pcode, _, _ = run([self.idevicepair, "-u", udid, "validate"], timeout=10)
        self._last_validate[udid] = now
        if pcode != 0:
            # Запрос «Доверять?» показываем не чаще раза в 20 с, иначе телефон заваливает окнами
            if now - self._last_pair_attempt.get(udid, 0) > 20:
                self._last_pair_attempt[udid] = now
                run([self.idevicepair, "-u", udid, "pair"], timeout=10)
            return {"udid": udid, "model": "iPhone", "ios_version": None, "name": "Подтвердите доверие на iPhone", "paired": False}
        info = {"udid": udid, "model": None, "ios_version": None, "name": None, "paired": True}
        for key, field in (("ProductType", "model"), ("ProductVersion", "ios_version"), ("DeviceName", "name")):
            c, o, _ = run([self.ideviceinfo, "-u", udid, "-k", key], timeout=10)
            if c == 0 and o.strip():
                info[field] = o.strip()[:80]
        info["model"] = IPHONE_MODELS.get(info["model"] or "", info["model"] or "iPhone")
        self._info_cache[udid] = info
        return dict(info)

    def _list_xml(self, udid: str, extra: list[str]) -> list[dict]:
        """ideviceinstaller 1.2 (brew 2025): `list --xml`; старые сборки: `-l --xml`."""
        for args in (["list", "--user", "--xml", *extra], ["-l", "--xml"]):
            code, out, err = run([self.ideviceinstaller, "-u", udid, *args], timeout=90)
            if code != 0 and "invalid option" in (out + err).lower():
                continue
            if code != 0 or not out.strip():
                return []
            try:
                items = plistlib.loads(out.encode())
            except Exception:  # noqa: BLE001
                return []
            return [it for it in (items or []) if isinstance(it, dict)]
        return []

    @staticmethod
    def _purchaser(it: dict) -> tuple[str | None, str | None]:
        """Apple ID (почта) и DSID аккаунта, с которого приложение было скачано из App Store."""
        meta = it.get("iTunesMetadata")
        if isinstance(meta, (bytes, bytearray)):
            try:
                meta = plistlib.loads(bytes(meta))
            except Exception:  # noqa: BLE001
                meta = None
        email = dsid = None
        if isinstance(meta, dict):
            info = meta.get("com.apple.iTunesStore.downloadInfo") or {}
            acc = info.get("accountInfo") if isinstance(info, dict) else None
            if isinstance(acc, dict):
                email = acc.get("AppleID") or None
                dsid = acc.get("DSPersonID")
            email = email or meta.get("appleId") or None
        if dsid is None:
            dsid = it.get("ApplicationDSID")
        return (str(email) if email else None), (str(dsid) if dsid not in (None, "", 0) else None)

    def installed_apps(self, udid: str) -> dict[str, dict]:
        """Что уже стоит на телефоне: {bundle_id: {name, version, owner (маска почты), dsid}}."""
        if self.simulate:
            return dict(self._sim_installed)
        result: dict[str, dict] = {}
        for it in self._list_xml(udid, ["-a", "CFBundleIdentifier", "-a", "CFBundleDisplayName", "-a", "CFBundleName",
                                        "-a", "CFBundleShortVersionString", "-a", "CFBundleVersion",
                                        "-a", "ApplicationDSID", "-a", "iTunesMetadata"]):
            bundle = it.get("CFBundleIdentifier")
            if not bundle:
                continue
            email, dsid = self._purchaser(it)
            result[bundle] = {"name": it.get("CFBundleDisplayName") or it.get("CFBundleName") or bundle,
                              "version": str(it.get("CFBundleShortVersionString") or it.get("CFBundleVersion") or ""),
                              "owner": mask_email(email), "owner_full": email, "dsid": dsid}
        return result

    def install(self, udid: str, ipa_path: str, bundle_id: str, name: str, version: str | None) -> tuple[bool, str]:
        if self.simulate:
            time.sleep(1.2)
            self._sim_installed[bundle_id] = {"name": name, "version": version or "1.0"}
            return True, "Install: Complete (эмуляция)"
        already = bool(bundle_id and not bundle_id.startswith("id") and self._list_xml(udid, ["-b", bundle_id]))
        cmd = [self.ideviceinstaller, "-u", udid, "-w", "upgrade" if already else "install", ipa_path]
        code, out, err = run(cmd, timeout=900)
        text = (out + "\n" + err).strip()
        if code != 0 and "invalid option" in text.lower():  # старая сборка ideviceinstaller
            code, out, err = run([self.ideviceinstaller, "-u", udid, "-i", ipa_path], timeout=900)
            text = (out + "\n" + err).strip()
        log(f"ideviceinstaller {'upgrade' if already else 'install'} {bundle_id}: code {code}: {text[-300:]}")
        # Итог проверяем по телефону, а не по тексту: приложение должно появиться в списке
        if bundle_id and not bundle_id.startswith("id"):
            time.sleep(1.0)
            for it in self._list_xml(udid, ["-b", bundle_id]):
                if it.get("CFBundleIdentifier") == bundle_id:
                    return True, "Установлено"
        if code == 0:
            return True, "Установлено"
        tail = [ln for ln in text.splitlines() if ln.strip()][-3:]
        return False, " | ".join(tail)[:300] or f"ideviceinstaller завершился с кодом {code}"


# ─────────────────────────────────────────────────────────────────────────────
# Apple ID и скачивание (ipatool)
# ─────────────────────────────────────────────────────────────────────────────

SIM_PURCHASES = [
    {"bundle_id": "ru.sberbankmobile", "name": "СберБанк Онлайн", "id": 492224193, "version": "16.3.0"},
    {"bundle_id": "com.idamob.tinkoff.ios", "name": "Т-Банк", "id": 596862101, "version": "7.2"},
    {"bundle_id": "ru.alfabank.mobile.ios", "name": "Альфа-Банк", "id": 968942583, "version": "15.1"},
    {"bundle_id": "com.vk.vkclient", "name": "ВКонтакте", "id": 564177498, "version": "8.6"},
    {"bundle_id": "ph.telegra.Telegraph", "name": "Telegram", "id": 686449807, "version": "11.2"},
    {"bundle_id": "ru.ozon.app.ios", "name": "Ozon", "id": 1039891718, "version": "17.0"},
]


class StoreTools:
    def __init__(self, simulate: bool, keychain_passphrase: str) -> None:
        self.simulate = simulate
        self.ipatool = find_tool("ipatool")
        self.passphrase = keychain_passphrase
        self._sim_logged_in = False
        self._sim_email: str | None = None
        self._logged_purchases_shape = False
        self._lookup_cache: dict[str, dict] = {}

    def enrich(self, apps: list[dict]) -> None:
        """Иконка и жанр из iTunes Lookup — только для приложений, которые ещё есть в витрине. Батчи параллельно."""
        ids = [str(a["id"]) for a in apps if a.get("id") and str(a["id"]) not in self._lookup_cache]
        chunks = [ids[i:i + 100] for i in range(0, len(ids), 100)]

        def lookup(chunk: list[str]) -> dict[str, dict]:
            _, out, _ = run(["curl", "-sS", "--max-time", "15", "--compressed",
                             f"https://itunes.apple.com/lookup?id={','.join(chunk)}&country=ru&entity=software"], timeout=20)
            try:
                results = json.loads(out).get("results") or []
            except (json.JSONDecodeError, AttributeError):
                results = []
            return {str(r.get("trackId")): r for r in results if r.get("trackId")}

        if chunks:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=4) as ex:
                for chunk, found in zip(chunks, ex.map(lookup, chunks)):
                    for tid in chunk:
                        r = found.get(tid) or {}
                        self._lookup_cache[tid] = {"icon": r.get("artworkUrl100"), "genre": r.get("primaryGenreName"),
                                                   "store_name": r.get("trackName")}
        for a in apps:
            meta = self._lookup_cache.get(str(a.get("id") or ""), {})
            a["icon"], a["genre"], a["store_name"] = meta.get("icon"), meta.get("genre"), meta.get("store_name")

    @property
    def missing(self) -> list[str]:
        return [] if (self.simulate or self.ipatool) else ["ipatool"]

    def _base(self, *args: str) -> list[str]:
        cmd = [self.ipatool or "ipatool", *args, "--format", "json", "--non-interactive"]
        if self.passphrase:
            cmd += ["--keychain-passphrase", self.passphrase]
        return cmd

    def info(self) -> dict:
        if self.simulate:
            return {"logged_in": self._sim_logged_in, "email": mask_email(self._sim_email), "name": "Покупатель (эмуляция)" if self._sim_logged_in else None}
        code, out, err = run(self._base("auth", "info"), timeout=30)
        data = last_json(out + err)
        if code != 0 or data.get("success") is False:
            return {"logged_in": False, "email": None, "name": None}
        return {"logged_in": True, "email": mask_email(data.get("email")), "name": data.get("name")}

    def login(self, email: str, password: str, code: str | None) -> dict:
        """→ {status: ok|need_code|error, message}"""
        if self.simulate:
            if code is None and not password.startswith("nocode"):
                return {"status": "need_code", "message": "Введите код, который Apple прислала на устройства покупателя"}
            self._sim_logged_in, self._sim_email = True, email
            return {"status": "ok", "message": "Вход выполнен (эмуляция)"}
        args = ["auth", "login", "--email", email, "--password", password]
        if code:
            args += ["--auth-code", code]
        rc, out, err = run(self._base(*args), timeout=120)
        data = last_json(out + err)
        if rc == 0 and data.get("success"):
            return {"status": "ok", "message": "Вход выполнен"}
        error = error_text(data, out, err)
        log(f"ipatool login ({'с кодом' if code else 'без кода'}): {error[:220]}")
        low = error.lower()
        if any(k in low for k in ("2fa", "auth code", "two-factor", "verification code", "authcode")):
            return {"status": "need_code", "message": "Введите код, который Apple прислала на устройства покупателя"}
        if any(k in low for k in ("password", "credentials", "invalid", "incorrect", "unexpected status")):
            if code:
                return {"status": "error", "message": "Apple не приняла пароль или код. Если код не приходил, ошибка была в почте или пароле — проверьте и войдите заново"}
            return {"status": "error", "message": "Apple не приняла почту или пароль"}
        return {"status": "error", "message": error or "Не удалось войти"}

    def revoke(self) -> None:
        if self.simulate:
            self._sim_logged_in, self._sim_email = False, None
            return
        run(self._base("auth", "revoke"), timeout=30)
        for f in (Path.home() / ".ipatool").glob("cookies*"):
            try:
                f.unlink()
            except OSError:
                pass

    def purchases(self) -> list[dict]:
        """Вся история покупок аккаунта: [{bundle_id, name, id, version, purchase_date, icon, genre}].
        ipatool отдаёт не больше 100 записей за вызов, а каждый вызов заново читает всю историю у Apple —
        поэтому страницы после первой читаем параллельно."""
        if self.simulate:
            return [{**p, "icon": None, "genre": "Finance" if "bank" in p["bundle_id"] or "sber" in p["bundle_id"] else None,
                     "store_name": None, "purchase_date": None} for p in SIM_PURCHASES]
        page_size = 100  # ipatool: «max results must not exceed 100»

        def fetch(page: int) -> tuple[int, dict, list, str, str]:
            # Без --platform: у старых покупок (в том числе удалённых из App Store банков) в истории Apple
            # нет пометки платформы, и фильтр ipatool молча выбрасывал их. Отсеиваем сами только явно чужое.
            rc, out, err = run(self._base("list-purchases", "-l", str(page_size), "-p", str(page)), timeout=180)
            data = last_json(out + err)
            apps = data.get("apps") or []
            return rc, data, (apps if isinstance(apps, list) else []), out, err

        rc, data, first, out, err = fetch(1)
        if rc != 0:
            log(f"list-purchases (стр. 1): {error_text(data, out, err)}")
            return []
        if first and not self._logged_purchases_shape:
            self._logged_purchases_shape = True
            log(f"list-purchases keys: {sorted(first[0].keys())}")
        total = int(data.get("totalCount") or len(first))
        batches = [first]
        pages = list(range(2, (total + page_size - 1) // page_size + 1)) if len(first) >= page_size else []
        if pages:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=4) as ex:
                for prc, pdata, papps, pout, perr in ex.map(fetch, pages):
                    if prc != 0:
                        log(f"list-purchases (стр. {pdata.get('page', '?')}): {error_text(pdata, pout, perr)}")
                        continue
                    batches.append(papps)
        result: list[dict] = []
        seen: set[str] = set()
        for apps in batches:
            for a in apps:
                bundle = pick(a, "bundleID", "bundleId", "bundle_id") or ""
                if not bundle or bundle in seen:
                    continue
                platforms = [str(x).lower() for x in (a.get("platforms") or [])]
                if platforms and not any(x in ("iphone", "unknown", "ios") for x in platforms):
                    continue  # только Mac / Apple TV / Vision / iPad — на iPhone не встанет
                seen.add(bundle)
                result.append({"bundle_id": bundle, "name": pick(a, "name", "trackName") or bundle,
                               "id": pick(a, "id", "trackId"), "version": pick(a, "version"),
                               "purchase_date": pick(a, "purchaseDate", "purchase_date")})
        result.sort(key=lambda a: str(a.get("purchase_date") or ""), reverse=True)  # свежие покупки первыми
        log(f"list-purchases: всего {total}, страниц {1 + len(pages)}, для iPhone {len(result)}")
        try:
            self.enrich(result)
        except Exception as exc:  # noqa: BLE001
            log(f"lookup icons: {exc}")
        return result

    def download(self, bundle_id: str | None, app_id: int | None, out_dir: str, progress=None) -> dict:
        """→ {status: ok|not_owned|error, path, message}"""
        key = str(app_id) if app_id else bundle_id
        if self.simulate:
            time.sleep(1.2)
            owned = {p["bundle_id"] for p in SIM_PURCHASES} | {str(p["id"]) for p in SIM_PURCHASES}
            if key in owned:
                p = Path(out_dir) / f"{key}.ipa"
                with zipfile.ZipFile(p, "w") as z:
                    z.writestr("iTunesMetadata.plist", plistlib.dumps({"bundleShortVersionString": "16.3.0"}))
                return {"status": "ok", "path": str(p), "message": "Скачано (эмуляция)"}
            return {"status": "not_owned", "path": None, "message": "Нет в истории покупок этого Apple ID"}
        path = str(Path(out_dir) / f"{key}.ipa")
        stop = threading.Event()
        if progress:
            def watch() -> None:
                last = -1
                while not stop.wait(2.0):
                    try:
                        size = os.path.getsize(path)
                    except OSError:
                        continue
                    if size != last:
                        last = size
                        progress(size)
            threading.Thread(target=watch, daemon=True).start()
        args = ["download", "-o", path, "--purchase", "--platform", "iphone"]
        # По ID — из истории покупок напрямую; по bundle ipatool сначала ищет приложение в витрине
        # App Store, а удалённых оттуда банков там нет. Поэтому bundle — только когда ID неизвестен.
        args += ["-i", str(app_id)] if app_id else ["-b", bundle_id]
        rc, out, err = run(self._base(*args), timeout=1800)
        stop.set()
        data = last_json(out + err)
        if rc == 0 and data.get("success") and Path(path).exists():
            return {"status": "ok", "path": path, "message": "Скачано"}
        error = error_text(data, out, err)
        log(f"ipatool download {key}: code {rc}: {error[:300]}")
        low = error.lower()
        if "license is required" in low or "license" in low and "purchase" in low:
            return {"status": "not_owned", "path": None, "message": "Нет в истории покупок этого Apple ID"}
        if "paid apps" in low:
            return {"status": "not_owned", "path": None, "message": "Платное приложение, которого нет в покупках этого Apple ID"}
        if "temporarily unavailable" in low:
            return {"status": "error", "path": None, "message": "Apple: приложение временно недоступно — попробуйте позже"}
        if "password token" in low or "sign in" in low or "signin" in low:
            return {"status": "error", "path": None, "message": "Apple просит войти заново: выйдите из Apple ID и войдите снова"}
        if "does not declare" in low:
            return {"status": "error", "path": None, "message": "Скачанная версия не для iPhone"}
        return {"status": "error", "path": None, "message": f"Apple не отдала приложение: {error[:200]}" if error else "Не удалось скачать"}


def ipa_version(path: str) -> str | None:
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if "iTunesMetadata.plist" in names:
                meta = plistlib.loads(z.read("iTunesMetadata.plist"))
                v = meta.get("bundleShortVersionString") or meta.get("bundleVersion")
                if v:
                    return str(v)
            for n in names:
                if re.match(r"Payload/[^/]+\.app/Info\.plist$", n):
                    info = plistlib.loads(z.read(n))
                    return str(info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or "") or None
    except Exception:  # noqa: BLE001
        return None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Связь с админкой TakeSmart (через curl: системные сертификаты macOS)
# ─────────────────────────────────────────────────────────────────────────────

class Backend:
    def __init__(self, base_url: str, token: str) -> None:
        self.base = (base_url or "").rstrip("/")
        self.token = token or ""
        self.prefix: str | None = None  # /api/v1 напрямую к бэку или /api через сайт

    @property
    def configured(self) -> bool:
        return bool(self.base and self.token)

    def _probe(self) -> str:
        if self.prefix:
            return self.prefix
        # Напрямую к бэку API живёт на /api/v1, через сайт takesmart.ru — на /api (прокси дописывает /v1).
        for prefix in ("/api/v1", "/api"):
            _, out, _ = run(["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10",
                             f"{self.base}{prefix}/health"], timeout=15)
            if out.strip() == "200":
                self.prefix = prefix
                log(f"Адрес API: {self.base}{prefix}")
                return prefix
        return "/api/v1"

    def call(self, method: str, path: str, body: dict | None = None, timeout: int = 20) -> tuple[int, dict]:
        if not self.configured:
            return 0, {"detail": "помощник не привязан к админке"}
        prefix = self._probe()
        url = f"{self.base}{prefix}/installs/station{path}"
        cmd = ["curl", "-sS", "-X", method, "--max-time", str(timeout), "-H", "Content-Type: application/json",
               "-H", f"X-Station-Token: {self.token}", "-H", f"User-Agent: TakeSmartStation/{VERSION}",
               "-w", "\n%{http_code}", "--data-binary", json.dumps(body or {}, ensure_ascii=False), url]
        code, out, err = run(cmd, timeout=timeout + 5)
        if code != 0:
            log(f"backend {method} {url}: {(err or '').strip()[:160]}")
            return 0, {"detail": f"админка не отвечает по адресу {self.base}"}
        lines = out.rstrip("\n").split("\n")
        status_line = lines[-1].strip()
        raw = "\n".join(lines[:-1])
        try:
            status = int(status_line)
        except ValueError:
            return 0, {"detail": "непонятный ответ"}
        if status == 404 and self.prefix and isinstance(data, dict) and data.get("detail") == "Not Found":
            self.prefix = None  # маршрута нет по этому адресу: в следующий раз перепроверим префикс
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {"detail": raw[:200]}
        if isinstance(data, dict) and isinstance(data.get("detail"), list):
            data["detail"] = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in data["detail"])[:300]
        return status, data if isinstance(data, dict) else {"data": data}

    def heartbeat(self, payload: dict) -> tuple[int, dict]:
        return self.call("POST", "/heartbeat", payload)

    def start_session(self, device: dict, apps: list[dict], note: str | None) -> tuple[int, dict]:
        return self.call("POST", "/sessions", {"device": device, "apps": apps, "note": note})

    def progress(self, job_id: str, apps: list[dict] | None, log_line: str | None) -> tuple[int, dict]:
        return self.call("POST", f"/sessions/{job_id}/progress", {"apps": apps, "log": log_line})

    def finish(self, job_id: str, status: str, apps: list[dict], log_line: str | None) -> tuple[int, dict]:
        return self.call("POST", f"/sessions/{job_id}/finish", {"status": status, "apps": apps, "log": log_line})


# ─────────────────────────────────────────────────────────────────────────────
# Станция
# ─────────────────────────────────────────────────────────────────────────────

def host_name() -> str:
    code, out, _ = run(["scutil", "--get", "ComputerName"], timeout=5)
    name = out.strip() if code == 0 else ""
    if not name:
        import socket
        name = socket.gethostname().split(".")[0]
    return name[:80] or "Mac"


def job_app(bundle_id: str, name: str) -> dict:
    return {"bundle_id": bundle_id, "name": name[:160], "status": "pending", "version": None, "error": None}


class Station:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.devices = DeviceTools(cfg.simulate)
        self.store = StoreTools(cfg.simulate, cfg.keychain_passphrase)
        self.backend = Backend(cfg.backend_url, cfg.token)
        self.lock = threading.Lock()
        self.state: dict[str, Any] = {
            "version": VERSION, "backend_url": cfg.backend_url, "simulate": cfg.simulate,
            "connected": False, "station_name": None, "last_error": None,
            "device": None, "installed": {}, "apple": {"logged_in": False, "email": None, "name": None},
            "purchases": None, "purchases_loading": False, "login": {"status": "idle", "message": None, "pending": False},
            "session": None, "history": [], "events": [], "auto_logout": cfg.auto_logout,
            "tools_missing": self.devices.missing + self.store.missing,
            "host_name": host_name(), "backend_configured": self.backend.configured, "station_id": None,
            "ui_port": cfg.ui_port, "purchases_version": 0, "notice": None, "owners": [],
        }
        self._server_purchases_version: int | None = None
        self.commands: "queue.Queue[dict]" = queue.Queue()
        self.watched = False
        self.stop = threading.Event()
        self.busy = False
        self.cancel_requested = False
        self._last_udid: str | None = None
        # Почта и пароль между первым шагом входа и кодом подтверждения. Только в памяти,
        # стираются сразу после ответа Apple или по кнопке «Другой Apple ID».
        self._pending_login: tuple[str, str] | None = None

    # ── состояние ────────────────────────────────────────────────────────

    @staticmethod
    def _public_installed(installed: dict[str, dict]) -> dict[str, dict]:
        """В состояние (и в админку) полная почта покупателя не уходит — только маска."""
        return {b: {k: v for k, v in info.items() if k != "owner_full"} for b, info in installed.items()}

    @staticmethod
    def _owners_summary(installed: dict[str, dict]) -> list[dict]:
        """С каких Apple ID скачаны приложения на телефоне: [{owner, dsid, count, apps[:12]}] по убыванию."""
        groups: dict[str, dict] = {}
        for info in installed.values():
            key = info.get("dsid") or info.get("owner") or ""
            if not key:
                continue
            g = groups.setdefault(key, {"owner": info.get("owner"), "dsid": info.get("dsid"), "count": 0, "apps": []})
            g["count"] += 1
            if len(g["apps"]) < 12:
                g["apps"].append(info.get("name"))
        return sorted(groups.values(), key=lambda g: -g["count"])

    def event(self, msg: str) -> None:
        log(msg)
        with self.lock:
            ev = self.state["events"]
            ev.append({"t": datetime.now().strftime("%H:%M:%S"), "msg": msg})
            del ev[:-80]

    def snapshot(self) -> dict:
        with self.lock:
            return json.loads(json.dumps(self.state, ensure_ascii=False))

    def set(self, **kw: Any) -> None:
        with self.lock:
            self.state.update(kw)

    # ── пульс ────────────────────────────────────────────────────────────

    def heartbeat_loop(self) -> None:
        while not self.stop.is_set():
            try:
                device = self.devices.detect()
                udid = device.get("udid") if device and device.get("paired") else None
                if udid != self._last_udid:
                    self._last_udid = udid
                    if udid:
                        installed = self.devices.installed_apps(udid)
                        self.set(device=device, installed=self._public_installed(installed), owners=self._owners_summary(installed))
                        self.event(f"Подключён {device.get('model')} · iOS {device.get('ios_version')}")
                    else:
                        self.set(installed={})
                        if self.busy:
                            self.cancel_requested = True
                            self.event("iPhone отключён — установка прервана")
                self.set(device=device)
                if not self.busy:
                    self.set(apple=self.store.info())
                apple = self.state["apple"]
                if apple.get("logged_in") and self.state.get("purchases") is None and not self.state.get("purchases_loading") and not self.busy:
                    self.set(purchases_loading=True)
                    threading.Thread(target=self.refresh_purchases, daemon=True).start()
                purchases = self.state.get("purchases")
                if not self.backend.configured:
                    self.set(connected=False, last_error=None, backend_configured=False, station_id=None)
                else:
                    self.heartbeat_once(device, apple, purchases)
            except Exception as exc:  # noqa: BLE001
                self.set(connected=False, last_error=str(exc)[:200])
                log(f"heartbeat error: {exc}")
            self.stop.wait(HEARTBEAT_WATCHED_SECONDS if self.watched else HEARTBEAT_SECONDS)

    def heartbeat_once(self, device: dict | None, apple: dict, purchases: list | None) -> None:
        snap = self.snapshot()
        payload = {
            "version": VERSION, "busy": self.busy, "device": device, "host_name": snap.get("host_name"),
            "apple": {"logged_in": bool(apple.get("logged_in")), "email": apple.get("email"), "name": apple.get("name"),
                      "purchases_count": len(purchases) if purchases is not None else None},
            "console": {k: snap.get(k) for k in ("login", "session", "installed", "owners", "tools_missing", "auto_logout",
                                                  "simulate", "purchases_loading", "notice", "last_error")},
            "purchases_version": snap.get("purchases_version", 0),
        }
        payload["console"]["history"] = (snap.get("history") or [])[:10]
        payload["console"]["events"] = (snap.get("events") or [])[-15:]
        if self._server_purchases_version != snap.get("purchases_version", 0):
            payload["purchases"] = snap.get("purchases") or []
        code, data = self.backend.heartbeat(payload)
        if code == 200:
            self._server_purchases_version = int(data.get("purchases_version") or 0)
            self.watched = bool(data.get("watch"))
            self.set(connected=True, last_error=None, backend_configured=True,
                     station_name=data["station"]["name"], station_id=data["station"].get("id"))
            for cmd in data.get("commands") or []:
                self.commands.put(cmd)
        elif code == 401:
            self.set(connected=False, backend_configured=True, last_error="Админка не принимает токен помощника — получите новую команду в разделе «Приложения»")
        else:
            self.set(connected=False, backend_configured=True,
                     last_error=f"Ответ админки {code}: {data.get('detail')}" if code else str(data.get("detail")))

    # ── команды из админки ───────────────────────────────────────────────

    def notice(self, message: str, tone: str = "info") -> None:
        log(f"notice: {message}")
        self.set(notice={"t": round(time.time(), 3), "message": message[:300], "tone": tone})

    def command_worker(self) -> None:
        while not self.stop.is_set():
            try:
                cmd = self.commands.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self.run_command(cmd)
            except Exception as exc:  # noqa: BLE001
                log(f"command {cmd.get('type')} error: {exc}")
                self.notice(f"Не удалось выполнить «{cmd.get('type')}»: {str(exc)[:160]}", "error")

    def run_command(self, cmd: dict) -> None:
        kind, p = cmd.get("type"), cmd.get("payload") or {}
        if kind == "login":
            self.login(p.get("email"), p.get("password"), None)
        elif kind == "code":
            self.login(None, None, p.get("code"))
        elif kind == "resend_code":
            if self._pending_login:
                self.event("Просим Apple прислать код ещё раз")
                self.login(None, None, None)
            else:
                self.notice("Сначала введите почту и пароль Apple ID", "error")
        elif kind == "reset_login":
            self.reset_login()
        elif kind == "logout":
            self.logout()
        elif kind == "refresh_purchases":
            self.refresh_purchases()
        elif kind == "install":
            ok, message = self.start_install(p.get("apps") or [], p.get("note"))
            if not ok:
                self.notice(message, "error")
        elif kind == "cancel":
            self.cancel_requested = True
            self.event("Остановим после текущего приложения")
        elif kind == "dismiss_session":
            with self.lock:
                if self.state.get("session") and self.state["session"].get("finished"):
                    self.state["session"] = None
        elif kind == "settings":
            self.apply_settings(None, None, p.get("auto_logout"))
        else:
            self.notice(f"Неизвестная команда: {kind}", "error")

    def apply_settings(self, backend_url: str | None, token: str | None, auto_logout: bool | None) -> None:
        if backend_url is not None and token is not None:
            self.cfg.backend_url, self.cfg.token = backend_url.strip(), token.strip()
            self.backend = Backend(self.cfg.backend_url, self.cfg.token)
            self.set(backend_url=self.cfg.backend_url, backend_configured=self.backend.configured,
                     connected=False, last_error=None, station_id=None)
            self.event(f"Помощник привязан к админке {self.cfg.backend_url}")
        if auto_logout is not None:
            self.cfg.auto_logout = bool(auto_logout)
            self.set(auto_logout=self.cfg.auto_logout)
        self.cfg.save()

    # ── Apple ID ─────────────────────────────────────────────────────────

    def login(self, email: str | None, password: str | None, code: str | None) -> None:
        if not email or not password:
            if not self._pending_login:
                self.set(login={"status": "error", "message": "Введите почту и пароль", "pending": False})
                return
            email, password = self._pending_login
        self.set(login={"status": "working", "message": "Связываемся с Apple…", "pending": bool(self._pending_login)})
        result = self.store.login(email.strip(), password, (code or "").strip() or None)
        self._pending_login = (email, password) if result["status"] == "need_code" else None
        self.set(login={"status": result["status"], "message": result["message"], "pending": result["status"] == "need_code"})
        if result["status"] == "ok":
            self.set(apple=self.store.info())
            self.event("Вход в Apple ID выполнен")
            self.refresh_purchases()

    def reset_login(self) -> None:
        self._pending_login = None
        self.set(login={"status": "idle", "message": None, "pending": False})

    def logout(self) -> None:
        self.store.revoke()
        self._pending_login = None
        with self.lock:
            self.state["purchases_version"] += 1
        self.set(apple={"logged_in": False, "email": None, "name": None}, purchases=None,
                 login={"status": "idle", "message": None, "pending": False})
        self.event("Вышли из Apple ID, данные аккаунта удалены со станции")

    def refresh_purchases(self) -> None:
        self.set(purchases_loading=True)
        try:
            purchases = self.store.purchases()
            with self.lock:
                self.state["purchases"] = purchases
                self.state["purchases_version"] += 1
            self.event(f"В истории покупок аккаунта {len(purchases)} приложений для iPhone")
        except Exception as exc:  # noqa: BLE001
            self.event(f"Не удалось прочитать покупки: {exc}")
        finally:
            self.set(purchases_loading=False)

    # ── установка ────────────────────────────────────────────────────────

    def start_install(self, items: list[dict], note: str | None) -> tuple[bool, str]:
        if self.busy:
            return False, "Установка уже идёт"
        device = self.state.get("device")
        if not device or not device.get("paired"):
            return False, "Подключите iPhone и подтвердите «Доверять» на телефоне"
        if not self.state["apple"].get("logged_in"):
            return False, "Сначала войдите в Apple ID покупателя"
        clean = []
        for it in items:
            bundle = (it.get("bundle_id") or "").strip()
            app_id = it.get("id")
            if not bundle and not app_id:
                continue
            clean.append({"bundle_id": bundle or f"id{app_id}", "app_id": app_id, "name": (it.get("name") or bundle or str(app_id))[:160]})
        if not clean:
            return False, "Отметьте хотя бы одно приложение"
        threading.Thread(target=self.run_install, args=(clean, device, note), daemon=True).start()
        return True, "Начали"

    def run_install(self, items: list[dict], device: dict, note: str | None) -> None:
        self.busy = True
        self.cancel_requested = False
        apps = [job_app(it["bundle_id"], it["name"]) for it in items]
        session = {"id": None, "apps": apps, "status": "running", "started": datetime.now().strftime("%H:%M:%S")}
        self.set(session=session)
        code, data = self.backend.start_session(device, apps, note)
        job_id = data.get("id") if code in (200, 201) else None
        if not job_id:
            self.event(f"Админка не приняла сессию ({code}: {data.get('detail')}) — ставим без записи в историю")
        session["id"] = job_id
        tmp = tempfile.mkdtemp(prefix="takesmart-")
        try:
            self.event(f"Установка: {len(apps)} прил. на {device.get('model')} iOS {device.get('ios_version')}")
            for it, app in zip(items, apps):
                if self.cancel_requested:
                    app.update(status="skipped", error="Отменено")
                    continue
                app.update(status="downloading", error=None, progress=None)
                self.push(job_id, apps, f"{app['name']}: скачиваем из App Store")
                last_push = [0.0]

                def on_progress(size: int, app=app) -> None:
                    app["progress"] = f"{size / 1_000_000:.0f} МБ"
                    if time.time() - last_push[0] > 4:
                        last_push[0] = time.time()
                        self.push(job_id, apps, None)

                dl = self.store.download(None if it.get("app_id") else it["bundle_id"], it.get("app_id"), tmp, progress=on_progress)
                app["progress"] = None
                if dl["status"] != "ok":
                    app.update(status="not_owned" if dl["status"] == "not_owned" else "failed", error=dl["message"])
                    self.event(f"{app['name']}: {dl['message']}")
                    self.push(job_id, apps, f"{app['name']}: {dl['message']}")
                    continue
                app["version"] = ipa_version(dl["path"])
                app.update(status="installing")
                self.push(job_id, apps, f"{app['name']} {app['version'] or ''}: ставим по кабелю")
                ok, msg = self.devices.install(device["udid"], dl["path"], app["bundle_id"], app["name"], app["version"])
                app.update(status="installed" if ok else "failed", error=None if ok else msg)
                self.event(f"{app['name']}: {'установлено' if ok else msg}")
                self.push(job_id, apps, f"{app['name']}: {'установлено' if ok else 'ошибка: ' + msg}")
                try:
                    os.remove(dl["path"])
                except OSError:
                    pass
            status = "cancelled" if self.cancel_requested and not all(a["status"] in ("installed", "not_owned", "failed") for a in apps) else "done"
            installed = sum(1 for a in apps if a["status"] == "installed")
            if job_id:
                self.backend.finish(job_id, status, apps, None)
            session["status"] = status
            self.event(f"Готово: установлено {installed} из {len(apps)}")
        except Exception as exc:  # noqa: BLE001
            log(f"install error: {exc}")
            session["status"] = "failed"
            if job_id:
                self.backend.finish(job_id, "failed", apps, f"Ошибка станции: {str(exc)[:200]}")
            self.event(f"Ошибка установки: {exc}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            udid = device.get("udid")
            if udid and self.state.get("device") and self.state["device"].get("udid") == udid:
                installed = self.devices.installed_apps(udid)
                self.set(installed=self._public_installed(installed), owners=self._owners_summary(installed))
            with self.lock:
                hist = self.state["history"]
                hist.insert(0, {"t": session["started"], "device": device.get("model"), "status": session["status"],
                                "apps": [{"name": a["name"], "status": a["status"], "version": a["version"]} for a in apps]})
                del hist[20:]
            installed_any = any(a["status"] == "installed" for a in apps)
            if self.cfg.auto_logout and installed_any and self.store.info().get("logged_in"):
                self.logout()
            # Карточка с итогом (и ошибками) висит, пока сотрудник не нажмёт «Готово» или не начнёт новую установку
            self.set(session={**session, "apps": apps, "finished": True})
            self.busy = False

    def push(self, job_id: str | None, apps: list[dict], line: str | None) -> None:
        self.set(session={**self.state["session"], "apps": apps} if self.state.get("session") else None)
        if job_id:
            self.backend.progress(job_id, apps, line)


# ─────────────────────────────────────────────────────────────────────────────
# Страница сотрудника (127.0.0.1)
# ─────────────────────────────────────────────────────────────────────────────

PAGE = r"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>TakeSmart · Станция</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#0b1220;color:#e5e7eb;font:15px/1.45 -apple-system,Inter,system-ui,sans-serif}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;border-bottom:1px solid rgba(255,255,255,.08);background:#0e1628;position:sticky;top:0;z-index:5}
.top h1{margin:0;font-size:18px}.top h1 span{color:#facc15}.muted{color:#94a3b8;font-size:13px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:#64748b;vertical-align:middle}.dot.on{background:#22c55e}.dot.warn{background:#facc15}.dot.off{background:#ef4444}
.wrap{max-width:1180px;margin:0 auto;padding:20px 22px 40px;display:grid;gap:16px;grid-template-columns:340px 1fr}@media(max-width:900px){.wrap{grid-template-columns:1fr}}
.card{background:#111a2e;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.big{font-size:20px;font-weight:700;line-height:1.25}
label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 4px}input[type=text],input[type=password],input[type=search]{width:100%;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b1220;color:#fff;font-size:15px}
button{padding:10px 16px;border:0;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;background:#facc15;color:#0b1220}button.sec{background:rgba(255,255,255,.1);color:#fff}button.ghost{background:transparent;color:#94a3b8;padding:6px 10px;font-weight:500}button:disabled{opacity:.45;cursor:default}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.chip{padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.08);color:#cbd5e1;font-size:13px;cursor:pointer;border:0}.chip.on{background:#fff;color:#0b1220}
.list{max-height:52vh;overflow:auto;border:1px solid rgba(255,255,255,.07);border-radius:14px}.row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer}.row:first-child{border-top:0}.row:hover{background:rgba(255,255,255,.03)}.row input{width:18px;height:18px}.row .n{flex:1;min-width:0}.row .n b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row .n small{color:#64748b;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.st{font-size:12px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.08);white-space:nowrap}.st.installed{background:rgba(34,197,94,.18);color:#86efac}.st.not_owned{background:rgba(250,204,21,.15);color:#fde68a}.st.failed{background:rgba(239,68,68,.18);color:#fca5a5}.st.downloading,.st.installing{background:rgba(56,189,248,.18);color:#bae6fd}.st.have{background:rgba(148,163,184,.15);color:#cbd5e1}
.bar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:12px;border-radius:14px;background:#0e1628;border:1px solid rgba(255,255,255,.1)}
.note{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(250,204,21,.08);color:#fde68a;font-size:13px}.err{color:#fca5a5}.ok{color:#86efac}
.events{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#94a3b8;max-height:180px;overflow:auto;margin-top:8px}.events div{padding:2px 0}
.apps li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}.apps{list-style:none;margin:8px 0 0;padding:0}
.switch{display:flex;align-items:center;gap:8px;font-size:13px;color:#94a3b8;cursor:pointer}.switch input{width:16px;height:16px}
.hist{font-size:13px;color:#cbd5e1}.hist div{padding:6px 0;border-top:1px solid rgba(255,255,255,.07)}
</style></head><body>
<div class="top"><h1><span>TakeSmart</span> · Станция установки</h1><div class="muted" id="hdr"></div></div>
<div class="wrap">
  <div>
    <div class="card"><div class="eyebrow">iPhone по кабелю</div><div id="device"></div></div>
    <div class="card" style="margin-top:16px"><div class="eyebrow">Apple ID покупателя</div><div id="apple"></div></div>
    <div class="card" style="margin-top:16px"><div class="eyebrow">Журнал</div><div class="events" id="events"></div></div>
  </div>
  <div>
    <div class="card" id="main"></div>
    <div class="card" style="margin-top:16px"><div class="eyebrow">Сегодня на этой станции</div><div class="hist" id="hist"></div></div>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);let st=null,q='',filter='all',sel=new Set(),hideHave=false,lastEmail='';
const BANK=/сбер|sber|т-банк|tinkoff|тиньк|втб|vtb|альфа|alfa|газпром|gazprom|райф|raif|совком|sovcom|халва|halva|открыти|psb|псб|росбанк|rosbank|почта банк|pochta|мтс банк|mts bank|озон банк|ozon bank|юmoney|yoomoney|сбп|банк|bank|уралсиб|uralsib|дом\.рф|domrf|россельхоз|rshb|ренессанс|renaissance|синара|zenit|зенит|akbars|ак барс|мкб|mkb|credit|кредит/i;
async function api(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Station':'1'},body:b?JSON.stringify(b):undefined});return r.json()}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const L={pending:'в очереди',downloading:'скачиваем',installing:'ставим',installed:'установлено',not_owned:'нет в покупках',failed:'ошибка',skipped:'пропущено'};
function render(){if(!st)return;
$('#hdr').innerHTML=`<span class="dot ${st.connected?'on':(st.backend_configured?'off':'warn')}"></span>${st.connected?'Админка: связь есть · '+esc(st.station_name||''):(st.backend_configured?'Нет связи с админкой'+(st.last_error?': '+esc(st.last_error):''):'Не привязан к админке — откройте раздел «Приложения» в админке на этом Mac')} · v${st.version}${st.simulate?' · <b style="color:#fde68a">ЭМУЛЯЦИЯ</b>':''}`;
const d=st.device,have=st.installed||{},n=Object.keys(have).length;
$('#device').innerHTML=d?(d.paired?`<div class="big">${esc(d.model)}</div><div class="muted">iOS ${esc(d.ios_version||'?')} · ${esc(d.name||'')}</div><div class="muted" style="margin-top:6px">На телефоне ${n} приложений</div>`:`<div class="big" style="color:#fde68a">Подтвердите доверие</div><div class="muted">На iPhone нажмите «Доверять» и введите код-пароль</div>`):`<div class="big" style="color:#94a3b8">Не подключён</div><div class="muted">Подключите iPhone кабелем и разблокируйте его</div>`;
if(st.tools_missing&&st.tools_missing.length)$('#device').innerHTML+=`<div class="note err">Не найдены утилиты: ${st.tools_missing.join(', ')}. Установите: brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller</div>`;
const a=st.apple,l=st.login;let h='';
if(a.logged_in){h=`<div class="big"><span class="dot on"></span>${esc(a.name||'Вход выполнен')}</div><div class="muted">${esc(a.email||'')}</div><div class="muted" style="margin-top:6px">${st.purchases_loading?'Читаем историю покупок…':(st.purchases?'В истории покупок: '+st.purchases.length:'')}</div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="sec" onclick="api('/api/purchases',{}).then(load)">Обновить список</button><button class="sec" onclick="api('/api/logout',{}).then(()=>{sel.clear();load()})">Выйти из Apple ID</button></div>`;}
else if(l.status==='need_code'||(l.status==='working'&&l.pending)){h=`<div class="muted">Apple прислала код на устройства покупателя (или по SMS). Почту и пароль повторять не нужно.</div>
<label>Код подтверждения</label><input type="text" id="cd" inputmode="numeric" autocomplete="one-time-code" placeholder="6 цифр" onkeydown="if(event.key==='Enter')sendCode()">
<div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button onclick="sendCode()" ${l.status==='working'?'disabled':''}>${l.status==='working'?'Проверяем код…':'Подтвердить код'}</button><button class="ghost" onclick="api('/api/login',{reset:true}).then(load)">Другой Apple ID</button></div>
${l.message&&l.status!=='working'?`<div class="note">${esc(l.message)}</div>`:''}`;}
else{h=`<div class="muted">Покупатель вводит свой Apple ID здесь. Пароль и код уходят напрямую в Apple с этого Mac, у нас не сохраняются.</div>
<label>Apple ID (почта)</label><input type="text" id="em" autocomplete="off" placeholder="name@icloud.com" value="${esc(lastEmail)}">
<label>Пароль</label><input type="password" id="pw" autocomplete="off" onkeydown="if(event.key==='Enter')login()">
<div style="margin-top:12px"><button id="lg" onclick="login()" ${l.status==='working'?'disabled':''}>${l.status==='working'?'Связываемся с Apple…':'Войти'}</button></div>
${l.message?`<div class="note ${l.status==='error'?'err':''}">${esc(l.message)}</div>`:''}`;}
const mode=(a.logged_in?'in':'out')+l.status+(l.pending?'P':'')+(l.message||'')+(st.purchases?st.purchases.length:0)+(st.purchases_loading?'L':'');
if($('#apple').dataset.mode!==mode){$('#apple').innerHTML=h;$('#apple').dataset.mode=mode;}
renderMain();
$('#events').innerHTML=(st.events||[]).slice().reverse().map(e=>`<div>${e.t} ${esc(e.msg)}</div>`).join('');
$('#hist').innerHTML=(st.history||[]).length?st.history.map(s=>`<div><b>${s.t}</b> · ${esc(s.device||'')} · ${s.apps.map(x=>esc(x.name)+(x.version?' '+x.version:'')+' — '+(L[x.status]||x.status)).join(', ')}</div>`).join(''):'<div class="muted">Пока пусто</div>';}
let mainMode=null,lastSig='';
function renderMain(){const s=st.session,a=st.apple,d=st.device,have=st.installed||{};
const mode=s?'session':(!a.logged_in?'nologin':'purchases');
if(mode==='session'){$('#main').innerHTML=`<div class="eyebrow">Установка</div><div class="big">${s.status==='running'?'Идёт установка…':'Готово'}</div><ul class="apps">${s.apps.map(x=>`<li><span>${esc(x.name)} <span class="muted">${esc(x.version||'')}</span>${x.error?`<div class="muted err">${esc(x.error)}</div>`:''}</span><span class="st ${x.status}">${L[x.status]||x.status}</span></li>`).join('')}</ul>${s.status==='running'?'<div style="margin-top:12px"><button class="sec" onclick="api(\'/api/cancel\',{}).then(load)">Остановить после текущего</button></div>':''}`;mainMode=mode;return;}
if(mode==='nologin'){if(mainMode!==mode){$('#main').innerHTML=`<div class="eyebrow">Что ставим</div><div class="big" style="color:#94a3b8">Войдите в Apple ID покупателя</div><div class="muted" style="margin-top:6px">После входа здесь появится всё, что когда-либо было на его аккаунте: банки, соцсети, мессенджеры. Отметьте нужное и нажмите «Установить».</div>`;mainMode=mode;}return;}
if(mainMode!==mode){$('#main').innerHTML=`<div class="eyebrow">История покупок аккаунта</div>
<input type="search" id="q" placeholder="Поиск: Сбер, Т-Банк, ВК…" oninput="q=this.value;renderList()">
<div class="chips"><button class="chip" id="chip-all" onclick="filter='all';renderList()">Все</button><button class="chip" id="chip-bank" onclick="filter='bank';renderList()">Банки</button><button class="chip" id="chip-hide" onclick="hideHave=!hideHave;renderList()">Скрыть уже установленные</button><span class="muted" style="align-self:center" id="cnt"></span></div>
<div class="list" id="plist"></div>
<div class="bar"><span class="muted" id="barinfo"></span><button id="barbtn" onclick="install()">Установить выбранные</button></div>
<details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Поставить по App Store ID или Bundle ID</summary><div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="byid" placeholder="например 492224193 или ru.sberbankmobile"><button class="sec" onclick="byId()">Поставить</button></div><div class="muted" style="margin-top:6px">Сработает, только если приложение есть в истории покупок этого Apple ID или ещё доступно в App Store.</div></details>`;mainMode=mode;lastSig='';$('#q').value=q;}
const sig=JSON.stringify([(st.purchases||[]).length,Object.keys(have).sort().join(),!!(d&&d.paired),st.purchases_loading]);
if(sig!==lastSig){lastSig=sig;renderList();}}
function renderList(){const d=st.device,have=st.installed||{};
const list=(st.purchases||[]).filter(p=>{const t=(p.name+' '+p.bundle_id).toLowerCase();if(q&&!t.includes(q.toLowerCase()))return false;if(filter==='bank'&&!BANK.test(p.name+' '+p.bundle_id))return false;if(hideHave&&have[p.bundle_id])return false;return true;});
$('#chip-all').classList.toggle('on',filter==='all');$('#chip-bank').classList.toggle('on',filter==='bank');$('#chip-hide').classList.toggle('on',hideHave);
$('#cnt').textContent=`${list.length} из ${(st.purchases||[]).length}`;
const el=$('#plist'),top=el.scrollTop;
el.innerHTML=list.length?list.map(p=>{const hv=have[p.bundle_id];return `<label class="row"><input type="checkbox" ${sel.has(p.bundle_id)?'checked':''} onchange="tog('${esc(p.bundle_id)}',this.checked)">${p.icon?`<img src="${esc(p.icon)}" alt="" style="width:34px;height:34px;border-radius:9px;flex:none">`:`<span style="width:34px;height:34px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);font-weight:700">${esc((p.name||'?')[0])}</span>`}<span class="n"><b>${esc(p.name)}</b><small>${esc(p.bundle_id)}${p.version?' · '+esc(p.version):''}</small></span>${hv?`<span class="st have">стоит ${esc(hv.version||'')}</span>`:''}</label>`}).join(''):`<div class="muted" style="padding:16px">${st.purchases_loading?'Читаем историю покупок…':'Ничего не найдено'}</div>`;
el.scrollTop=top;renderBar();}
function renderBar(){const d=st.device;const canInstall=d&&d.paired&&sel.size>0;
$('#barinfo').textContent=(sel.size?`Выбрано ${sel.size}`:'Отметьте приложения')+(!d||!d.paired?' · подключите iPhone':'');
const b=$('#barbtn');b.disabled=!canInstall;b.textContent='Установить выбранные'+(sel.size?' ('+sel.size+')':'');}
function tog(b,on){if(on)sel.add(b);else sel.delete(b);renderBar()}
async function load(){try{st=await api('/api/state');render()}catch(e){}}
async function login(){const em=$('#em').value.trim(),pw=$('#pw').value;if(!em||!pw)return;lastEmail=em;await api('/api/login',{email:em,password:pw});setTimeout(load,300)}
async function sendCode(){const cd=$('#cd').value.trim();if(!cd)return;await api('/api/login',{code:cd});setTimeout(load,300)}
async function install(){const items=(st.purchases||[]).filter(p=>sel.has(p.bundle_id)).map(p=>({bundle_id:p.bundle_id,name:p.name,id:p.id}));const r=await api('/api/install',{apps:items});if(!r.ok)alert(r.message);sel.clear();load()}
async function byId(){const v=$('#byid').value.trim();if(!v)return;const isId=/^\d+$/.test(v);const r=await api('/api/install',{apps:[isId?{id:Number(v),name:'App Store #'+v}:{bundle_id:v,name:v}]});if(!r.ok)alert(r.message);load()}
load();setInterval(load,1500);
</script></body></html>"""


ALLOWED_ORIGIN_RE = re.compile(r"^(https://(www\.)?takesmart\.ru|http://(localhost|127\.0\.0\.1)(:\d+)?)$")


def make_handler(station: Station):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:
            pass

        def _origin_allowed(self) -> str | None:
            origin = self.headers.get("Origin")
            if not origin:
                return None
            if ALLOWED_ORIGIN_RE.match(origin) or origin in station.cfg.cors_origins:
                return origin
            return None

        def _cors(self) -> None:
            origin = self._origin_allowed()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Station")
                self.send_header("Access-Control-Max-Age", "600")
                # Chrome: запрос с публичного сайта к 127.0.0.1 (Private/Local Network Access)
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Allow-Local-Network", "true")

        def _json(self, code: int, data: dict) -> None:
            raw = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if self.path.startswith("/api/state"):
                self._json(200, station.snapshot())
                return
            raw = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self) -> None:  # noqa: N802
            # Свой заголовок = обязательный preflight: чужой сайт из браузера POST не отправит.
            if self.headers.get("X-Station") != "1" or (self.headers.get("Origin") and not self._origin_allowed()):
                self._json(403, {"ok": False, "message": "Запрос не от страницы TakeSmart"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            except json.JSONDecodeError:
                body = {}
            if self.path == "/api/login":
                if body.get("reset"):
                    station.reset_login()
                    self._json(200, {"ok": True})
                    return
                email, password = (body.get("email") or "").strip(), body.get("password") or ""
                code = (body.get("code") or "").strip() or None
                if not (email and password) and not (code and station._pending_login):
                    self._json(400, {"ok": False, "message": "Нужны почта и пароль"})
                    return
                threading.Thread(target=station.login, args=(email or None, password or None, code), daemon=True).start()
                self._json(202, {"ok": True})
            elif self.path == "/api/logout":
                station.logout()
                self._json(200, {"ok": True})
            elif self.path == "/api/purchases":
                threading.Thread(target=station.refresh_purchases, daemon=True).start()
                self._json(202, {"ok": True})
            elif self.path == "/api/install":
                ok, message = station.start_install(body.get("apps") or [], body.get("note"))
                self._json(200 if ok else 400, {"ok": ok, "message": message})
            elif self.path == "/api/cancel":
                station.cancel_requested = True
                self._json(200, {"ok": True})
            elif self.path == "/api/settings":
                backend_url, token = body.get("backend_url"), body.get("token")
                if (backend_url is None) != (token is None) or (backend_url is not None and not re.match(r"^https?://", str(backend_url))):
                    self._json(400, {"ok": False, "message": "Нужны адрес админки и токен"})
                    return
                station.apply_settings(backend_url, token, body.get("auto_logout"))
                self._json(200, {"ok": True})
            else:
                self._json(404, {"ok": False, "message": "not found"})

    return Handler


# ─────────────────────────────────────────────────────────────────────────────
# Автозапуск (LaunchAgent macOS)
# ─────────────────────────────────────────────────────────────────────────────

LAUNCH_AGENT_LABEL = "ru.takesmart.station"


def launch_agent_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"


def build_launch_agent(script_path: Path, port: int) -> dict:
    return {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [sys.executable, str(script_path), "--no-open", "--port", str(port)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(CONFIG_DIR / "autostart.log"),
        "StandardErrorPath": str(CONFIG_DIR / "autostart.log"),
        "EnvironmentVariables": {"PATH": ":".join(TOOL_DIRS + ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]), "LANG": "ru_RU.UTF-8"},
    }


def install_autostart(port: int) -> int:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    plist = launch_agent_path()
    plist.parent.mkdir(parents=True, exist_ok=True)
    with plist.open("wb") as f:
        plistlib.dump(build_launch_agent(Path(__file__).resolve(), port), f)
    uid = os.getuid()
    run(["launchctl", "bootout", f"gui/{uid}", str(plist)], timeout=15)  # старая копия, если была
    code, _, err = run(["launchctl", "bootstrap", f"gui/{uid}", str(plist)], timeout=15)
    if code != 0:
        code, _, err = run(["launchctl", "load", "-w", str(plist)], timeout=15)
    if code != 0:
        print(f"Не удалось включить автозапуск: {err.strip() or code}. Запустите вручную: python3 {Path(__file__).name}")
        return 1
    print("Помощник запущен и будет стартовать сам при входе в macOS.")
    print(f"Откройте админку TakeSmart → «Приложения» на этом Mac. Журнал: {CONFIG_DIR / 'station.log'}")
    print(f"Выключить автозапуск: python3 {Path(__file__).name} --stop-autostart")
    return 0


def remove_autostart() -> int:
    plist = launch_agent_path()
    if plist.exists():
        run(["launchctl", "bootout", f"gui/{os.getuid()}", str(plist)], timeout=15)
        plist.unlink()
        print("Автозапуск выключен, помощник остановлен.")
    else:
        print("Автозапуск не был включён.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="TakeSmart Station — установка приложений на iPhone")
    parser.add_argument("--setup", action="store_true", help="сохранить настройки и выйти")
    parser.add_argument("--backend", help="адрес сайта, напр. https://takesmart.ru")
    parser.add_argument("--token", help="токен станции из админки")
    parser.add_argument("--port", type=int, help="порт локальной страницы (по умолчанию 8765)")
    parser.add_argument("--simulate", action="store_true", help="эмуляция iPhone и Apple ID, для проверки без телефона")
    parser.add_argument("--no-auto-logout", action="store_true", help="не выходить из Apple ID после установки")
    parser.add_argument("--no-open", action="store_true", help="не открывать страницу в браузере")
    parser.add_argument("--autostart", action="store_true", help="включить автозапуск при входе в macOS и запустить сейчас")
    parser.add_argument("--stop-autostart", action="store_true", help="выключить автозапуск и остановить помощник")
    parser.add_argument("--config-dir", help="где хранить настройки (по умолчанию ~/Library/Application Support/TakeSmart Station)")
    parser.add_argument("--cors-origin", action="append", default=[], help="разрешить запросы с этого адреса админки (можно несколько)")
    args = parser.parse_args()

    global CONFIG_DIR, CONFIG_PATH, LOG_PATH
    if args.config_dir:
        CONFIG_DIR = Path(args.config_dir).expanduser()
        CONFIG_PATH, LOG_PATH = CONFIG_DIR / "config.json", CONFIG_DIR / "station.log"

    cfg = Config.load()
    for origin in args.cors_origin:
        if origin not in cfg.cors_origins:
            cfg.cors_origins.append(origin)
    if args.backend:
        cfg.backend_url = args.backend
    if args.token:
        cfg.token = args.token
    if args.port:
        cfg.ui_port = args.port
    if args.simulate:
        cfg.simulate = True
    if args.no_auto_logout:
        cfg.auto_logout = False
    if not cfg.keychain_passphrase:
        cfg.keychain_passphrase = os.urandom(16).hex()
    if args.setup or args.backend or args.token:
        cfg.save()
        log(f"Настройки сохранены: {CONFIG_PATH}")
        if args.setup:
            return 0
    if args.stop_autostart:
        return remove_autostart()
    if args.autostart:
        cfg.save()
        return install_autostart(cfg.ui_port)

    station = Station(cfg)
    if not cfg.backend_url or not cfg.token:
        log("Помощник не привязан к админке: откройте раздел «Приложения» в админке TakeSmart на этом Mac — он привяжет сам. "
            "Установка работает и без этого, но история не записывается.")
    if station.state["tools_missing"]:
        log("Не найдены утилиты: " + ", ".join(station.state["tools_missing"]))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", cfg.ui_port), make_handler(station))
    except OSError as exc:
        if getattr(exc, "errno", None) in (48, 98):
            print(f"Помощник уже запущен (порт {cfg.ui_port} занят) — скорее всего через автозапуск. "
                  "Просто откройте админку TakeSmart → «Приложения».")
            return 0
        raise
    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=station.heartbeat_loop, daemon=True).start()
    threading.Thread(target=station.command_worker, daemon=True).start()
    log(f"Станция v{VERSION} запущена. Страница сотрудника: http://127.0.0.1:{cfg.ui_port}  (Ctrl+C — стоп)")
    if not args.no_open:
        try:
            subprocess.Popen(["open", f"http://127.0.0.1:{cfg.ui_port}"])
        except OSError:
            pass
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        station.stop.set()
        server.shutdown()
        log("Станция остановлена")
    return 0


if __name__ == "__main__":
    sys.exit(main())
