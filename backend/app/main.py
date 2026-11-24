import logging

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import Settings, get_settings
from app.auth.account import router as account_router
from app.auth.admin import router as admin_router
from app.auth.avatars import router as avatars_router
from app.auth.devices import router as devices_router
from app.auth.errors import ApiError
from app.auth.mfa_routes import router as mfa_router
from app.auth.routes import router as auth_router
from app.db import make_engine
from app.documents.routes import router as documents_router
from app.preferences import router as preferences_router
from app.schedule.routes import router as schedule_router
from app.tasks.routes import router as tasks_router
from app.version import router as version_router

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
    app.include_router(auth_router)
    app.include_router(account_router)
    app.include_router(admin_router)
    app.include_router(devices_router)
    app.include_router(avatars_router)
    app.include_router(mfa_router)
    app.include_router(schedule_router)
    app.include_router(tasks_router)
    app.include_router(preferences_router)
    app.include_router(version_router)
    app.include_router(documents_router)

    @app.exception_handler(ApiError)
    async def api_error(request, exc: ApiError):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.middleware("http")
    async def origin_check(request, call_next):
        # CSRF layer: every mutating API request must come from an allowed origin.
        path = request.url.path
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api"):
            if request.headers.get("origin") not in settings.allowed_origins:
                response = JSONResponse({"error": "forbidden"}, status_code=403)
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)
        if path.startswith(("/api/auth", "/api/admin", "/api/schedule", "/api/tasks", "/api/documents", "/api/document-categories")):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app


def app_factory() -> FastAPI:
    return create_app()
