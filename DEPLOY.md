# 🚀 TakeSmart — Деплой на сервер

## Архитектура

```
Интернет (порт 80/443)
       │
    [Nginx]  ← frontend контейнер (serve SPA + reverse proxy)
       ├── /           → React SPA (статика)
       ├── /api/*      → backend:8000 (FastAPI)
       └── /uploads/*  → backend:8000 (статические файлы)
              │
          [Backend]    ← FastAPI + Uvicorn (внутренний)
              ├── [PostgreSQL]  (внутренний)
              └── [Redis]       (внутренний)
```

---

## Требования к серверу

- Ubuntu 22.04 / Debian 12 / любой Linux
- 1 ГБ RAM минимум (2 ГБ рекомендуется)
- Docker 24+
- Docker Compose v2

---

## Шаг 1 — Установить Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## Шаг 2 — Загрузить код на сервер

**Вариант А — через Git:**
```bash
git clone https://github.com/ВАШ-ЮЗЕ/take-smart.git /opt/takesmart
cd /opt/takesmart
```

**Вариант Б — через rsync с локального Mac:**
```bash
rsync -avz --exclude=node_modules --exclude=.venv --exclude='*.db' \
  "/Users/maksimkluev/Desktop/Take smart/" \
  user@YOUR_SERVER_IP:/opt/takesmart/
```

---

## Шаг 3 — Настроить .env

```bash
cd /opt/takesmart
cp .env.prod.example .env
nano .env   # или: vim .env
```

Обязательно измените:
```dotenv
POSTGRES_PASSWORD=ВашСильныйПароль123!
JWT_SECRET=очень-длинная-случайная-строка-минимум-32-символа
ADMIN_PASSWORD=ВашПарольАдмина
ALLOWED_ORIGINS=https://ваш-домен.ru,https://www.ваш-домен.ru

# Для работы фото — оставьте пустым (nginx обработает)
VITE_API_BASE_URL=
```

---

## Шаг 4 — Задеплоить

```bash
chmod +x deploy.sh
./deploy.sh
```

После деплоя сайт будет доступен на `http://ВАШ_IP`

---

## Шаг 5 — HTTPS через Certbot (опционально, но рекомендуется)

Если у вас есть домен и он уже указывает на сервер:

```bash
# Установить certbot
sudo apt install -y certbot

# Получить сертификат (остановить nginx на время)
docker compose stop frontend
sudo certbot certonly --standalone -d ваш-домен.ru -d www.ваш-домен.ru
docker compose start frontend
```

Затем обновить `frontend/nginx.conf` для HTTPS (раскомментировать секцию ниже) и пересобрать:

```nginx
# Добавить в server block для HTTPS:
listen 443 ssl;
ssl_certificate     /etc/letsencrypt/live/ваш-домен.ru/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/ваш-домен.ru/privkey.pem;
```

И смонтировать сертификаты в docker-compose.yml:
```yaml
frontend:
  volumes:
    - /etc/letsencrypt:/etc/letsencrypt:ro
```

---

## Полезные команды

```bash
# Просмотр статуса
docker compose ps

# Логи в реальном времени
docker compose logs -f

# Только логи backend
docker compose logs -f backend

# Перезапуск после изменений
./deploy.sh

# Принудительная пересборка образов
./deploy.sh --build

# Остановить всё
docker compose down

# Удалить данные БД (осторожно!)
docker compose down -v
```

---

## Переменные окружения

| Переменная | Описание | Пример |
|---|---|---|
| `POSTGRES_PASSWORD` | Пароль БД | `StrongPass123!` |
| `JWT_SECRET` | Секрет для JWT токенов | Случайная строка 32+ символов |
| `ADMIN_USERNAME` | Логин в админке | `admin` |
| `ADMIN_PASSWORD` | Пароль в админке | `MyAdminPass!` |
| `ALLOWED_ORIGINS` | Разрешённые CORS-домены | `https://takesmart.ru` |
| `VITE_API_BASE_URL` | URL API для frontend | Пусто для prod (nginx routing) |
| `TELEGRAM_BOT_TOKEN` | Бот для уведомлений | Опционально |
| `TELEGRAM_CHAT_ID` | ID чата Telegram | Опционально |

---

## Структура файлов деплоя

```
Take smart/
├── docker-compose.yml        # Продакшн конфигурация
├── docker-compose.dev.yml    # Переопределения для разработки
├── .env                      # Ваши секреты (НЕ коммитить в git!)
├── .env.prod.example         # Шаблон для продакшна
├── .env.example              # Шаблон для разработки
├── deploy.sh                 # Скрипт деплоя
├── backend/
│   └── Dockerfile            # Python + uvicorn (с healthcheck)
└── frontend/
    ├── Dockerfile            # Multi-stage: build → nginx (prod)
    ├── Dockerfile.dev        # Vite dev server (только для разработки)
    └── nginx.conf            # Nginx: SPA + reverse proxy
```

---

## Локальная разработка через Docker

```bash
# Запустить все сервисы с dev-настройками
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Или: запускать только backend инфру через Docker,
# а frontend локально:
docker compose up db redis backend
# В другом окне:
cd frontend && npm run dev
```
