# ─────────────────────────────────────────────
#  Stage 1: builder — устанавливаем зависимости
# ─────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/static/products /app/static/categories

EXPOSE 8000

ENTRYPOINT ["sh", "/app/entrypoint.sh"]
