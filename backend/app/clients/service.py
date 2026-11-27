"""Clients: the people the company works for. Tasks, Agenda items, documents and quotes can point to one."""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.clients.schemas import ClientIn
from app.models import Client, Document, Event, Quote, Task, User

FIELDS = ("name", "kind", "contact_name", "email", "phone", "address", "city", "notes")
LIST_LIMIT = 500
LINKED_LIMIT = 200


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


def client_payload(c: Client) -> dict:
    return {**{f: getattr(c, f) for f in FIELDS}, "id": c.id, "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at)}


def get_client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if client is None:
        raise ApiError(404, "not_found")
    return client


def check_client(db: Session, client_id: int | None) -> None:
    """For a task, event, document or quote that points to a client: the client must exist."""
    if client_id is not None and db.get(Client, client_id) is None:
        raise ApiError(422, "client_not_found")


def list_clients(db: Session, actor: User, q: str | None) -> list[dict]:
    policy.check_clients(actor)
    query = select(Client)
    needle = (q or "").strip()
    if needle:
        like = f"%{needle.replace('%', '').replace('_', '')}%"
        query = query.where(or_(*(getattr(Client, f).ilike(like) for f in ("name", "contact_name", "email", "phone", "address", "city"))))
    return [client_payload(c) for c in db.scalars(query.order_by(func.lower(Client.name), Client.id).limit(LIST_LIMIT))]


def detail_payload(db: Session, actor: User, client: Client) -> dict:
    policy.check_clients(actor)
    tasks = db.execute(select(Task.id, Task.title, Task.status, Task.due_date).where(Task.client_id == client.id).order_by(Task.due_date.desc().nulls_last(), Task.id.desc()).limit(LINKED_LIMIT)).all()
    events = db.execute(select(Event.id, Event.title, Event.start_date, Event.start_time).where(Event.client_id == client.id).order_by(Event.start_date.desc(), Event.id.desc()).limit(LINKED_LIMIT)).all()
    documents = db.execute(select(Document.id, Document.title, Document.content_type).where(Document.client_id == client.id, Document.size_bytes.is_not(None)).order_by(Document.created_at.desc()).limit(LINKED_LIMIT)).all()
    quotes = db.execute(select(Quote.id, Quote.status, Quote.kind, Quote.submitted_at).where(Quote.client_id == client.id).order_by(Quote.id.desc()).limit(LINKED_LIMIT)).all()
    return {
        **client_payload(client),
        "tasks": [{"id": i, "title": t, "status": s, "due_date": _iso(d)} for i, t, s, d in tasks],
        "events": [{"id": i, "title": t, "start_date": _iso(d), "start_time": s.strftime("%H:%M") if s else None} for i, t, d, s in events],
        "documents": [{"id": i, "title": t, "content_type": ct} for i, t, ct in documents],
        "quotes": [{"id": i, "reference": f"D-{i:04d}", "status": s, "kind": k, "submitted_at": _iso(at)} for i, s, k, at in quotes],
    }


def create_client(db: Session, actor: User, data: ClientIn, ip: str) -> Client:
    policy.check_clients(actor)
    client = Client(created_by=actor.id, updated_by=actor.id, **{f: getattr(data, f) for f in FIELDS})
    db.add(client)
    db.flush()
    if data.quote_id is not None:
        quote = db.get(Quote, data.quote_id)
        if quote is None or quote.status == "draft":
            raise ApiError(422, "quote_not_found")
        quote.client_id = client.id
    audit.log(db, "client_created", actor_user_id=actor.id, ip=ip, details={"client_id": client.id, **({"quote_id": data.quote_id} if data.quote_id else {})})
    return client


def update_client(db: Session, actor: User, client_id: int, data: ClientIn, ip: str) -> Client:
    policy.check_clients(actor)
    client = get_client(db, client_id)
    changed = [f for f in FIELDS if getattr(client, f) != getattr(data, f)]
    for f in changed:
        setattr(client, f, getattr(data, f))
    if changed:
        client.updated_by, client.updated_at = actor.id, func.now()
        audit.log(db, "client_updated", actor_user_id=actor.id, ip=ip, details={"client_id": client.id, "fields": changed})
    return client


def delete_client(db: Session, actor: User, client_id: int, ip: str) -> None:
    policy.check_clients(actor)
    client = get_client(db, client_id)
    db.delete(client)  # what pointed to it is unlinked (ON DELETE SET NULL), nothing else goes
    audit.log(db, "client_deleted", actor_user_id=actor.id, ip=ip, details={"client_id": client_id})
