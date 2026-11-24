# ASTRION API (FastAPI + intelligence engine). Runs as an unprivileged user; applies migrations on start.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
RUN groupadd --system astrion && useradd --system --gid astrion --home /app astrion

COPY pyproject.toml requirements.txt ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN pip install ".[s3]" && mkdir -p /data/storage && chown -R astrion:astrion /data /app

USER astrion
ENV ASTRION_STORAGE_LOCAL_ROOT=/data/storage \
    ASTRION_LOG_JSON=true
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"

# One worker per container: the investigation runner is in-process (scale out with more containers
# only after moving runs to a shared queue; see docs/DEPLOYMENT.md).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
