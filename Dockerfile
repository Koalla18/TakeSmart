# ─────────────────────────────────────────────
#  TakeSmart Backend — Timeweb App Platform
# ─────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Create static directories (files uploaded via admin panel at runtime)
RUN mkdir -p /app/static/products /app/static/categories

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["python", "run.py"]
