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


# ── 5. Запускаем Uvicorn ─────────────────────────────────────────
print(f"\n[UVICORN] Запускаем на 0.0.0.0:{PORT}", flush=True)
print("=" * 60, flush=True)

proc = subprocess.Popen(
    [
        sys.executable, "-m", "uvicorn",
        "src.app:app",
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--log-level", "info",
        "--no-server-header",
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)

# Печатаем каждую строчку сразу как она появляется
for line in proc.stdout:
    print(line, end="", flush=True)

proc.wait()
retcode = proc.returncode

print(f"\n[UVICORN] ❌ Процесс завершился с кодом {retcode}", flush=True)
print("[UVICORN] Ждём 120 секунд чтобы успеть прочитать логи...", flush=True)
time.sleep(120)
sys.exit(retcode)
