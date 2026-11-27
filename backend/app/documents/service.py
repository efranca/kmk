"""Documents: every read applies the visibility rule inside the query, so a document you may not see is a 404."""

from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.clients.service import check_client
from app.auth import audit, policy
from app.auth.errors import ApiError
from app.documents import limits
from app.documents.files import detect_document
from app.documents.schemas import CategoryIn, DocumentIn, DocumentPatch
from app.documents.visibility import visible_levels
from app.models import Document, DocumentCategory, DocumentFile, DocumentPreview, User


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


# ---- categories ---------------------------------------------------------------------------------------------------


def category_payload(c: DocumentCategory) -> dict:
    return {"id": c.id, "name": c.name, "icon": c.icon}


def list_categories(db: Session) -> list[dict]:
    rows = db.scalars(select(DocumentCategory).order_by(func.lower(DocumentCategory.name), DocumentCategory.id)).all()
    return [category_payload(c) for c in rows]


def get_category(db: Session, category_id: int) -> DocumentCategory:
    category = db.get(DocumentCategory, category_id)
    if category is None:
        raise ApiError(404, "category_not_found")
    return category


def _name_taken(db: Session, name: str, except_id: int | None = None) -> bool:
    query = select(DocumentCategory.id).where(func.lower(DocumentCategory.name) == name.lower())
    if except_id is not None:
        query = query.where(DocumentCategory.id != except_id)
    return db.scalar(query) is not None


def create_category(db: Session, actor: User, data: CategoryIn, ip: str) -> DocumentCategory:
    policy.check_documents(actor)
    if _name_taken(db, data.name):
        raise ApiError(409, "category_exists")
    category = DocumentCategory(name=data.name, icon=data.icon, created_by=actor.id)
    db.add(category)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "category_exists")
    audit.log(db, "document_category_created", actor_user_id=actor.id, ip=ip, details={"category_id": category.id})
    return category


def update_category(db: Session, actor: User, category_id: int, data: CategoryIn, ip: str) -> DocumentCategory:
    policy.check_documents(actor)
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
        audit.log(db, "document_category_updated", actor_user_id=actor.id, ip=ip, details={"category_id": category.id, "fields": fields})
    return category


def delete_category(db: Session, actor: User, category_id: int, ip: str) -> None:
    policy.check_documents(actor)
    category = get_category(db, category_id)
    db.delete(category)  # its documents stay, without a category (ON DELETE SET NULL)
    audit.log(db, "document_category_deleted", actor_user_id=actor.id, ip=ip, details={"category_id": category_id})


# ---- documents ----------------------------------------------------------------------------------------------------


def readable(actor: User):
    """The WHERE clause every read uses: a visible level, and a finished upload (or the creator's own pending one)."""
    return (
        Document.visibility.in_(visible_levels(actor.role)),
        or_(Document.size_bytes.is_not(None), Document.created_by == actor.id),
    )


def get_document(db: Session, actor: User, document_id: int) -> Document:
    document = db.scalars(select(Document).where(Document.id == document_id, *readable(actor))).first()
    if document is None:
        raise ApiError(404, "not_found")  # the same for "hidden" and "missing"
    return document


def document_payloads(db: Session, documents: list[Document]) -> list[dict]:
    ids = {d.created_by for d in documents} | {d.updated_by for d in documents}
    names = {}
    if ids:
        for uid, name, username in db.execute(select(User.id, User.name, User.username).where(User.id.in_(ids))):
            names[uid] = name or username
    with_preview = set(db.scalars(select(DocumentPreview.document_id).where(DocumentPreview.document_id.in_([d.id for d in documents])))) if documents else set()
    return [
        {
            "id": d.id,
            "title": d.title,
            "note": d.note,
            "category_id": d.category_id,
            "client_id": d.client_id,
            "visibility": d.visibility,
            "file_name": d.file_name,
            "content_type": d.content_type,
            "size_bytes": d.size_bytes,
            "has_file": d.size_bytes is not None,
            "has_preview": d.id in with_preview,
            "created_by": {"id": d.created_by, "name": names.get(d.created_by)},
            "created_at": _iso(d.created_at),
            "updated_at": _iso(d.updated_at),
        }
        for d in documents
    ]


def list_documents(db: Session, actor: User) -> list[dict]:
    rows = db.scalars(
        select(Document).where(Document.size_bytes.is_not(None), Document.visibility.in_(visible_levels(actor.role))).order_by(Document.created_at.desc(), Document.id.desc())
    ).all()
    return document_payloads(db, list(rows))


def _check_level(actor: User, visibility: str) -> None:
    if visibility not in visible_levels(actor.role):
        raise ApiError(403, "forbidden")  # nobody sets a level above their own


def purge_pending(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - limits.PENDING_TTL
    db.execute(delete(Document).where(Document.size_bytes.is_(None), Document.created_at < cutoff))


def create_document(db: Session, actor: User, data: DocumentIn, ip: str) -> Document:
    policy.check_documents(actor)
    _check_level(actor, data.visibility)
    if data.category_id is not None:
        get_category(db, data.category_id)
    check_client(db, data.client_id)
    purge_pending(db)
    if (db.scalar(select(func.count(Document.id))) or 0) >= limits.MAX_DOCUMENTS:
        raise ApiError(422, "too_many_documents")
    document = Document(title=data.title, note=data.note, category_id=data.category_id, client_id=data.client_id, visibility=data.visibility, created_by=actor.id, updated_by=actor.id)
    db.add(document)
    db.flush()
    audit.log(db, "document_added", actor_user_id=actor.id, ip=ip, details={"document_id": document.id})
    return document


def update_document(db: Session, actor: User, document_id: int, data: DocumentPatch, ip: str) -> Document:
    policy.check_documents(actor)
    document = get_document(db, actor, document_id)
    sent = data.model_fields_set
    if "visibility" in sent:
        _check_level(actor, data.visibility)
    if "category_id" in sent and data.category_id is not None:
        get_category(db, data.category_id)
    if "client_id" in sent:
        check_client(db, data.client_id)
    changed = []
    for field in ("title", "note", "category_id", "client_id", "visibility"):
        if field in sent and getattr(document, field) != getattr(data, field):
            changed.append(field)
    old_visibility = document.visibility
    for field in changed:
        setattr(document, field, getattr(data, field))
    if changed:
        document.updated_by = actor.id
        document.updated_at = func.now()
        audit.log(db, "document_updated", actor_user_id=actor.id, ip=ip, details={"document_id": document.id, "fields": changed})
    if "visibility" in changed:
        audit.log(db, "document_visibility_changed", actor_user_id=actor.id, ip=ip, details={"document_id": document.id, "from": old_visibility, "to": document.visibility})
    return document


def delete_document(db: Session, actor: User, document_id: int, ip: str) -> None:
    policy.check_documents(actor)
    document = get_document(db, actor, document_id)
    db.delete(document)  # its bytes go with it (ON DELETE CASCADE)
    audit.log(db, "document_deleted", actor_user_id=actor.id, ip=ip, details={"document_id": document_id})


# ---- files --------------------------------------------------------------------------------------------------------


def store_file(db: Session, actor: User, document_id: int, data: bytes, file_name: str, ip: str) -> None:
    """Check the bytes and the library limit, then save them (first file or a replacement) with the document's facts."""
    policy.check_documents(actor)
    document = get_document(db, actor, document_id)
    content_type = detect_document(data, file_name)
    if content_type is None:
        raise ApiError(422, "invalid_file")
    used = db.scalar(select(func.coalesce(func.sum(Document.size_bytes), 0)).where(Document.id != document.id)) or 0
    if used + len(data) > limits.MAX_LIBRARY_BYTES:
        raise ApiError(422, "library_full")
    replacing = document.size_bytes is not None
    row = db.get(DocumentFile, document.id)
    if row is None:
        db.add(DocumentFile(document_id=document.id, data=data))
    else:
        row.data = data
    db.execute(delete(DocumentPreview).where(DocumentPreview.document_id == document.id))  # a new file needs a new preview
    document.file_name, document.content_type, document.size_bytes = file_name, content_type, len(data)
    document.updated_by = actor.id
    document.updated_at = func.now()
    if replacing:
        audit.log(db, "document_replaced", actor_user_id=actor.id, ip=ip, details={"document_id": document.id})


def read_file(db: Session, actor: User, document_id: int) -> tuple[Document, bytes]:
    document = get_document(db, actor, document_id)
    row = db.get(DocumentFile, document.id)
    if row is None or document.size_bytes is None:
        raise ApiError(404, "not_found")
    return document, row.data


def store_preview(db: Session, actor: User, document_id: int, data: bytes) -> None:
    """Keep the small JPEG the browser made for the tiles view (only a JPEG, checked by its first bytes)."""
    policy.check_documents(actor)
    document = get_document(db, actor, document_id)
    if document.size_bytes is None:
        raise ApiError(404, "not_found")  # no file yet: nothing to show a preview of
    if data[:3] != b"\xff\xd8\xff":
        raise ApiError(422, "invalid_file")
    row = db.get(DocumentPreview, document.id)
    if row is None:
        db.add(DocumentPreview(document_id=document.id, data=data))
    else:
        row.data, row.updated_at = data, func.now()


def read_preview(db: Session, actor: User, document_id: int) -> bytes:
    document = get_document(db, actor, document_id)
    row = db.get(DocumentPreview, document.id)
    if row is None:
        raise ApiError(404, "not_found")
    return row.data
