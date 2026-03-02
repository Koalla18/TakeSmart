#!/bin/sh
# set -e

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

echo "🚀 Запускаем TakesMart API..."
exec uvicorn src.app:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1 \
    --log-level info

