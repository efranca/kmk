"""The invoice PDF, in French only, following the company's model (`KMK Facture.pdf`).

The company block and the logo live here (and in `assets/`) because they are the company's, not the client's.
Text is drawn with an embedded TrueType font (Liberation Sans) so names outside Latin-1 render.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from fpdf import FPDF

from app.invoices.money import format_fr

ASSETS = Path(__file__).parent / "assets"
FONT = "Liberation"

COMPANY_NAME = "KMK Entretien ménager"
COMPANY_CONTACT = ("Lévis - QC", "Tél. : (367) 331-2003", "info@kmk-entretien.com", "kmk-entretien.com", "NEQ : 3382547134")
CONTACT_INTRO = "Pour toute question concernant cette facture, utilisez les informations de contact :"
THANKS = "Nous vous remercions de votre confiance."

TEAL = (18, 60, 62)
GREY = (95, 105, 105)
LINE = (215, 218, 218)
INK = (25, 30, 30)
WHITE = (255, 255, 255)

PAGE_W, PAGE_H = 210.0, 297.0
MARGIN = 18.0
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H = 32.0  # the footer sits in the bottom 32 mm; content never goes below the line above it
BOTTOM = PAGE_H - FOOTER_H - 4
PAD = 4.0
AMOUNT_W = 36.0
ROW_LINE_H = 5.4
ROW_MIN_H = 11.0
TOTALS_X = 110.0
TOTALS_W = PAGE_W - MARGIN - TOTALS_X


@dataclass(frozen=True)
class PdfLine:
    description: str
    amount: Decimal


@dataclass(frozen=True)
class PdfInvoice:
    number: int
    issued_on: date
    bill_name: str
    bill_address: str | None
    bill_city: str | None
    bill_phone: str | None
    lines: list[PdfLine]
    subtotal: Decimal
    tax: Decimal
    extra: Decimal
    total: Decimal


def _clean(text: str) -> str:
    """Drops what the font cannot draw: characters above U+FFFF (emoji) and control characters."""
    text = "".join(" " if ord(c) < 32 or c in "\x7f  " else c for c in text if ord(c) <= 0xFFFF)
    return re.sub(r" {2,}", " ", text).strip()


class _Pdf(FPDF):
    def footer(self) -> None:
        y = PAGE_H - FOOTER_H
        self.set_draw_color(*LINE)
        self.set_line_width(0.3)
        self.line(MARGIN, y, PAGE_W - MARGIN, y)
        self.set_font(FONT, "", 9)
        self.set_text_color(*GREY)
        self.set_xy(MARGIN, y + 4)
        self.cell(CONTENT_W, 5, CONTACT_INTRO)
        self.set_font(FONT, "", 8.5)
        self.set_text_color(*INK)
        x = MARGIN
        for part in COMPANY_CONTACT:
            self.set_xy(x, y + 11)
            self.cell(self.get_string_width(part) + 0.5, 5, part)
            x += self.get_string_width(part) + 7
        self.set_font(FONT, "I", 9)
        self.set_xy(MARGIN, y + 19)
        self.cell(CONTENT_W, 5, THANKS, align="C")


def _text(pdf: _Pdf, x: float, y: float, w: float, h: float, text: str, *, style="", size=10.5, color=INK, align="L") -> None:
    pdf.set_font(FONT, style, size)
    pdf.set_text_color(*color)
    pdf.set_xy(x, y)
    pdf.cell(w, h, text, align=align)


def _table_header(pdf: _Pdf, y: float) -> float:
    pdf.set_fill_color(*TEAL)
    pdf.rect(MARGIN, y, CONTENT_W, 10, style="F")
    _text(pdf, MARGIN + PAD, y, CONTENT_W - AMOUNT_W, 10, "DESCRIPTION DU SERVICE", style="B", size=8.5, color=WHITE)
    _text(pdf, PAGE_W - MARGIN - AMOUNT_W, y, AMOUNT_W - PAD, 10, "MONTANT", style="B", size=8.5, color=WHITE, align="R")
    return y + 10


def _first_page(pdf: _Pdf, inv: PdfInvoice) -> float:
    pdf.add_page()
    pdf.image(str(ASSETS / "logo.png"), x=MARGIN, y=12, w=66)
    _text(pdf, MARGIN, 17, CONTENT_W, 7, f"FACTURE N° {inv.number:03d}", style="B", size=13, color=TEAL, align="R")
    _text(pdf, MARGIN, 24, CONTENT_W, 6, f"Date : {inv.issued_on:%d/%m/%Y}", size=10, color=GREY, align="R")
    pdf.set_fill_color(*TEAL)
    pdf.rect(MARGIN, 44, CONTENT_W, 1, style="F")

    _text(pdf, MARGIN, 52, 80, 5, "FACTURER À", style="B", size=8, color=TEAL)
    _text(pdf, TOTALS_X, 52, 70, 5, "POUR", style="B", size=8, color=TEAL)
    billed = [inv.bill_name, inv.bill_address, inv.bill_city, f"Téléphone : {inv.bill_phone}" if inv.bill_phone else None]
    y = 59.0
    for line in filter(None, (_clean(x) if x else None for x in billed)):
        _text(pdf, MARGIN, y, TOTALS_X - MARGIN - 4, 7, line)
        y += 7
    _text(pdf, TOTALS_X, 59, 70, 7, COMPANY_NAME)
    return _table_header(pdf, max(y, 59 + 7) + 9)


def _row_lines(pdf: _Pdf, text: str) -> list[str]:
    pdf.set_font(FONT, "", 10.5)
    return pdf.multi_cell(CONTENT_W - AMOUNT_W - PAD, ROW_LINE_H, text, dry_run=True, output="LINES") or [""]


def _totals(pdf: _Pdf, inv: PdfInvoice, y: float) -> None:
    y += 4
    for label, value in (("Sous-total", inv.subtotal), ("Taux de TVA", inv.tax), ("Coûts supplémentaires", inv.extra)):
        _text(pdf, TOTALS_X + PAD, y, 40, 10, label, size=10, color=GREY)
        _text(pdf, PAGE_W - MARGIN - AMOUNT_W, y, AMOUNT_W - PAD, 10, format_fr(value), size=10, color=INK, align="R")
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.3)
        pdf.line(TOTALS_X, y + 10, PAGE_W - MARGIN, y + 10)
        y += 10
    y += 2
    pdf.set_fill_color(*TEAL)
    pdf.rect(TOTALS_X, y, TOTALS_W, 12, style="F")
    _text(pdf, TOTALS_X + PAD, y, 40, 12, "COÛT TOTAL", style="B", size=11, color=WHITE)
    _text(pdf, PAGE_W - MARGIN - AMOUNT_W, y, AMOUNT_W - PAD, 12, format_fr(inv.total), style="B", size=11, color=WHITE, align="R")


def render(invoice: PdfInvoice) -> bytes:
    pdf = _Pdf(format="A4", unit="mm")
    pdf.set_auto_page_break(False)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.set_compression(True)
    pdf.set_title(f"Facture {invoice.number:03d}")
    pdf.set_creator(COMPANY_NAME)
    for style, name in (("", "Regular"), ("B", "Bold"), ("I", "Italic")):
        pdf.add_font(FONT, style, str(ASSETS / f"LiberationSans-{name}.ttf"))

    y = _first_page(pdf, invoice)
    for line in invoice.lines:
        rows = _row_lines(pdf, _clean(line.description))
        height = max(ROW_MIN_H, ROW_LINE_H * len(rows) + 5.6)
        if y + height > BOTTOM:
            pdf.add_page()
            y = _table_header(pdf, MARGIN)
        pdf.set_font(FONT, "", 10.5)
        pdf.set_text_color(*INK)
        pdf.set_xy(MARGIN + PAD, y + (height - ROW_LINE_H * len(rows)) / 2)
        pdf.multi_cell(CONTENT_W - AMOUNT_W - PAD, ROW_LINE_H, "\n".join(rows))
        _text(pdf, PAGE_W - MARGIN - AMOUNT_W, y, AMOUNT_W - PAD, height, format_fr(line.amount), align="R")
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.3)
        pdf.line(MARGIN, y + height, PAGE_W - MARGIN, y + height)
        y += height

    if y + 4 + 3 * 10 + 14 > BOTTOM:  # keep the totals together, never alone at the top of nothing
        pdf.add_page()
        y = MARGIN - 4
    _totals(pdf, invoice, y)
    return bytes(pdf.output())
