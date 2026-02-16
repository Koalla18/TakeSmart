FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt ./requirements.txt
COPY requirements-test.txt ./requirements-test.txt
RUN pip install --no-cache-dir -r requirements.txt -r requirements-test.txt

COPY app ./app/
COPY tests ./tests/
COPY pytest.ini ./pytest.ini

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
