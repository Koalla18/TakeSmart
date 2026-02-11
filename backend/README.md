# TakeSmart Backend

Минимальный набор репозиториев и моделей для MVP.

## Запуск API

```bash
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload
```

Swagger будет доступен по адресу `http://localhost:8000/docs`.

## Быстрый запуск smoke test

```bash
python3 -m app.api.smoke_test
```

## Примечание по базе данных

Для async SQLAlchemy используйте URL формата:

```text
postgresql+asyncpg://user:password@host:5432/dbname
```
