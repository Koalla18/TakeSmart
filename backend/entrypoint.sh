#!/bin/sh
set -e

echo "⏳ Ожидаем PostgreSQL..."
until python -c "
import asyncio, asyncpg, os
async def check():
    await asyncpg.connect(
        host=os.getenv('DB_HOST','db'),
        port=int(os.getenv('DB_PORT',5432)),
        user=os.getenv('DB_USER','postgres'),
        password=os.getenv('DB_PASSWORD','postgres'),
        database=os.getenv('DB_NAME','takesmart'),
    )
asyncio.run(check())
" 2>/dev/null; do
  echo "   PostgreSQL недоступен — ждём 2 сек..."
  sleep 2
done
echo "✅ PostgreSQL готов"

echo "� Синхронизируем статические файлы..."
if [ -d "/app/static_seed" ]; then
  cp -rn /app/static_seed/. /app/static/ 2>/dev/null || true
  echo "✅ Статика скопирована"
fi

echo "�🔄 Применяем миграции Alembic..."
alembic upgrade head
echo "✅ Миграции применены"

echo "� Проверяем импорт приложения..."
python -c "
from src.app import create_app
print('✅ Импорт OK')
" 2>&1

echo "🔍 Проверяем Redis URL..."
python -c "
from src.app.core.config import settings
print('REDIS_URL:', settings.redis_url)
print('DATABASE_URL:', settings.database_url[:50] + '...')
print('ALLOWED_ORIGINS:', settings.ALLOWED_ORIGINS)
" 2>&1

echo "🚀 Запускаем TakesMart API..."
python -u -c "
import uvicorn, traceback, sys
try:
    uvicorn.run('src.app:app', host='0.0.0.0', port=8000, log_level='debug')
except Exception as e:
    print(f'❌ CRASH: {e}', flush=True)
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
print('⚠️ Uvicorn завершился', flush=True)
" 2>&1
echo "❌ Uvicorn упал с кодом $?"
sleep 300

