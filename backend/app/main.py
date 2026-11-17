import logging

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.db import make_engine

log = logging.getLogger("kmk")


def create_app(database_url: str | None = None) -> FastAPI:
    # API docs are not served: this is an internal app and /api is public through the tunnel.
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    engine = make_engine(database_url or get_settings().database_url)
    api = APIRouter(prefix="/api")

    @api.get("/health")
    def health() -> JSONResponse:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            log.exception("health check: database unreachable")
            return JSONResponse({"status": "error"}, status_code=503)
        return JSONResponse({"status": "ok"})

    app.include_router(api)
    return app


def app_factory() -> FastAPI:
    return create_app()
