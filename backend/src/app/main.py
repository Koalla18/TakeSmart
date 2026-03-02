"""
TakesMart API — точка входа для запуска через uvicorn.

Приложение FastAPI создаётся в src/app/__init__.py (create_app).
Роутеры, middleware и lifespan подключены там же.

Запуск локально:
    python -m src.app.main

Запуск через uvicorn напрямую:
    uvicorn src.app:app --host 0.0.0.0 --port 8000 --reload
"""
import uvicorn

# Импортируем app явно — IDE видит все роутеры и middleware
from src.app import app  # noqa: F401

if __name__ == "__main__":
    uvicorn.run(
        "src.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
