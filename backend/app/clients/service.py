"""Clients: the people the company works for. Tasks, Agenda items, documents and quotes can point to one."""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.clients.schemas import ClientIn, PropertyIn
from app.models import Client, Document, Event, EventPerson, Property, Quote, Task, User

FIELDS = ("name", "kinds", "contact_name", "email", "phone", "address", "city", "notes")
LIST_LIMIT = 500
LINKED_LIMIT = 200


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


def client_payload(c: Client, actor: User | None = None) -> dict:
    """Staff get the contact details without the internal notes."""
    out = {**{f: getattr(c, f) for f in FIELDS}, "id": c.id, "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at)}
    if actor is not None and not policy.can_manage_clients(actor):
        del out["notes"]
    return out


def scheduled_for(user_id: int):
    """The clients with an Agenda item that lists this person (an item for everyone, with no people listed, opens nothing)."""
    return select(Event.client_id).join(EventPerson, EventPerson.event_id == Event.id).where(Event.client_id.is_not(None), EventPerson.user_id == user_id)


def _seen_by(actor: User):
    """Where-clauses for the clients this person may read: all for administrators, else the ones they are scheduled for."""
    return [] if policy.can_manage_clients(actor) else [Client.id.in_(scheduled_for(actor.id))]


def get_client(db: Session, actor: User, client_id: int) -> Client:
    client = db.scalars(select(Client).where(Client.id == client_id, *_seen_by(actor))).first()
    if client is None:
        raise ApiError(404, "not_found")  # the same for "hidden" and "missing"
    return client


def check_client(db: Session, actor: User, client_id: int | None, current: int | None = None) -> None:
    """For a task, event, document or quote that points to a client: the client must exist, and be one this person may see
    (a link that is already there, `current`, may stay as it is)."""
    if client_id is not None and client_id != current and db.scalars(select(Client.id).where(Client.id == client_id, *_seen_by(actor))).first() is None:
        raise ApiError(422, "client_not_found")


def list_clients(db: Session, actor: User, q: str | None) -> list[dict]:
    query = select(Client).where(*_seen_by(actor))
    needle = (q or "").strip()
    if needle:
        like = f"%{needle.replace('%', '').replace('_', '')}%"
        query = query.where(or_(*(getattr(Client, f).ilike(like) for f in ("name", "contact_name", "email", "phone", "address", "city"))))
    return [client_payload(c, actor) for c in db.scalars(query.order_by(func.lower(Client.name), Client.id).limit(LIST_LIMIT))]


PROPERTY_FIELDS = ("name", "kind", "address", "city", "listing_url", "access_notes")


def property_payload(p: Property) -> dict:
    return {**{f: getattr(p, f) for f in PROPERTY_FIELDS}, "id": p.id, "client_id": p.client_id}


def _properties_of(db: Session, client_id: int) -> list[dict]:
    return [property_payload(p) for p in db.scalars(select(Property).where(Property.client_id == client_id).order_by(Property.id))]


def check_property(db: Session, actor: User, property_id: int | None, client_id: int | None) -> None:
    """An Agenda item's property must belong to the item's own client (so the client must be set too)."""
    if property_id is None:
        return
    owner = db.scalar(select(Property.client_id).where(Property.id == property_id))
    if owner is None or client_id is None or owner != client_id:
        raise ApiError(422, "property_not_found")


def add_property(db: Session, actor: User, client_id: int, data: PropertyIn, ip: str) -> Property:
    policy.check_clients(actor)
    client = get_client(db, actor, client_id)
    prop = Property(client_id=client.id, created_by=actor.id, updated_by=actor.id, **{f: getattr(data, f) for f in PROPERTY_FIELDS})
    db.add(prop)
    db.flush()
    audit.log(db, "property_created", actor_user_id=actor.id, ip=ip, details={"client_id": client.id, "property_id": prop.id})
    return prop


def _get_property(db: Session, property_id: int) -> Property:
    prop = db.get(Property, property_id)
    if prop is None:
        raise ApiError(404, "not_found")
    return prop


def update_property(db: Session, actor: User, property_id: int, data: PropertyIn, ip: str) -> Property:
    policy.check_clients(actor)
    prop = _get_property(db, property_id)
    changed = [f for f in PROPERTY_FIELDS if getattr(prop, f) != getattr(data, f)]
    for f in changed:
        setattr(prop, f, getattr(data, f))
    if changed:
        prop.updated_by, prop.updated_at = actor.id, func.now()
        audit.log(db, "property_updated", actor_user_id=actor.id, ip=ip, details={"property_id": prop.id, "fields": changed})
    return prop


def delete_property(db: Session, actor: User, property_id: int, ip: str) -> None:
    policy.check_clients(actor)
    prop = _get_property(db, property_id)
    db.delete(prop)  # Agenda items that pointed to it are unlinked (ON DELETE SET NULL)
    audit.log(db, "property_deleted", actor_user_id=actor.id, ip=ip, details={"property_id": property_id})


def detail_payload(db: Session, actor: User, client: Client) -> dict:
    if not policy.can_manage_clients(actor):  # Staff: the details and the Agenda items they are on, nothing else
        mine = db.execute(
            select(Event.id, Event.title, Event.start_date, Event.start_time).join(EventPerson, EventPerson.event_id == Event.id)
            .where(Event.client_id == client.id, EventPerson.user_id == actor.id).order_by(Event.start_date.desc(), Event.id.desc()).limit(LINKED_LIMIT)
        ).all()
        return {**client_payload(client, actor), "properties": _properties_of(db, client.id), "events": [{"id": i, "title": t, "start_date": _iso(d), "start_time": s.strftime("%H:%M") if s else None} for i, t, d, s in mine]}
    tasks = db.execute(select(Task.id, Task.title, Task.status, Task.due_date).where(Task.client_id == client.id).order_by(Task.due_date.desc().nulls_last(), Task.id.desc()).limit(LINKED_LIMIT)).all()
    events = db.execute(select(Event.id, Event.title, Event.start_date, Event.start_time).where(Event.client_id == client.id).order_by(Event.start_date.desc(), Event.id.desc()).limit(LINKED_LIMIT)).all()
    documents = db.execute(select(Document.id, Document.title, Document.content_type).where(Document.client_id == client.id, Document.size_bytes.is_not(None)).order_by(Document.created_at.desc()).limit(LINKED_LIMIT)).all()
    quotes = db.execute(select(Quote.id, Quote.status, Quote.kind, Quote.submitted_at).where(Quote.client_id == client.id).order_by(Quote.id.desc()).limit(LINKED_LIMIT)).all()
    return {
        **client_payload(client),
        "properties": _properties_of(db, client.id),
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
        d = quote.details or {}
        place = d.get("address") or d.get("city") or client.name
        db.add(Property(client_id=client.id, name=place[:100], kind=quote.kind, address=d.get("address"), city=d.get("city"), listing_url=d.get("listing_url"), created_by=actor.id, updated_by=actor.id))
    audit.log(db, "client_created", actor_user_id=actor.id, ip=ip, details={"client_id": client.id, **({"quote_id": data.quote_id} if data.quote_id else {})})
    return client


def update_client(db: Session, actor: User, client_id: int, data: ClientIn, ip: str) -> Client:
    policy.check_clients(actor)
    client = get_client(db, actor, client_id)
    changed = [f for f in FIELDS if getattr(client, f) != getattr(data, f)]
    for f in changed:
        setattr(client, f, getattr(data, f))
    if changed:
        client.updated_by, client.updated_at = actor.id, func.now()
        audit.log(db, "client_updated", actor_user_id=actor.id, ip=ip, details={"client_id": client.id, "fields": changed})
    return client


def delete_client(db: Session, actor: User, client_id: int, ip: str) -> None:
    policy.check_clients(actor)
    client = get_client(db, actor, client_id)
    db.delete(client)  # what pointed to it is unlinked (ON DELETE SET NULL), nothing else goes
    audit.log(db, "client_deleted", actor_user_id=actor.id, ip=ip, details={"client_id": client_id})
