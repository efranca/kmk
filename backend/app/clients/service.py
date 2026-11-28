"""Clients: the people the company works for. Tasks, Agenda items, documents and quotes can point to one."""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.clients.schemas import ClientIn, PropertyIn, RoomsIn
from app.invoices import money
from app.models import Client, Document, Event, EventPerson, Invoice, Property, PropertyRoom, Quote, Task, User

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


PROPERTY_FIELDS = ("name", "kind", "address", "city", "listing_url", "access_notes", "visit_price", "photos_required")


def rooms_by_property(db: Session, property_ids: list[int]) -> dict[int, list[dict]]:
    """The rooms of several properties in one query, each list in display order."""
    out: dict[int, list[dict]] = {}
    if property_ids:
        for r in db.scalars(select(PropertyRoom).where(PropertyRoom.property_id.in_(property_ids)).order_by(PropertyRoom.property_id, PropertyRoom.position)):
            out.setdefault(r.property_id, []).append({"id": r.id, "name": r.name})
    return out


def property_payload(p: Property, actor: User | None, rooms: list[dict] | None) -> dict:
    """The price per visit is for administrators only (`actor=None` means the caller already checked).
    `rooms` comes from `rooms_by_property` (this function reads no database); it is required so no caller forgets it
    (`None`, as `rooms.get(id)` gives for a property without rooms, means none)."""
    out = {**{f: getattr(p, f) for f in PROPERTY_FIELDS}, "id": p.id, "client_id": p.client_id, "rooms": rooms or []}
    if actor is None or policy.can_manage_clients(actor):
        out["visit_price"] = money.as_json(p.visit_price)
    else:
        del out["visit_price"]
    return out


def _properties_of(db: Session, client_id: int, actor: User | None = None) -> list[dict]:
    props = list(db.scalars(select(Property).where(Property.client_id == client_id).order_by(Property.id)))
    rooms = rooms_by_property(db, [p.id for p in props])
    return [property_payload(p, actor, rooms.get(p.id)) for p in props]


def property_payload_for(db: Session, p: Property, actor: User | None = None) -> dict:
    return property_payload(p, actor, rooms_by_property(db, [p.id]).get(p.id))


ROOMS_MAX = 30


def set_rooms(db: Session, actor: User, property_id: int, data: RoomsIn, ip: str) -> list[PropertyRoom]:
    """Replace the room list: ids that are sent are kept (and renamed), the others are deleted, new ones are inserted."""
    policy.check_clients(actor)
    _get_property(db, property_id)
    db.execute(select(Property.id).where(Property.id == property_id).with_for_update())  # one editor at a time
    current = {r.id: r for r in db.scalars(select(PropertyRoom).where(PropertyRoom.property_id == property_id))}
    sent = [r.id for r in data.rooms if r.id is not None]
    if len(set(sent)) != len(sent) or any(i not in current for i in sent):
        raise ApiError(422, "room_not_found")
    for rid, room in current.items():
        if rid not in sent:
            db.delete(room)
    for room in current.values():  # park the kept ones out of the way of UNIQUE (property_id, position)
        room.position += 1000
    db.flush()
    out: list[PropertyRoom] = []
    for pos, item in enumerate(data.rooms):
        if item.id is None:
            room = PropertyRoom(property_id=property_id, name=item.name, position=pos)
            db.add(room)
        else:
            room = current[item.id]
            room.name, room.position = item.name, pos
        out.append(room)
    db.flush()
    audit.log(db, "property_rooms_changed", actor_user_id=actor.id, ip=ip, details={"property_id": property_id, "count": len(out)})
    return out


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
        return {**client_payload(client, actor), "properties": _properties_of(db, client.id, actor), "events": [{"id": i, "title": t, "start_date": _iso(d), "start_time": s.strftime("%H:%M") if s else None} for i, t, d, s in mine]}
    tasks = db.execute(select(Task.id, Task.title, Task.status, Task.due_date).where(Task.client_id == client.id).order_by(Task.due_date.desc().nulls_last(), Task.id.desc()).limit(LINKED_LIMIT)).all()
    events = db.execute(select(Event.id, Event.title, Event.start_date, Event.start_time).where(Event.client_id == client.id).order_by(Event.start_date.desc(), Event.id.desc()).limit(LINKED_LIMIT)).all()
    documents = db.execute(select(Document.id, Document.title, Document.content_type).where(Document.client_id == client.id, Document.size_bytes.is_not(None)).order_by(Document.created_at.desc()).limit(LINKED_LIMIT)).all()
    quotes = db.execute(select(Quote.id, Quote.status, Quote.kind, Quote.submitted_at).where(Quote.client_id == client.id).order_by(Quote.id.desc()).limit(LINKED_LIMIT)).all()
    invoices = db.execute(select(Invoice.id, Invoice.number, Invoice.issued_on, Invoice.total, Invoice.status).where(Invoice.client_id == client.id).order_by(Invoice.number.desc()).limit(LINKED_LIMIT)).all()
    return {
        **client_payload(client),
        "properties": _properties_of(db, client.id, actor),
        "tasks": [{"id": i, "title": t, "status": s, "due_date": _iso(d)} for i, t, s, d in tasks],
        "events": [{"id": i, "title": t, "start_date": _iso(d), "start_time": s.strftime("%H:%M") if s else None} for i, t, d, s in events],
        "documents": [{"id": i, "title": t, "content_type": ct} for i, t, ct in documents],
        "quotes": [{"id": i, "reference": f"D-{i:04d}", "status": s, "kind": k, "submitted_at": _iso(at)} for i, s, k, at in quotes],
        "invoices": [{"id": i, "reference": f"{n:03d}", "issued_on": _iso(d), "total": money.as_json(t), "status": s} for i, n, d, t, s in invoices],
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
