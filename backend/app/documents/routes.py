from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.config import Settings
from app.documents import service
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
