#!/bin/sh
# NO set -e here — we need to see errors without dying immediately

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

echo "☁️ Файловое хранилище: S3"

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
PORT="${PORT:-8000}"
echo "📡 Порт: $PORT"
uvicorn src.app:app --host 0.0.0.0 --port "$PORT" --log-level debug 2>&1
EXIT_CODE=$?
echo "❌ Uvicorn завершился с кодом: $EXIT_CODE"
sleep 300

