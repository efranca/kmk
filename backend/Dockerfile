FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY alembic ./alembic
RUN pip install . && useradd --system --uid 10001 --no-create-home kmk
# Build info for GET /api/version (passed by deploy/docker-compose.yml; after pip so the install layer stays cached).
ARG APP_COMMIT=""
ARG APP_COMMIT_COUNT=""
ARG APP_BUILT_AT=""
ENV APP_COMMIT=$APP_COMMIT APP_COMMIT_COUNT=$APP_COMMIT_COUNT APP_BUILT_AT=$APP_BUILT_AT
USER kmk
# Migrations are NOT run here: the `migrate` service in deploy/docker-compose.yml does that with the owner credentials.
CMD ["sh", "-c", "exec uvicorn app.main:app_factory --factory --host ${API_HOST:-127.0.0.1} --port ${API_PORT:-8001}"]
