FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt ./requirements.txt
COPY requirements-test.txt ./requirements-test.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app/
COPY alembic ./alembic/
COPY alembic.ini ./alembic.ini

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
