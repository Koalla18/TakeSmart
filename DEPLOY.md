# 🚀 TakeSmart — Деплой на Timeweb App Platform

## Архитектура (2 приложения + 2 БД)

```
Интернет (80/443)
       │
   [Frontend App]    ← Timeweb Dockerfile-приложение
       │  Nginx: SPA + proxy /api/ → backend
       │
   [Backend App]     ← Timeweb Dockerfile-приложение (внутренний IP)
       │  FastAPI + Uvicorn
       │
       ├── [PostgreSQL]  ← Timeweb Managed DB  (192.168.0.x)
       └── [Redis]       ← Timeweb Managed Redis (192.168.0.x)
```

Все сервисы связаны через **внутреннюю сеть Timeweb**.

---

## Подготовка: 2 ветки в Git

Timeweb App Platform читает **Dockerfile из корня репозитория**. Поэтому нужны 2 ветки:

| Ветка | Dockerfile в корне | Что деплоит |
|---|---|---|
| `deploy/backend` | `Dockerfile` (из `Dockerfile.backend`) | FastAPI, порт 8000 |
| `deploy/frontend` | `Dockerfile` (из `Dockerfile.frontend`) | Nginx + SPA, порт 80 |

### Как подготовить ветки

```bash
# ── Backend ветка ──
git checkout maks_dev
git checkout -b deploy/backend
cp Dockerfile.backend Dockerfile
git add Dockerfile
git commit -m "deploy: backend Dockerfile"
git push origin deploy/backend

# ── Frontend ветка ──
git checkout maks_dev
git checkout -b deploy/frontend
cp Dockerfile.frontend Dockerfile
git add Dockerfile
git commit -m "deploy: frontend Dockerfile"
git push origin deploy/frontend
```

---

## Шаг 1 — Создать БД

1. **PostgreSQL**: Timeweb → Базы данных → Создать → PostgreSQL
2. **Redis**: Timeweb → Базы данных → Создать → Redis
3. Запишите IP-адреса, логины, пароли

---

## Шаг 2 — Создать Backend-приложение

1. **Приложения → Создать → Dockerfile**
2. Подключите Git-репозиторий
3. **Ветка:** `deploy/backend`
4. **Приватная сеть:** та же, что у БД
5. **Переменные окружения:**

```
DB_HOST=192.168.0.X            ← IP PostgreSQL
DB_PORT=5432
DB_USER=gen_user
DB_PASSWORD=пароль-из-панели
DB_NAME=default_db
REDIS_HOST=192.168.0.X         ← IP Redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=пароль-redis
SECRET_KEY=...                  ← openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ваш-пароль
ALLOWED_ORIGINS=https://ваш-домен.ru
TELEGRAM_BOT_TOKEN=             ← опционально
TELEGRAM_CHAT_ID=               ← опционально
```

6. Запустите деплой, дождитесь.
7. **Запишите внутренний IP** backend-приложения.

---

## Шаг 3 — Создать Frontend-приложение

1. **Приложения → Создать → Dockerfile**
2. Подключите тот же Git-репозиторий
3. **Ветка:** `deploy/frontend`
4. **Приватная сеть:** та же
5. **Переменные окружения:**

```
BACKEND_HOST=192.168.0.X       ← внутренний IP backend-а из шага 2
```

6. Запустите деплой.
7. Привяжите **домен** к этому приложению.

---

## Готово!

- Сайт: `https://ваш-домен.ru`
- Админка: `https://ваш-домен.ru/admin`

---

## Обновление кода

```bash
# Обновить обе deploy-ветки из основной
git checkout deploy/backend && git merge maks_dev && git push
git checkout deploy/frontend && git merge maks_dev && git push
```

Timeweb автоматически пересоберёт приложения (если включён автодеплой).

---

## Переменные окружения

### Backend
| Переменная | Описание |
|---|---|
| `DB_HOST` | IP PostgreSQL (внутренняя сеть) |
| `DB_PORT` | `5432` |
| `DB_USER` | Пользователь БД |
| `DB_PASSWORD` | Пароль БД (спецсимволы OK) |
| `DB_NAME` | Имя БД (`default_db`) |
| `REDIS_HOST` | IP Redis (внутренняя сеть) |
| `REDIS_PASSWORD` | Пароль Redis |
| `SECRET_KEY` | Секрет JWT |
| `ADMIN_USERNAME` | Логин админки |
| `ADMIN_PASSWORD` | Пароль админки |
| `ALLOWED_ORIGINS` | CORS (`https://домен.ru`) |

### Frontend
| Переменная | Описание |
|---|---|
| `BACKEND_HOST` | Внутренний IP backend-а |

---

## Файлы деплоя

```
Take smart/
├── Dockerfile.backend        ← корневой Dockerfile для backend-ветки
├── Dockerfile.frontend       ← корневой Dockerfile для frontend-ветки
├── backend/
│   ├── Dockerfile            # (используется для локальной разработки)
│   ├── entrypoint.sh         # Ожидание БД + миграции + запуск
│   └── ...
├── frontend/
│   ├── Dockerfile            # (используется для локальной разработки)
│   ├── nginx.conf            # Шаблон с ${BACKEND_HOST}
│   └── ...
└── docker-compose.local.yml  # Локальная разработка (полный стек)
```

---

## Локальная разработка

```bash
docker compose -f docker-compose.local.yml up -d --build
# Сайт на http://localhost:3000
```
