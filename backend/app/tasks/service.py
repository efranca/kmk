"""Tasks and their categories. Authority rules live in app/auth/policy.py."""

from sqlalchemy import delete, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.models import Task, TaskCategory, TaskPerson, User
from app.schedule.service import _checked_people, display_name
from app.tasks.schemas import CategoryIn, TaskIn

LIST_LIMIT = 1000

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


# ---- tasks ------------------------------------------------------------------------------------------------------


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def task_payloads(db: Session, tasks: list[Task]) -> list[dict]:
    """Payloads for several tasks with two queries for people and one for the names (no per-task queries)."""
    ids = [t.id for t in tasks]
    people: dict[int, list[int]] = {i: [] for i in ids}
    if ids:
        for task_id, user_id in db.execute(select(TaskPerson.task_id, TaskPerson.user_id).where(TaskPerson.task_id.in_(ids))):
            people[task_id].append(user_id)
    user_ids = {t.created_by for t in tasks} | {t.updated_by for t in tasks}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}

    def ref(user_id: int) -> dict:
        return {"id": user_id, "name": display_name(users[user_id])}

    return [
        {
            "id": t.id, "title": t.title, "description": t.description, "icon": t.icon, "category_id": t.category_id,
            "people": sorted(people[t.id]), "status": t.status, "due_date": _iso(t.due_date),
            "completed_at": _iso(t.completed_at), "show_on_dashboard": t.show_on_dashboard,
            "created_by": ref(t.created_by), "updated_by": ref(t.updated_by),
            "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at),
        }
        for t in tasks
    ]


def task_payload(db: Session, task: Task) -> dict:
    return task_payloads(db, [task])[0]


def list_tasks(db: Session, status: str, person: int | None, whole_team: bool) -> list[dict]:
    query = select(Task)
    if status != "all":
        query = query.where(Task.status == status)
    if person is not None:
        query = query.where(exists().where(TaskPerson.task_id == Task.id, TaskPerson.user_id == person))
    elif whole_team:
        query = query.where(~exists().where(TaskPerson.task_id == Task.id))
    query = query.order_by(Task.status == "completed", Task.due_date.asc().nulls_last(), Task.created_at.desc(), Task.id.desc()).limit(LIST_LIMIT)
    return task_payloads(db, list(db.scalars(query)))


def get_task(db: Session, task_id: int, *, lock: bool = False) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id).with_for_update()) if lock else db.get(Task, task_id)
    if task is None:
        raise ApiError(404, "task_not_found")
    return task


def _people_of(db: Session, task_id: int) -> frozenset[int]:
    return frozenset(db.scalars(select(TaskPerson.user_id).where(TaskPerson.task_id == task_id)))


def _check_category(db: Session, category_id: int | None) -> None:
    if category_id is not None and db.get(TaskCategory, category_id) is None:
        raise ApiError(422, "category_not_found")


def _write(task: Task, data: TaskIn) -> None:
    task.title, task.description, task.icon = data.title, data.description, data.icon
    task.category_id, task.due_date, task.show_on_dashboard = data.category_id, data.due_date, data.show_on_dashboard


def _replace_people(db: Session, task_id: int, people: set[int]) -> None:
    db.execute(delete(TaskPerson).where(TaskPerson.task_id == task_id))
    db.add_all([TaskPerson(task_id=task_id, user_id=p) for p in sorted(people)])


def create_task(db: Session, actor: User, data: TaskIn, ip: str) -> Task:
    _check_category(db, data.category_id)
    people = _checked_people(db, data.people)
    task = Task(created_by=actor.id, updated_by=actor.id)
    _write(task, data)
    db.add(task)
    db.flush()
    _replace_people(db, task.id, people)
    audit.log(db, "task_created", actor_user_id=actor.id, ip=ip, details={"task_id": task.id})
    db.flush()
    return task


def update_task(db: Session, actor: User, task_id: int, data: TaskIn, ip: str) -> Task:
    task = get_task(db, task_id, lock=True)
    old_people = _people_of(db, task.id)
    policy.check_task(actor, task.created_by, old_people)
    _check_category(db, data.category_id)
    people = _checked_people(db, data.people, keep=old_people)
    fields = [
        name
        for name, new in (
            ("title", data.title), ("description", data.description), ("icon", data.icon), ("category_id", data.category_id),
            ("due_date", data.due_date), ("show_on_dashboard", data.show_on_dashboard),
        )
        if getattr(task, name) != new
    ]
    if people != old_people:
        fields.append("people")
    _write(task, data)
    task.updated_by, task.updated_at = actor.id, func.now()
    if people != old_people:
        _replace_people(db, task.id, people)
    if fields:
        audit.log(db, "task_updated", actor_user_id=actor.id, ip=ip, details={"task_id": task.id, "fields": fields})
    db.flush()
    db.refresh(task)
    return task


def set_status(db: Session, actor: User, task_id: int, status: str, ip: str) -> Task:
    """Complete or reopen. Idempotent: asking for the status a task already has changes nothing (the row is locked, so
    two people ticking at once cannot overwrite who finished it or when)."""
    task = get_task(db, task_id, lock=True)
    policy.check_task_status(actor, task.created_by, _people_of(db, task.id))
    if task.status == status:
        return task
    task.status = status
    task.completed_at = func.now() if status == "completed" else None
    task.completed_by = actor.id if status == "completed" else None
    task.updated_by, task.updated_at = actor.id, func.now()
    audit.log(db, "task_completed" if status == "completed" else "task_reopened", actor_user_id=actor.id, ip=ip, details={"task_id": task.id})
    db.flush()
    db.refresh(task)
    return task


def delete_task(db: Session, actor: User, task_id: int, ip: str) -> None:
    task = get_task(db, task_id, lock=True)
    policy.check_task(actor, task.created_by, _people_of(db, task.id))
    db.delete(task)
    audit.log(db, "task_deleted", actor_user_id=actor.id, ip=ip, details={"task_id": task_id})


def clear_completed(db: Session, actor: User, ip: str) -> int:
    """Deletes the completed tasks the actor may delete; the rest stay."""
    tasks = list(db.scalars(select(Task).where(Task.status == "completed").with_for_update()))
    people = {t.id: _people_of(db, t.id) for t in tasks}
    doomed = [t for t in tasks if policy.can_change_task(actor, t.created_by, people[t.id])]
    for task in doomed:
        db.delete(task)
    if doomed:
        audit.log(db, "tasks_cleared", actor_user_id=actor.id, ip=ip, details={"count": len(doomed)})
    return len(doomed)
