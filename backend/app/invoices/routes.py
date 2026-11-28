from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth import policy
from app.auth.deps import get_db, get_settings_dep
from app.auth.errors import ApiError
from app.auth.guard import guard
from app.auth.routes import request_ip
from app.clients import service as clients
from app.config import Settings
from app.invoices import billing, service
from app.invoices.schemas import InvoiceIn, PaymentIn, SendIn
from app.models import User, UserSession
from app.schedule.recurrence import MAX_RANGE_DAYS
from app.schedule.schemas import MAX_ID

router = APIRouter(prefix="/api")
ClientId = Annotated[int, Path(ge=1, le=MAX_ID)]
InvoiceId = Annotated[int, Path(ge=1, le=MAX_ID)]


@router.get("/clients/{client_id}/billable")
def list_billable(
    client_id: ClientId,
    from_: Annotated[date, Query(alias="from")],
    to: date,
    auth: tuple[User, UserSession] = Depends(guard(csrf=False)),
    db: Session = Depends(get_db),
):
    policy.check_invoices(auth[0])
    clients.get_client(db, auth[0], client_id)
    if to < from_ or (to - from_).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(422, "bad_range")
    return {"occurrences": billing.billable(db, client_id, from_, to, billing.company_today())}


@router.post("/invoices", status_code=201)
def create_invoice(body: InvoiceIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    invoice = service.create_invoice(db, auth[0], body, request_ip(request, settings))
    payload = service.invoice_payload(db, invoice)
    db.commit()
    return {"invoice": payload}


@router.get("/invoices")
def list_invoices(
    status: Annotated[Literal["unpaid", "paid", "cancelled"] | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    auth: tuple[User, UserSession] = Depends(guard(csrf=False)),
    db: Session = Depends(get_db),
):
    return service.list_invoices(db, auth[0], status, q)


@router.get("/invoices/{invoice_id}")
def read_invoice(invoice_id: InvoiceId, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    return {"invoice": service.invoice_payload(db, service.get_invoice(db, auth[0], invoice_id))}


@router.post("/invoices/{invoice_id}/payment")
def pay_invoice(invoice_id: InvoiceId, body: PaymentIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    invoice = service.mark_paid(db, auth[0], invoice_id, body.paid_on, request_ip(request, settings))
    payload = service.invoice_payload(db, invoice)
    db.commit()
    return {"invoice": payload}


@router.delete("/invoices/{invoice_id}/payment")
def unpay_invoice(invoice_id: InvoiceId, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    invoice = service.mark_unpaid(db, auth[0], invoice_id, request_ip(request, settings))
    payload = service.invoice_payload(db, invoice)
    db.commit()
    return {"invoice": payload}


@router.post("/invoices/{invoice_id}/cancel")
def cancel_invoice(invoice_id: InvoiceId, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    invoice = service.cancel_invoice(db, auth[0], invoice_id, request_ip(request, settings))
    payload = service.invoice_payload(db, invoice)
    db.commit()
    return {"invoice": payload}


@router.get("/invoices/{invoice_id}/pdf")
def download_pdf(invoice_id: InvoiceId, auth: tuple[User, UserSession] = Depends(guard(csrf=False)), db: Session = Depends(get_db)):
    invoice = service.get_invoice(db, auth[0], invoice_id)
    return Response(
        content=service.pdf_bytes(db, invoice),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="Facture-{service.reference(invoice.number)}.pdf"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/invoices/{invoice_id}/send")
def send_invoice(invoice_id: InvoiceId, body: SendIn, request: Request, auth: tuple[User, UserSession] = Depends(guard()), db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    invoice = service.send_invoice(db, auth[0], invoice_id, body.to, settings, request_ip(request, settings))
    payload = service.invoice_payload(db, invoice)
    db.commit()
    return {"invoice": payload}
