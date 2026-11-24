from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID
from app.tasks import service
from app.tasks.schemas import CategoryIn

router = APIRouter(prefix="/api/tasks")

# Reading needs a verified session but no CSRF token (the same choice as the schedule).
reader = guard(csrf=False)

CategoryId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/categories")
def list_categories(auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"categories": service.list_categories(db)}


@router.post("/categories", status_code=201)
def create_category(
    body: CategoryIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    category = service.create_category(db, auth[0], body, request_ip(request, settings))
    payload = service.category_payload(category)
    db.commit()
    return {"category": payload}


@router.patch("/categories/{category_id}")
def change_category(
    category_id: CategoryId,
    body: CategoryIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    category = service.update_category(db, auth[0], category_id, body, request_ip(request, settings))
    payload = service.category_payload(category)
    db.commit()
    return {"category": payload}


@router.delete("/categories/{category_id}", status_code=204)
def remove_category(
    category_id: CategoryId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    service.delete_category(db, auth[0], category_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)
