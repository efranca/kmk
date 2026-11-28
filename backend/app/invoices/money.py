"""Money: `Decimal` in Python, `numeric(10,2)` in the database, a string with two decimals in JSON."""

from decimal import Decimal, InvalidOperation

CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("99999.99")


def parse_amount(v: object) -> Decimal:
    """An amount from a string, int or Decimal (never a float or bool): 0..99999.99 with at most two decimals."""
    if isinstance(v, bool) or not isinstance(v, (str, int, Decimal)):
        raise ValueError("amount")
    try:
        d = Decimal(v.strip() if isinstance(v, str) else v)
    except InvalidOperation:
        raise ValueError("amount") from None
    if not d.is_finite() or d < 0 or d > MAX_AMOUNT:
        raise ValueError("amount")
    q = d.quantize(CENT)
    if q != d:
        raise ValueError("amount")  # more than two decimals
    return q


def as_json(v: Decimal | None) -> str | None:
    return None if v is None else f"{v.quantize(CENT):.2f}"


def format_fr(v: Decimal) -> str:
    """French Canadian display: `1 234,50 $` (plain spaces, so any font draws it)."""
    whole, cents = f"{v.quantize(CENT):.2f}".split(".")
    groups = []
    while len(whole) > 3:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    groups.insert(0, whole)
    return f"{' '.join(groups)},{cents} $"
