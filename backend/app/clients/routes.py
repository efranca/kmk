from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_db, get_settings_dep
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.clients import service
from app.clients.schemas import ClientIn, PropertyIn
from app.config import Settings
from app.models import User, UserSession
from app.schedule.schemas import MAX_ID

router = APIRouter(prefix="/api/clients")
ClientId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("")
def list_clients(q: Annotated[str | None, Query(max_length=100)] = None, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    return {"clients": service.list_clients(db, auth[0], q)}


@router.get("/{client_id}")
def read_client(client_id: ClientId, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    return {"client": service.detail_payload(db, auth[0], service.get_client(db, auth[0], client_id))}


@router.post("", status_code=201)
def create_client(body: ClientIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    client = service.create_client(db, auth[0], body, request_ip(request, settings))
    payload = service.client_payload(client)
    db.commit()
    return {"client": payload}


@router.patch("/{client_id}")
def change_client(client_id: ClientId, body: ClientIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    client = service.update_client(db, auth[0], client_id, body, request_ip(request, settings))
    payload = service.client_payload(client)
    db.commit()
    return {"client": payload}


@router.delete("/{client_id}", status_code=204)
def remove_client(client_id: ClientId, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    service.delete_client(db, auth[0], client_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)


@router.post("/{client_id}/properties", status_code=201)
def add_property(client_id: ClientId, body: PropertyIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    prop = service.add_property(db, auth[0], client_id, body, request_ip(request, settings))
    payload = service.property_payload(prop, auth[0])
    db.commit()
    return {"property": payload}


properties_router = APIRouter(prefix="/api/properties")


@properties_router.patch("/{property_id}")
def change_property(property_id: ClientId, body: PropertyIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    prop = service.update_property(db, auth[0], property_id, body, request_ip(request, settings))
    payload = service.property_payload(prop, auth[0])
    db.commit()
    return {"property": payload}


@properties_router.delete("/{property_id}", status_code=204)
def remove_property(property_id: ClientId, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    service.delete_property(db, auth[0], property_id, request_ip(request, settings))
    db.commit()
    return Response(status_code=204)
