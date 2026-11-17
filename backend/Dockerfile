FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY alembic ./alembic
RUN pip install . && useradd --system --uid 10001 --no-create-home kmk
USER kmk
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app_factory --factory --host ${API_HOST:-127.0.0.1} --port ${API_PORT:-8001}"]
