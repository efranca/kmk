from fastapi import Request
from sqlalchemy.orm import Session

from app.config import Settings


def get_db(request: Request):
    with Session(request.app.state.engine, expire_on_commit=False) as db:
        yield db


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings
