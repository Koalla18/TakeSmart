# ─────────────────────────────────────────────
#  TakeSmart Backend — Timeweb App Platform
# ─────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Create static directories (files uploaded via admin panel at runtime)
RUN mkdir -p /app/static/products /app/static/categories /app/static_seed

EXPOSE 8000

ENV PORT=8000

ENTRYPOINT ["sh", "/app/entrypoint.sh"]
