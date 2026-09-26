#!/usr/bin/env python3
"""
TakeSmart Station — установка приложений на iPhone покупателя.

Запускается на Mac в павильоне. Что делает:
  • видит iPhone, подключённый по кабелю (libimobiledevice);
  • держит связь с админкой TakeSmart по токену станции: пульс раз в 2 секунды,
    забирает задания из очереди, отчитывается о ходе установки;
  • скачивает приложение из истории покупок Apple ID покупателя (ipatool)
    и ставит его по кабелю (ideviceinstaller);
  • даёт сотруднику локальную страницу http://127.0.0.1:8765 — единственное
    место, где вводятся Apple ID, пароль и код. На сервер TakeSmart они не
    уходят и нигде не сохраняются; после задания станция сама выходит из аккаунта.

Зависимости: только Python 3.9+ из macOS и утилиты из Homebrew:
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
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

VERSION = "0.1.0"
CONFIG_DIR = Path.home() / "Library" / "Application Support" / "TakeSmart Station"
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_PATH = CONFIG_DIR / "station.log"
HEARTBEAT_SECONDS = 2.0
TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]

# ProductType → торговое имя. Незнакомое устройство покажется своим кодом.
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


def run(cmd: list[str], timeout: int = 60, env: dict | None = None) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as exc:
        return 127, "", str(exc)


def last_json(text: str) -> dict:
    """ipatool печатает по одному JSON на строку; берём последний объект."""
    for line in reversed([l for l in text.splitlines() if l.strip()]):
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


class Config:
    def __init__(self) -> None:
        self.backend_url = ""
        self.token = ""
        self.ui_port = 8765
        self.auto_logout = True
        self.simulate = False
        self.keychain_passphrase = ""

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text())
                for k, v in data.items():
                    if hasattr(cfg, k):
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

class DeviceTools:
    def __init__(self, simulate: bool) -> None:
        self.simulate = simulate
        self.idevice_id = find_tool("idevice_id")
        self.ideviceinfo = find_tool("ideviceinfo")
        self.idevicepair = find_tool("idevicepair")
        self.ideviceinstaller = find_tool("ideviceinstaller")

    @property
    def missing(self) -> list[str]:
        if self.simulate:
            return []
        return [n for n, p in (("idevice_id", self.idevice_id), ("ideviceinfo", self.ideviceinfo),
                                ("idevicepair", self.idevicepair), ("ideviceinstaller", self.ideviceinstaller)) if not p]

    def detect(self) -> dict | None:
        if self.simulate:
            return {"udid": "SIMULATED-0000-DEVICE", "model": "iPhone 15 Pro (эмуляция)", "ios_version": "18.6",
                    "name": "iPhone (эмуляция)", "paired": True}
        if not self.idevice_id:
            return None
        code, out, _ = run([self.idevice_id, "-l"], timeout=10)
        udids = [u.strip() for u in out.splitlines() if u.strip()]
        if code != 0 or not udids:
            return None
        udid = udids[0]
        info: dict[str, Any] = {"udid": udid, "model": None, "ios_version": None, "name": None, "paired": None}
        pcode, _, perr = run([self.idevicepair, "-u", udid, "validate"], timeout=10)
        info["paired"] = pcode == 0
        if not info["paired"]:
            # Запускаем сопряжение: на телефоне появится «Доверять этому компьютеру?»
            run([self.idevicepair, "-u", udid, "pair"], timeout=10)
            info["model"] = "iPhone"
            info["name"] = "Подтвердите доверие на iPhone"
            return info
        for key, field in (("ProductType", "model"), ("ProductVersion", "ios_version"), ("DeviceName", "name")):
            c, o, _ = run([self.ideviceinfo, "-u", udid, "-k", key], timeout=10)
            if c == 0 and o.strip():
                info[field] = o.strip()
        info["model"] = IPHONE_MODELS.get(info["model"] or "", info["model"] or "iPhone")
        return info

    def install(self, udid: str, ipa_path: str) -> tuple[bool, str]:
        if self.simulate:
            time.sleep(1.2)
            return True, "Install: Complete (эмуляция)"
        code, out, err = run([self.ideviceinstaller, "-u", udid, "-i", ipa_path], timeout=600)
        text = (out + "\n" + err).strip()
        ok = code == 0 and ("Complete" in text or "complete" in text)
        if ok:
            return True, "Install: Complete"
        tail = [l for l in text.splitlines() if l.strip()][-3:]
        return False, " | ".join(tail)[:300] or f"ideviceinstaller завершился с кодом {code}"


# ─────────────────────────────────────────────────────────────────────────────
# Apple ID и скачивание (ipatool)
# ─────────────────────────────────────────────────────────────────────────────

class StoreTools:
    def __init__(self, simulate: bool, keychain_passphrase: str) -> None:
        self.simulate = simulate
        self.ipatool = find_tool("ipatool")
        self.passphrase = keychain_passphrase
        self._sim_logged_in = False
        self._sim_email: str | None = None

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
            return {"logged_in": self._sim_logged_in, "email": mask_email(self._sim_email)}
        code, out, err = run(self._base("auth", "info"), timeout=30)
        data = last_json(out + err)
        if data.get("success") is False or code != 0:
            return {"logged_in": False, "email": None}
        return {"logged_in": True, "email": mask_email(data.get("email"))}

    def login(self, email: str, password: str, code: str | None) -> dict:
        """→ {status: ok|need_code|error, message}"""
        if self.simulate:
            if code is None and not password.startswith("nocode"):
                return {"status": "need_code", "message": "Введите код из SMS или с другого устройства Apple"}
            self._sim_logged_in, self._sim_email = True, email
            return {"status": "ok", "message": "Вход выполнен (эмуляция)"}
        args = ["auth", "login", "--email", email, "--password", password]
        if code:
            args += ["--auth-code", code]
        rc, out, err = run(self._base(*args), timeout=120)
        data = last_json(out + err)
        if data.get("success") and rc == 0:
            return {"status": "ok", "message": "Вход выполнен"}
        error = str(data.get("error") or err or out).strip()
        low = error.lower()
        if any(k in low for k in ("2fa", "auth code", "two-factor", "verification code", "authcode")):
            return {"status": "need_code", "message": "Введите код, который Apple прислала на устройства покупателя"}
        if "password" in low or "credentials" in low or "invalid" in low:
            return {"status": "error", "message": "Apple не приняла почту или пароль"}
        return {"status": "error", "message": error[:200] or "Не удалось войти"}

    def revoke(self) -> None:
        if self.simulate:
            self._sim_logged_in, self._sim_email = False, None
            return
        run(self._base("auth", "revoke"), timeout=30)
        for extra in (Path.home() / ".ipatool",):
            for f in extra.glob("cookies*"):
                try:
                    f.unlink()
                except OSError:
                    pass

    def purchases(self) -> list[dict]:
        """Что есть в истории покупок аккаунта: [{bundle_id, name, id}]."""
        if self.simulate:
            return [{"bundle_id": "ru.sberbankmobile", "name": "СберБанк Онлайн", "id": 1},
                    {"bundle_id": "com.vk.vkclient", "name": "ВКонтакте", "id": 2},
                    {"bundle_id": "ph.telegra.Telegraph", "name": "Telegram", "id": 3}]
        result: list[dict] = []
        for page in range(1, 40):
            rc, out, err = run(self._base("list-purchases", "-l", "200", "-p", str(page), "--platform", "iphone"), timeout=90)
            data = last_json(out + err)
            apps = data.get("apps") or data.get("purchases") or []
            if rc != 0 or not apps:
                break
            for a in apps:
                result.append({"bundle_id": a.get("bundleID") or a.get("bundle_id") or "",
                               "name": a.get("name") or "", "id": a.get("id")})
            if len(apps) < 200:
                break
        return result

    def download(self, bundle_id: str, out_dir: str) -> dict:
        """→ {status: ok|not_owned|error, path, message}"""
        if self.simulate:
            time.sleep(1.5)
            if bundle_id in ("ru.sberbankmobile", "com.vk.vkclient", "ph.telegra.Telegraph"):
                p = Path(out_dir) / f"{bundle_id}.ipa"
                with zipfile.ZipFile(p, "w") as z:
                    z.writestr("iTunesMetadata.plist", plistlib.dumps({"bundleShortVersionString": "16.3.0"}))
                return {"status": "ok", "path": str(p), "message": "Скачано (эмуляция)"}
            return {"status": "not_owned", "path": None, "message": "Нет в истории покупок этого Apple ID"}
        path = str(Path(out_dir) / f"{bundle_id}.ipa")
        rc, out, err = run(self._base("download", "-b", bundle_id, "-o", path, "--purchase", "--platform", "iphone"),
                           timeout=900)
        data = last_json(out + err)
        if rc == 0 and data.get("success") and Path(path).exists():
            return {"status": "ok", "path": path, "message": "Скачано"}
        error = str(data.get("error") or err or out).strip()
        low = error.lower()
        if any(k in low for k in ("license", "purchase", "not found", "no app", "does not exist", "unavailable")):
            return {"status": "not_owned", "path": None, "message": "Нет в истории покупок этого Apple ID"}
        return {"status": "error", "path": None, "message": error[:300] or "Не удалось скачать"}


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
                    return str(info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or "")
    except Exception:  # noqa: BLE001
        return None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Связь с админкой TakeSmart
# ─────────────────────────────────────────────────────────────────────────────

class Backend:
    def __init__(self, base_url: str, token: str) -> None:
        self.base = base_url.rstrip("/") + "/api/v1/installs/station"
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None, timeout: int = 15) -> tuple[int, dict]:
        data = json.dumps(body or {}, ensure_ascii=False).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-Station-Token": self.token,
                                              "User-Agent": f"TakeSmartStation/{VERSION}"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="ignore")
            try:
                return exc.code, json.loads(raw)
            except json.JSONDecodeError:
                return exc.code, {"detail": raw[:200]}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return 0, {"detail": str(exc)[:200]}

    def heartbeat(self, payload: dict) -> tuple[int, dict]:
        return self.call("POST", "/heartbeat", payload)

    def claim(self, job_id: str, device: dict) -> tuple[int, dict]:
        return self.call("POST", f"/jobs/{job_id}/claim", {"device": device})

    def progress(self, job_id: str, apps: list[dict] | None, log_line: str | None) -> tuple[int, dict]:
        return self.call("POST", f"/jobs/{job_id}/progress", {"apps": apps, "log": log_line})

    def finish(self, job_id: str, status: str, apps: list[dict], log_line: str | None) -> tuple[int, dict]:
        return self.call("POST", f"/jobs/{job_id}/finish", {"status": status, "apps": apps, "log": log_line})


# ─────────────────────────────────────────────────────────────────────────────
# Станция
# ─────────────────────────────────────────────────────────────────────────────

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
            "device": None, "apple": {"logged_in": False, "email": None},
            "purchases": None, "job": None, "request": None, "current": None,
            "login": {"status": "idle", "message": None}, "events": [], "auto_logout": cfg.auto_logout,
            "tools_missing": self.devices.missing + self.store.missing,
        }
        self.stop = threading.Event()
        self.busy = False
        self.cancel_requested = False

    # ── состояние ────────────────────────────────────────────────────────

    def event(self, msg: str) -> None:
        log(msg)
        with self.lock:
            ev = self.state["events"]
            ev.append({"t": datetime.now().strftime("%H:%M:%S"), "msg": msg})
            del ev[:-60]

    def snapshot(self) -> dict:
        with self.lock:
            return json.loads(json.dumps(self.state, ensure_ascii=False))

    def set(self, **kw: Any) -> None:
        with self.lock:
            self.state.update(kw)

    # ── циклы ────────────────────────────────────────────────────────────

    def heartbeat_loop(self) -> None:
        while not self.stop.is_set():
            try:
                device = self.devices.detect()
                apple = self.store.info() if not self.busy else self.state["apple"]
                self.set(device=device, apple=apple)
                code, data = self.backend.heartbeat({
                    "version": VERSION, "busy": self.busy,
                    "device": device, "apple": {"logged_in": bool(apple.get("logged_in")),
                                                "purchases_count": (len(self.state["purchases"]) if self.state.get("purchases") else None)},
                })
                if code == 200:
                    self.set(connected=True, last_error=None, station_name=data["station"]["name"])
                    job, req = data.get("next_job"), data.get("request")
                    if not self.busy:
                        self.set(job=job, request=req)
                        if job and job["status"] in ("queued", "running") and device and device.get("paired"):
                            threading.Thread(target=self.run_job, args=(job, req, device), daemon=True).start()
                elif code == 401:
                    self.set(connected=False, last_error="Админка не принимает токен станции")
                else:
                    self.set(connected=False, last_error=data.get("detail") or f"Ответ {code}")
            except Exception as exc:  # noqa: BLE001
                self.set(connected=False, last_error=str(exc)[:200])
                log(f"heartbeat error: {exc}")
            self.stop.wait(HEARTBEAT_SECONDS)

    # ── вход в Apple ID (вызывается из локальной страницы) ──────────────

    def login(self, email: str, password: str, code: str | None) -> None:
        self.set(login={"status": "working", "message": "Связываемся с Apple…"})
        result = self.store.login(email.strip(), password, (code or "").strip() or None)
        self.set(login={"status": result["status"], "message": result["message"]})
        if result["status"] == "ok":
            self.event("Вход в Apple ID выполнен")
            self.refresh_purchases()

    def logout(self) -> None:
        self.store.revoke()
        self.set(apple={"logged_in": False, "email": None}, purchases=None, login={"status": "idle", "message": None})
        self.event("Вышли из Apple ID, данные аккаунта удалены со станции")

    def refresh_purchases(self) -> None:
        try:
            purchases = self.store.purchases()
            self.set(purchases=purchases)
            self.event(f"В истории покупок аккаунта {len(purchases)} приложений")
        except Exception as exc:  # noqa: BLE001
            self.event(f"Не удалось прочитать покупки: {exc}")

    # ── задание ──────────────────────────────────────────────────────────

    @staticmethod
    def resolve_bundle(app: dict, purchases: list[dict]) -> str | None:
        """Точное совпадение по Bundle ID, иначе по названию из истории покупок."""
        wanted = app["bundle_id"].lower()
        for p in purchases:
            if (p.get("bundle_id") or "").lower() == wanted:
                return p["bundle_id"]
        name = re.sub(r"[^a-zа-яё0-9]+", " ", app["name"].lower()).strip()
        for p in purchases:
            pname = re.sub(r"[^a-zа-яё0-9]+", " ", (p.get("name") or "").lower())
            if name and (name in pname or pname.strip() in name):
                return p["bundle_id"]
        return None

    def run_job(self, job: dict, req: dict | None, device: dict) -> None:
        if self.busy:
            return
        self.busy = True
        self.cancel_requested = False
        job_id = job["id"]
        apps = [dict(a) for a in job["apps"]]
        tmp = tempfile.mkdtemp(prefix="takesmart-")
        try:
            who = (req or {}).get("customer_name") or "покупатель"
            self.event(f"Задание {job_id[:8]}: {who}, {len(apps)} прил., {device.get('model')} iOS {device.get('ios_version')}")
            code, data = self.backend.claim(job_id, device)
            if code not in (200, 201):
                self.event(f"Не удалось взять задание: {data.get('detail')}")
                return
            self.set(current={"job_id": job_id, "step": "wait_login"})

            # Ждём вход в Apple ID покупателя на локальной странице
            waited = 0
            while not self.store.info().get("logged_in"):
                if waited == 0:
                    self.backend.progress(job_id, None, "Ждём вход в Apple ID покупателя на станции")
                    self.event("Введите Apple ID покупателя на странице станции")
                if self.cancel_requested or self.stop.is_set():
                    self.backend.finish(job_id, "cancelled", apps, "Отменено на станции")
                    return
                time.sleep(2)
                waited += 2
            self.set(apple=self.store.info())
            if self.state.get("purchases") is None:
                self.refresh_purchases()
            purchases = self.state.get("purchases") or []

            self.set(current={"job_id": job_id, "step": "install"})
            for app in apps:
                if self.cancel_requested:
                    break
                bundle = self.resolve_bundle(app, purchases) if purchases else app["bundle_id"]
                if not bundle:
                    app.update(status="not_owned", error="Нет в истории покупок этого Apple ID")
                    self.event(f"{app['name']}: нет в истории покупок")
                    self.backend.progress(job_id, apps, f"{app['name']}: нет в истории покупок")
                    continue
                app.update(status="downloading", error=None)
                code, _ = self.backend.progress(job_id, apps, f"{app['name']}: скачиваем из App Store")
                if code == 409:
                    self.cancel_requested = True
                    break
                dl = self.store.download(bundle, tmp)
                if dl["status"] != "ok":
                    app.update(status="not_owned" if dl["status"] == "not_owned" else "failed", error=dl["message"])
                    self.event(f"{app['name']}: {dl['message']}")
                    self.backend.progress(job_id, apps, f"{app['name']}: {dl['message']}")
                    continue
                app["version"] = ipa_version(dl["path"])
                app.update(status="installing")
                self.backend.progress(job_id, apps, f"{app['name']} {app['version'] or ''}: ставим по кабелю")
                ok, msg = self.devices.install(device["udid"], dl["path"])
                app.update(status="installed" if ok else "failed", error=None if ok else msg)
                self.event(f"{app['name']}: {'установлено' if ok else msg}")
                self.backend.progress(job_id, apps, f"{app['name']}: {'установлено' if ok else 'ошибка: ' + msg}")
                try:
                    os.remove(dl["path"])
                except OSError:
                    pass

            status = "cancelled" if self.cancel_requested else "done"
            installed = sum(1 for a in apps if a["status"] == "installed")
            self.backend.finish(job_id, status, apps, None if status == "done" else "Отменено на станции")
            self.event(f"Задание завершено: установлено {installed} из {len(apps)}")
        except Exception as exc:  # noqa: BLE001
            log(f"job error: {exc}")
            self.backend.finish(job_id, "failed", apps, f"Ошибка станции: {str(exc)[:200]}")
            self.event(f"Ошибка задания: {exc}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            if self.cfg.auto_logout and self.store.info().get("logged_in"):
                self.logout()
            self.set(current=None, job=None, request=None)
            self.busy = False


# ─────────────────────────────────────────────────────────────────────────────
# Локальная страница сотрудника (127.0.0.1)
# ─────────────────────────────────────────────────────────────────────────────

PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>TakeSmart · Станция</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e5e7eb;font:15px/1.45 -apple-system,Inter,system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 60px}h1{margin:0;font-size:22px}h1 span{color:#facc15}
.grid{display:grid;gap:16px;grid-template-columns:1fr 1fr}@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:#111a2e;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px}
.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.big{font-size:20px;font-weight:700}.muted{color:#94a3b8;font-size:13px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;background:#64748b}.dot.on{background:#22c55e}.dot.warn{background:#facc15}.dot.off{background:#ef4444}
label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 4px}input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b1220;color:#fff;font-size:15px}
button{margin-top:12px;padding:11px 16px;border:0;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;background:#facc15;color:#0b1220}button.sec{background:rgba(255,255,255,.1);color:#fff}button:disabled{opacity:.5;cursor:default}
.apps{list-style:none;margin:10px 0 0;padding:0}.apps li{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.07)}
.st{font-size:12px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.08)}.st.installed{background:rgba(34,197,94,.18);color:#86efac}.st.not_owned{background:rgba(250,204,21,.15);color:#fde68a}.st.failed{background:rgba(239,68,68,.18);color:#fca5a5}.st.downloading,.st.installing{background:rgba(56,189,248,.18);color:#bae6fd}
.events{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#94a3b8;max-height:220px;overflow:auto;margin-top:8px}.events div{padding:2px 0}
.note{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(250,204,21,.08);color:#fde68a;font-size:13px}.err{color:#fca5a5}
</style></head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
<h1><span>TakeSmart</span> · Станция установки</h1><div class="muted" id="hdr"></div></div>
<div class="grid" style="margin-top:20px">
<div class="card"><div class="eyebrow">iPhone по кабелю</div><div id="device"></div></div>
<div class="card"><div class="eyebrow">Apple ID покупателя</div><div id="apple"></div></div>
<div class="card" style="grid-column:1/-1"><div class="eyebrow">Задание</div><div id="job"></div></div>
<div class="card" style="grid-column:1/-1"><div class="eyebrow">Журнал станции</div><div class="events" id="events"></div></div>
</div></div>
<script>
const $=s=>document.querySelector(s);let st=null;
async function api(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function render(){if(!st)return;
$('#hdr').innerHTML=`<span class="dot ${st.connected?'on':'off'}"></span>${st.connected?'Связь с админкой есть · '+esc(st.station_name||''):'Нет связи с админкой'+(st.last_error?': '+esc(st.last_error):'')}${st.simulate?' · <b style=color:#fde68a>ЭМУЛЯЦИЯ</b>':''}`;
const d=st.device;$('#device').innerHTML=d?(d.paired?`<div class="big">${esc(d.model)}</div><div class="muted">iOS ${esc(d.ios_version||'?')} · ${esc(d.name||'')}</div><div class="muted">UDID …${esc((d.udid||'').slice(-8))}</div>`:`<div class="big">Подтвердите доверие</div><div class="muted">На iPhone нажмите «Доверять» и введите код-пароль</div>`):`<div class="big" style="color:#94a3b8">Не подключён</div><div class="muted">Подключите iPhone кабелем и разблокируйте его</div>`;
if(st.tools_missing&&st.tools_missing.length)$('#device').innerHTML+=`<div class="note err">Не найдены утилиты: ${st.tools_missing.join(', ')}. Установите: brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller</div>`;
const a=st.apple,l=st.login;let h='';
if(a.logged_in){h=`<div class="big"><span class="dot on"></span>${esc(a.email||'вход выполнен')}</div><div class="muted">${st.purchases?('В истории покупок: '+st.purchases.length+' приложений'):'Читаем историю покупок…'}</div><button class="sec" onclick="api('/api/logout',{}).then(load)">Выйти из Apple ID</button>`;}
else{h=`<div class="muted">Пароль и код уходят напрямую в Apple с этого Mac. На сервер TakeSmart они не попадают и после установки удаляются.</div>
<label>Apple ID (почта)</label><input id="em" autocomplete="off" placeholder="name@icloud.com">
<label>Пароль</label><input id="pw" type="password" autocomplete="off">
${l.status==='need_code'?'<label>Код подтверждения</label><input id="cd" inputmode="numeric" placeholder="6 цифр">':''}
<button id="lg" onclick="login()" ${l.status==='working'?'disabled':''}>${l.status==='working'?'Связываемся с Apple…':(l.status==='need_code'?'Подтвердить код':'Войти')}</button>
${l.message?`<div class="note ${l.status==='error'?'err':''}">${esc(l.message)}</div>`:''}`;}
if($('#apple').dataset.mode!==(a.logged_in?'in':'out')+l.status){$('#apple').innerHTML=h;$('#apple').dataset.mode=(a.logged_in?'in':'out')+l.status;}
const j=st.job,r=st.request;
$('#job').innerHTML=j?`<div class="big">${esc(r?r.customer_name:'')} <span class="muted">${esc(r?r.request_number:'')}</span></div><div class="muted">${esc(r?r.customer_phone:'')} · статус: ${esc(j.status)}${st.current?' · '+(st.current.step==='wait_login'?'ждём вход в Apple ID':'установка'):''}</div>
<ul class="apps">${j.apps.map(x=>`<li><span>${esc(x.name)} <span class="muted">${esc(x.version||'')}</span>${x.error?`<div class="muted err">${esc(x.error)}</div>`:''}</span><span class="st ${x.status}">${({pending:'в очереди',downloading:'скачиваем',installing:'ставим',installed:'установлено',not_owned:'нет в покупках',failed:'ошибка',skipped:'пропущено'})[x.status]||x.status}</span></li>`).join('')}</ul>`
:`<div class="muted">Заданий нет. Отправьте заявку на эту станцию из админки: раздел «Установка приложений».</div>`;
$('#events').innerHTML=(st.events||[]).slice().reverse().map(e=>`<div>${e.t} ${esc(e.msg)}</div>`).join('');}
async function load(){try{st=await api('/api/state');render()}catch(e){}}
async function login(){const em=$('#em').value,pw=$('#pw').value,cd=$('#cd')?$('#cd').value:'';await api('/api/login',{email:em,password:pw,code:cd});setTimeout(load,300)}
load();setInterval(load,1500);
</script></body></html>"""


def make_handler(station: Station):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: Any) -> None:  # тихий сервер
            pass

        def _json(self, code: int, data: dict) -> None:
            raw = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

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
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if self.path == "/api/login":
                email, password = body.get("email", ""), body.get("password", "")
                if not email or not password:
                    self._json(400, {"detail": "Нужны почта и пароль"})
                    return
                threading.Thread(target=station.login, args=(email, password, body.get("code")), daemon=True).start()
                self._json(202, {"ok": True})
            elif self.path == "/api/logout":
                station.logout()
                self._json(200, {"ok": True})
            elif self.path == "/api/purchases":
                threading.Thread(target=station.refresh_purchases, daemon=True).start()
                self._json(202, {"ok": True})
            elif self.path == "/api/cancel":
                station.cancel_requested = True
                self._json(200, {"ok": True})
            else:
                self._json(404, {"detail": "not found"})

    return Handler


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="TakeSmart Station — установка приложений на iPhone")
    parser.add_argument("--setup", action="store_true", help="сохранить настройки и выйти")
    parser.add_argument("--backend", help="адрес сайта, напр. https://takesmart.ru")
    parser.add_argument("--token", help="токен станции из админки")
    parser.add_argument("--port", type=int, help="порт локальной страницы (по умолчанию 8765)")
    parser.add_argument("--simulate", action="store_true", help="эмуляция iPhone и Apple ID, для проверки связки без телефона")
    parser.add_argument("--no-auto-logout", action="store_true", help="не выходить из Apple ID после задания")
    args = parser.parse_args()

    cfg = Config.load()
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
    if not cfg.backend_url or not cfg.token:
        print("Не заданы адрес админки и токен. Запустите:\n  python3 takesmart_station.py --setup --backend https://takesmart.ru --token ts_...")
        return 2

    station = Station(cfg)
    if station.state["tools_missing"]:
        log("Не найдены утилиты: " + ", ".join(station.state["tools_missing"]))
    server = ThreadingHTTPServer(("127.0.0.1", cfg.ui_port), make_handler(station))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=station.heartbeat_loop, daemon=True).start()
    log(f"Станция v{VERSION} запущена. Страница сотрудника: http://127.0.0.1:{cfg.ui_port}  (Ctrl+C — стоп)")
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
