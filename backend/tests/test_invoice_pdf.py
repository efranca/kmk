import re
import shutil
import subprocess
from datetime import date
from decimal import Decimal

import pytest

from app.invoices.pdf import PdfInvoice, PdfLine, render

pytestmark = pytest.mark.skipif(shutil.which("pdftotext") is None, reason="pdftotext (poppler-utils) is needed to read the PDF back")


def text_of(pdf: bytes) -> str:
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=pdf, capture_output=True, check=True).stdout.decode()


def invoice(lines, **kw):
    subtotal = sum((x.amount for x in lines), Decimal("0"))
    base = dict(
        number=7, issued_on=date(2026, 11, 27), bill_name="Ducarme / Mike", bill_address="640 St Jean, app 1212", bill_city="Québec - QC",
        bill_phone="418 353-7465", lines=lines, subtotal=subtotal, tax=Decimal("0"), extra=Decimal("0"), total=subtotal,
    )
    base.update(kw)
    return PdfInvoice(**base)


def test_renders_the_model_fields():
    pdf = render(invoice([PdfLine("Entretien ménager - Beach house - 06/11/2025", Decimal("120")), PdfLine("Vitres", Decimal("75"))]))
    assert pdf.startswith(b"%PDF")
    text = text_of(pdf)
    for want in ("FACTURE N° 007", "Date : 27/11/2026", "FACTURER À", "POUR", "KMK Entretien ménager", "Ducarme / Mike", "Téléphone : 418 353-7465",
                 "Entretien ménager - Beach house - 06/11/2025", "195,00 $", "Sous-total", "Taux de TVA", "0,00 $", "Coûts supplémentaires", "COÛT TOTAL",
                 "Lévis - QC", "(367) 331-2003", "info@kmk-entretien.com", "kmk-entretien.com", "NEQ : 3382547134", "Nous vous remercions de votre confiance."):
        assert want in text, want


def test_empty_address_lines_are_left_out():
    text = text_of(render(invoice([PdfLine("x", Decimal("1"))], bill_address=None, bill_city=None, bill_phone=None)))
    assert "Téléphone" not in text and "Ducarme / Mike" in text


def test_names_outside_latin1():
    pdf = render(invoice([PdfLine("Nettoyage 🧽 de printemps", Decimal("10"))], bill_name="Łukasz Nguyễn"))
    text = text_of(pdf)
    assert "Łukasz Nguyễn" in text and "Nettoyage" in text and "de printemps" in text


def test_long_invoice_breaks_pages():
    lines = [PdfLine(f"Entretien ménager - Maison {i} - {i % 28 + 1:02d}/11/2026", Decimal("100")) for i in range(40)]
    pdf = render(invoice(lines))
    pages = len(re.findall(rb"/Type\s*/Page\b", pdf))
    assert pages > 1
    text = text_of(pdf)
    assert text.count("COÛT TOTAL") == 1 and text.count("NEQ : 3382547134") == pages
    assert text.count("4 000,00 $") >= 2  # subtotal and total
    assert text.rindex("COÛT TOTAL") > text.rindex("Maison 39")  # the totals come after the last line


def test_amounts_over_a_thousand_use_a_space():
    assert "1 234,50 $" in text_of(render(invoice([PdfLine("x", Decimal("1234.50"))])))
