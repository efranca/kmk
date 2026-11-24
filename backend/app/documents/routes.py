from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.auth import policy
from app.documents import service, uploads
from app.documents.schemas import CategoryIn, DocumentIn, DocumentPatch
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID

router = APIRouter()

# Reading needs a verified session but no CSRF token (the same choice as the schedule and the tasks).
reader = guard(csrf=False)

DocumentId = Annotated[int, Path(ge=1, le=MAX_ID)]
CategoryId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/api/documents")
def list_documents(auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    return {"documents": service.list_documents(db, auth[0]), "categories": service.list_categories(db)}


@router.post("/api/documents", status_code=201)
def create_document(
    body: DocumentIn,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    document = service.create_document(db, auth[0], body, request_ip(request, settings))
    payload = service.document_payloads(db, [document])[0]
    db.commit()
    return {"document": payload}


@router.get("/api/documents/{document_id}")
def get_document(document_id: DocumentId, auth: tuple[User, UserSession] = Depends(reader), db: Session = Depends(get_db)):
    document = service.get_document(db, auth[0], document_id)
    return {"document": service.document_payloads(db, [document])[0]}


@router.patch("/api/documents/{document_id}")
def change_document(
    document_id: DocumentId,
    body: DocumentPatch,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    document = service.update_document(db, auth[0], document_id, body, request_ip(request, settings))
    payload = service.document_payloads(db, [document])[0]
    db.commit()
    return {"document": payload}


@router.delete("/api/documents/{document_id}", status_code=204)
def remove_document(
    document_id: DocumentId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    service.delete_document(db, auth[0], document_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.post("/api/document-categories", status_code=201)
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


@router.patch("/api/document-categories/{category_id}")
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


@router.delete("/api/document-categories/{category_id}", status_code=204)
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


# ---- the file itself --------------------------------------------------------------------------------------------


@router.put("/api/documents/{document_id}/file", status_code=204)
async def put_file(
    document_id: DocumentId,
    request: Request,
    auth: tuple[User, UserSession] = Depends(guard()),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    actor = auth[0]
    policy.check_documents(actor)
    service.get_document(db, actor, document_id)  # 404 before reading anything
    uploads.slots.acquire()
    try:
        data = await uploads.read_capped(request)
        service.store_file(db, actor, document_id, data, uploads.clean_file_name(request.headers.get("x-file-name")), request_ip(request, settings))
    finally:
        uploads.slots.release()
    db.commit()
    return Response(status_code=204)


_UNSAFE = frozenset('"\\;/')


def _ascii_fallback(name: str) -> str:
    return "".join(c if c.isascii() and c.isprintable() and c not in _UNSAFE else "_" for c in name) or "document"


@router.get("/api/documents/{document_id}/file")
def get_file(
    document_id: DocumentId,
    download: bool = False,
    auth: tuple[User, UserSession] = Depends(reader),
    db: Session = Depends(get_db),
):
    document, data = service.read_file(db, auth[0], document_id)
    disposition = "attachment" if download else "inline"
    name = document.file_name or "document"
    return Response(
        content=data,
        media_type=document.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename=\"{_ascii_fallback(name)}\"; filename*=UTF-8''{quote(name, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )
