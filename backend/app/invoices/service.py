"""Invoices: numbered, gap-free, created in one step from Agenda occurrences and manual lines, then read-only."""

from datetime import date
from decimal import Decimal

from sqlalchemy import Text, cast, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import audit, policy
from app.auth.errors import ApiError
from app.invoices import billing, money, pdf
from app.invoices.schemas import InvoiceIn
from app.models import Client, Document, DocumentCategory, DocumentFile, Event, Invoice, InvoiceLine, User

FIRST_NUMBER = 7  # the company's own numbering reached 006 outside the app
CATEGORY_NAME = "Factures"
CATEGORY_ICON = "🧾"
LIST_LIMIT = 500


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


def reference(number: int) -> str:
    return f"{number:03d}"


def _summary(i: Invoice) -> dict:
    return {
        "id": i.id, "number": i.number, "reference": reference(i.number), "client_id": i.client_id,
        "bill_name": i.bill_name, "bill_address": i.bill_address, "bill_city": i.bill_city, "bill_phone": i.bill_phone, "bill_email": i.bill_email,
        "issued_on": _iso(i.issued_on), "status": i.status, "paid_on": _iso(i.paid_on),
        "subtotal": money.as_json(i.subtotal), "tax": money.as_json(i.tax), "extra": money.as_json(i.extra), "total": money.as_json(i.total),
        "sent_at": _iso(i.sent_at), "cancelled_at": _iso(i.cancelled_at), "document_id": i.document_id,
    }


def _lines_of(db: Session, invoice_id: int) -> list[InvoiceLine]:
    return list(db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == invoice_id).order_by(InvoiceLine.position)))


def invoice_payload(db: Session, invoice: Invoice) -> dict:
    return {
        **_summary(invoice),
        "lines": [{"description": x.description, "amount": money.as_json(x.amount), "event_id": x.event_id, "occurrence_date": _iso(x.occurrence_date)} for x in _lines_of(db, invoice.id)],
    }


def pdf_snapshot(db: Session, invoice: Invoice) -> pdf.PdfInvoice:
    return pdf.PdfInvoice(
        number=invoice.number, issued_on=invoice.issued_on, bill_name=invoice.bill_name, bill_address=invoice.bill_address,
        bill_city=invoice.bill_city, bill_phone=invoice.bill_phone, lines=[pdf.PdfLine(x.description, x.amount) for x in _lines_of(db, invoice.id)],
        subtotal=invoice.subtotal, tax=invoice.tax, extra=invoice.extra, total=invoice.total,
    )


def get_invoice(db: Session, actor: User, invoice_id: int) -> Invoice:
    policy.check_invoices(actor)
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise ApiError(404, "not_found")
    return invoice


def list_invoices(db: Session, actor: User, status: str | None, q: str | None) -> dict:
    policy.check_invoices(actor)
    query = select(Invoice)
    if status:
        query = query.where(Invoice.status == status)
    needle = (q or "").strip()
    if needle:
        like = f"%{needle.replace('%', '').replace('_', '')}%"
        query = query.where(or_(func.lpad(cast(Invoice.number, Text), 3, "0").ilike(like), Invoice.bill_name.ilike(like), Invoice.bill_city.ilike(like)))
    rows = db.scalars(query.order_by(Invoice.number.desc()).limit(LIST_LIMIT))
    unpaid = db.scalar(select(func.coalesce(func.sum(Invoice.total), 0)).where(Invoice.status == "unpaid"))
    return {"invoices": [_summary(i) for i in rows], "unpaid_total": money.as_json(Decimal(unpaid))}


def _factures_category(db: Session) -> DocumentCategory:
    found = db.scalars(select(DocumentCategory).where(func.lower(DocumentCategory.name) == CATEGORY_NAME.lower())).first()
    if found is None:
        found = DocumentCategory(name=CATEGORY_NAME, icon=CATEGORY_ICON)
        db.add(found)
        db.flush()
    return found


def create_invoice(db: Session, actor: User, data: InvoiceIn, ip: str) -> Invoice:
    policy.check_invoices(actor)
    client = db.get(Client, data.client_id)
    if client is None:
        raise ApiError(422, "client_not_found")
    pairs = [(x.event_id, x.occurrence_date) for x in data.lines if x.event_id is not None]
    if len(set(pairs)) != len(pairs):
        raise ApiError(422, "duplicate_line")

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('invoices'))"))  # one invoice at a time: gap-free numbers, no double billing
    today = billing.company_today()
    for event_id, original in pairs:
        event = db.get(Event, event_id)
        occurrence = billing.occurrence_of(db, event, original) if event is not None and event.client_id == client.id else None
        if occurrence is None or occurrence.date > today:
            raise ApiError(422, "occurrence_not_billable")
        if db.scalar(select(InvoiceLine.id).where(InvoiceLine.live, InvoiceLine.event_id == event_id, InvoiceLine.occurrence_date == original)) is not None:
            raise ApiError(409, "already_billed")

    number = (db.scalar(select(func.max(Invoice.number))) or FIRST_NUMBER - 1) + 1
    subtotal = sum((x.amount for x in data.lines), Decimal("0.00"))
    name = client.name + (f" / {client.contact_name}" if client.contact_name else "")
    invoice = Invoice(
        number=number, client_id=client.id, bill_name=name, bill_address=client.address, bill_city=client.city, bill_phone=client.phone,
        bill_email=client.email, issued_on=data.issued_on, status="unpaid", subtotal=subtotal, tax=Decimal("0.00"), extra=data.extra,
        total=subtotal + data.extra, created_by=actor.id, updated_by=actor.id,
    )
    db.add(invoice)
    db.flush()
    db.add_all(
        InvoiceLine(invoice_id=invoice.id, position=n, description=x.description, amount=x.amount, event_id=x.event_id, occurrence_date=x.occurrence_date)
        for n, x in enumerate(data.lines, 1)
    )
    try:
        db.flush()
    except IntegrityError:  # the unique index is the backstop behind the lock
        db.rollback()
        raise ApiError(409, "already_billed")

    content = pdf.render(pdf_snapshot(db, invoice))
    ref = reference(number)
    document = Document(
        title=f"Facture {ref}", visibility="admins", client_id=client.id, category_id=_factures_category(db).id, file_name=f"Facture-{ref}.pdf",
        content_type="application/pdf", size_bytes=len(content), created_by=actor.id, updated_by=actor.id,
    )
    db.add(document)
    db.flush()
    db.add(DocumentFile(document_id=document.id, data=content))
    invoice.document_id = document.id
    db.flush()
    audit.log(db, "invoice_created", actor_user_id=actor.id, ip=ip, details={"invoice_id": invoice.id, "number": number, "client_id": client.id})
    return invoice


def _lock(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('invoices'))"))


def _touch(invoice: Invoice, actor: User) -> None:
    invoice.updated_by, invoice.updated_at = actor.id, func.now()


def mark_paid(db: Session, actor: User, invoice_id: int, paid_on: date, ip: str) -> Invoice:
    invoice = get_invoice(db, actor, invoice_id)
    if invoice.status != "unpaid":
        raise ApiError(422, "bad_status")
    if paid_on > billing.company_today():
        raise ApiError(422, "bad_date")
    invoice.status, invoice.paid_on = "paid", paid_on
    _touch(invoice, actor)
    db.flush()
    audit.log(db, "invoice_paid", actor_user_id=actor.id, ip=ip, details={"invoice_id": invoice.id, "number": invoice.number})
    return invoice


def mark_unpaid(db: Session, actor: User, invoice_id: int, ip: str) -> Invoice:
    invoice = get_invoice(db, actor, invoice_id)
    if invoice.status != "paid":
        raise ApiError(422, "bad_status")
    invoice.status, invoice.paid_on = "unpaid", None
    _touch(invoice, actor)
    db.flush()
    audit.log(db, "invoice_unpaid", actor_user_id=actor.id, ip=ip, details={"invoice_id": invoice.id, "number": invoice.number})
    return invoice


def cancel_invoice(db: Session, actor: User, invoice_id: int, ip: str) -> Invoice:
    """The number is kept and never reused; the cleanings it listed become billable again."""
    policy.check_invoices(actor)
    _lock(db)
    invoice = get_invoice(db, actor, invoice_id)
    if invoice.status == "cancelled":
        raise ApiError(422, "bad_status")
    invoice.status, invoice.paid_on, invoice.cancelled_at = "cancelled", None, func.now()
    _touch(invoice, actor)
    db.execute(update(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id).values(live=False))
    document = db.get(Document, invoice.document_id) if invoice.document_id else None
    if document is not None:
        document.title = f"Facture {reference(invoice.number)} (annulée)"
    db.flush()
    db.refresh(invoice)
    audit.log(db, "invoice_cancelled", actor_user_id=actor.id, ip=ip, details={"invoice_id": invoice.id, "number": invoice.number})
    return invoice


def pdf_bytes(db: Session, invoice: Invoice) -> bytes:
    """The copy stored when the invoice was created; drawn again from the snapshot if that document was deleted."""
    stored = db.get(DocumentFile, invoice.document_id) if invoice.document_id else None
    return stored.data if stored is not None else pdf.render(pdf_snapshot(db, invoice))
