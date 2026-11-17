import logging

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import Settings, get_settings
from app.db import make_engine

log = logging.getLogger("kmk")


def create_app(database_url: str | None = None, settings: Settings | None = None) -> FastAPI:
    # API docs are not served: this is an internal app and /api is public through the tunnel.
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    settings = settings or get_settings()
    engine = make_engine(database_url or settings.database_url)
    app.state.settings = settings
    app.state.engine = engine
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
