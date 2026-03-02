"""
run.py — стартовый скрипт для TakesMart Backend

Заменяет entrypoint.sh. Делает всё в Python:
  1. Ждёт PostgreSQL
  2. Запускает Alembic миграции
  3. Проверяет Redis
  4. Запускает Uvicorn

Весь вывод буферизован в stdout — виден в логах Timeweb.
"""
import asyncio
import os
import subprocess
import sys
import time

print("=" * 60, flush=True)
print("TakesMart Backend — startup", flush=True)
print("=" * 60, flush=True)

# ── Параметры из env ─────────────────────────────────────────────
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_NAME = os.getenv("DB_NAME", "takesmart")
REDIS_HOST = os.getenv("REDIS_HOST", "")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
PORT = int(os.getenv("PORT", "8000"))

STATIC_DIR = os.path.join(os.getcwd(), "static")

print(f"[CONFIG] DB:    postgresql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}", flush=True)
print(f"[CONFIG] Redis: {REDIS_HOST}:{REDIS_PORT} (password={'yes' if REDIS_PASSWORD else 'no'})", flush=True)
print(f"[CONFIG] Port:  {PORT}", flush=True)
print(f"[CONFIG] STATIC_DIR: {STATIC_DIR} (exists={os.path.isdir(STATIC_DIR)})", flush=True)
print(f"[CONFIG] CWD: {os.getcwd()}", flush=True)
print(f"[CONFIG] ALLOWED_ORIGINS: {os.getenv('ALLOWED_ORIGINS', '—')}", flush=True)


# ── 1. Ждём PostgreSQL ───────────────────────────────────────────
async def wait_for_postgres() -> None:
    import asyncpg
    print(f"\n[POSTGRES] Ожидаем {DB_HOST}:{DB_PORT}...", flush=True)
    for attempt in range(60):
        try:
            conn = await asyncpg.connect(
                host=DB_HOST, port=DB_PORT,
                user=DB_USER, password=DB_PASSWORD,
                database=DB_NAME,
                timeout=5,
            )
            await conn.close()
            print(f"[POSTGRES] ✅ Готов (попытка {attempt + 1})", flush=True)
            return
        except Exception as e:
            if attempt == 0 or attempt % 5 == 0:
                print(f"[POSTGRES] ⏳ Попытка {attempt + 1}: {e}", flush=True)
            await asyncio.sleep(2)
    print("[POSTGRES] ❌ Не удалось подключиться за 60 попыток", flush=True)
    sys.exit(1)

asyncio.run(wait_for_postgres())


# ── 2. Alembic миграции ──────────────────────────────────────────
print("\n[ALEMBIC] Применяем миграции...", flush=True)
result = subprocess.run(
    ["alembic", "upgrade", "head"],
    capture_output=True, text=True
)
if result.stdout:
    print(result.stdout, flush=True)
if result.stderr:
    print(result.stderr, flush=True)
if result.returncode != 0:
    print(f"[ALEMBIC] ❌ Миграции упали (код {result.returncode})", flush=True)
    sys.exit(1)
print("[ALEMBIC] ✅ Миграции применены", flush=True)


# ── 3. Проверяем Redis (не критично) ────────────────────────────
if REDIS_HOST:
    print(f"\n[REDIS] Проверяем {REDIS_HOST}:{REDIS_PORT}...", flush=True)
    try:
        import redis
        client = redis.Redis(
            host=REDIS_HOST, port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            socket_connect_timeout=5,
        )
        client.ping()
        client.close()
        print("[REDIS] ✅ Подключён", flush=True)
    except Exception as e:
        print(f"[REDIS] ⚠️  Недоступен: {e}", flush=True)
        print("[REDIS] Продолжаем без Redis (кеш отключён)", flush=True)
else:
    print("\n[REDIS] ⚠️  REDIS_HOST не задан — пропускаем", flush=True)


# ── 4. Проверяем импорт приложения ──────────────────────────────
print("\n[APP] Проверяем импорт...", flush=True)
try:
    from src.app import create_app  # noqa: F401
    print("[APP] ✅ Импорт OK", flush=True)
except Exception as e:
    import traceback
    print(f"[APP] ❌ Ошибка импорта: {e}", flush=True)
    traceback.print_exc()
    sys.exit(1)


# ── 5. Проверяем доступность порта ──────────────────────────────
import socket
print(f"\n[PORT] Проверяем доступность порта {PORT}...", flush=True)
_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    _sock.bind(("0.0.0.0", PORT))
    _sock.close()
    print(f"[PORT] ✅ Порт {PORT} свободен", flush=True)
except OSError as e:
    _sock.close()
    print(f"[PORT] ❌ Порт {PORT} занят: {e}", flush=True)
    print("[PORT] Ждём 120 сек...", flush=True)
    time.sleep(120)
    sys.exit(1)

# ── 6. Полностью сбрасываем structlog перед uvicorn ──────────────
import logging

plain_handler = logging.StreamHandler(sys.stdout)
plain_handler.setFormatter(logging.Formatter("%(levelname)-8s %(name)s: %(message)s"))

root_logger = logging.getLogger()
root_logger.handlers.clear()
root_logger.addHandler(plain_handler)
root_logger.setLevel(logging.INFO)

for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "starlette", "asyncpg"):
    lg = logging.getLogger(name)
    lg.handlers.clear()
    lg.addHandler(plain_handler)
    lg.setLevel(logging.INFO)
    lg.propagate = False

print("[LOGGING] ✅ Логгеры сброшены на plain-text", flush=True)

# ── 7. Запускаем Uvicorn ─────────────────────────────────────────
print(f"\n[UVICORN] Запускаем на 0.0.0.0:{PORT}", flush=True)
print("=" * 60, flush=True)

try:
    import uvicorn
    uvicorn.run(
        "src.app:app",
        host="0.0.0.0",
        port=PORT,
        log_level="info",
        access_log=False,
        log_config=None,   # отключаем встроенный log_config uvicorn
    )
except SystemExit as e:
    print(f"\n[UVICORN] ❌ SystemExit код={e.code}", flush=True)
    import traceback; traceback.print_exc()
    time.sleep(120)
    sys.exit(e.code if isinstance(e.code, int) else 1)
except Exception as e:
    print(f"\n[UVICORN] ❌ Исключение: {type(e).__name__}: {e}", flush=True)
    import traceback; traceback.print_exc()
    time.sleep(120)
    sys.exit(1)

print("\n[UVICORN] ⚠️  run() завершился без исключения", flush=True)
time.sleep(60)
