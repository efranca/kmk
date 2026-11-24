from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth.errors import ApiError
from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID
from app.tasks import service
from app.tasks.schemas import CategoryIn, TaskIn

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


TaskId = Annotated[int, Path(ge=1, le=MAX_ID)]


def _person(raw: str | None) -> tuple[int | None, bool]:
    """The `person` filter: a user id, or "none" for the tasks for the whole team."""
    if raw is None or not raw.strip():
        return None, False
    if raw.strip() == "none":
        return None, True
    try:
        person = int(raw)
        if not 1 <= person <= MAX_ID:
            raise ValueError
        return person, False
    except ValueError:
        raise ApiError(422, "invalid_people")


@router.get("")
def list_tasks(
    status: Literal["pending", "completed", "all"] = "all",
    person: str | None = Query(default=None, max_length=30),
    auth: tuple[User, UserSession] = Depends(reader),
    db: Session = Depends(get_db),
):
    who, whole_team = _person(person)
    return {"tasks": service.list_tasks(db, status, who, whole_team)}


@router.post("", status_code=201)
def create_task(
    body: TaskIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    task = service.create_task(db, auth[0], body, request_ip(request, settings))
    payload = service.task_payload(db, task)
    db.commit()
    return {"task": payload}


@router.delete("/completed")
def clear_completed(
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    deleted = service.clear_completed(db, auth[0], request_ip(request, settings))
    db.commit()
    return {"deleted": deleted}


@router.get("/{task_id}")
def read_task(task_id: TaskId, auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"task": service.task_payload(db, service.get_task(db, task_id))}


@router.patch("/{task_id}")
def change_task(
    task_id: TaskId,
    body: TaskIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    task = service.update_task(db, auth[0], task_id, body, request_ip(request, settings))
    payload = service.task_payload(db, task)
    db.commit()
    return {"task": payload}


def _status_route(path: str, status: str):
    def handler(
        task_id: TaskId,
        request: Request,
        auth: tuple[User, UserSession] = Depends(guard()),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings_dep),
    ):
        task = service.set_status(db, auth[0], task_id, status, request_ip(request, settings))
        payload = service.task_payload(db, task)
        db.commit()
        return {"task": payload}

    handler.__name__ = f"task_{status}"
    router.post(path)(handler)


_status_route("/{task_id}/complete", "completed")
_status_route("/{task_id}/reopen", "pending")


@router.delete("/{task_id}", status_code=204)
def remove_task(
    task_id: TaskId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    service.delete_task(db, auth[0], task_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)
