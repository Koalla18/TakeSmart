# ─────────────────────────────────────────────
#  TakeSmart Backend — Timeweb App Platform
# ─────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Seed static files
COPY backend/static /app/static_seed
RUN mkdir -p /app/static/products /app/static/categories

EXPOSE 8000

ENTRYPOINT ["sh", "/app/entrypoint.sh"]
