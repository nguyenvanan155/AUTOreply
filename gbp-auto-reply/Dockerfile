FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# ── Web server ───────────────────────────────────────────────
FROM base AS web
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

# ── Celery worker ────────────────────────────────────────────
FROM base AS worker
CMD ["celery", "-A", "app.celery_app:celery", "worker", "--loglevel=info", "--concurrency=4"]

# ── Celery beat scheduler ────────────────────────────────────
FROM base AS beat
CMD ["celery", "-A", "app.celery_app:celery", "beat", "--loglevel=info"]
