"""Tasks and their categories. Authority rules live in app/auth/policy.py."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.models import TaskCategory, User
from app.tasks.schemas import CategoryIn

# ---- categories -------------------------------------------------------------------------------------------------


def category_payload(c: TaskCategory) -> dict:
    return {"id": c.id, "name": c.name, "icon": c.icon}


def list_categories(db: Session) -> list[dict]:
    rows = db.scalars(select(TaskCategory).order_by(func.lower(TaskCategory.name), TaskCategory.id)).all()
    return [category_payload(c) for c in rows]


def get_category(db: Session, category_id: int) -> TaskCategory:
    category = db.get(TaskCategory, category_id)
    if category is None:
        raise ApiError(404, "category_not_found")
    return category


def _name_taken(db: Session, name: str, except_id: int | None = None) -> bool:
    query = select(TaskCategory.id).where(func.lower(TaskCategory.name) == name.lower())
    if except_id is not None:
        query = query.where(TaskCategory.id != except_id)
    return db.scalar(query) is not None


def create_category(db: Session, actor: User, data: CategoryIn, ip: str) -> TaskCategory:
    if _name_taken(db, data.name):
        raise ApiError(409, "category_exists")
    category = TaskCategory(name=data.name, icon=data.icon, created_by=actor.id)
    db.add(category)
    try:
        db.flush()
    except IntegrityError:  # two people adding the same name at once: the unique index decides
        db.rollback()
        raise ApiError(409, "category_exists")
    audit.log(db, "task_category_created", actor_user_id=actor.id, ip=ip, details={"category_id": category.id})
    return category


def update_category(db: Session, actor: User, category_id: int, data: CategoryIn, ip: str) -> TaskCategory:
    if not policy.can_manage_task_categories(actor):
        raise ApiError(403, "forbidden")
    category = get_category(db, category_id)
    if _name_taken(db, data.name, except_id=category.id):
        raise ApiError(409, "category_exists")
    fields = [f for f, new in (("name", data.name), ("icon", data.icon)) if getattr(category, f) != new]
    category.name, category.icon = data.name, data.icon
    category.updated_at = func.now()
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "category_exists")
    if fields:
        audit.log(db, "task_category_updated", actor_user_id=actor.id, ip=ip, details={"category_id": category.id, "fields": fields})
    return category


def delete_category(db: Session, actor: User, category_id: int, ip: str) -> None:
    if not policy.can_manage_task_categories(actor):
        raise ApiError(403, "forbidden")
    category = get_category(db, category_id)
    db.delete(category)  # its tasks stay, without a category (ON DELETE SET NULL)
    audit.log(db, "task_category_deleted", actor_user_id=actor.id, ip=ip, details={"category_id": category_id})
