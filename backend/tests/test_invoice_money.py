from decimal import Decimal

import pytest

from app.invoices.money import as_json, format_fr, parse_amount


def test_format_fr():
    assert format_fr(Decimal("1234.5")) == "1 234,50 $"
    assert format_fr(Decimal("195")) == "195,00 $"
    assert format_fr(Decimal("0")) == "0,00 $"


def test_as_json():
    assert as_json(Decimal("195")) == "195.00"
    assert as_json(None) is None


@pytest.mark.parametrize("raw,want", [("120.5", "120.50"), (120, "120.00"), (Decimal("7"), "7.00"), ("0", "0.00"), ("99999.99", "99999.99")])
def test_parse_amount_accepts(raw, want):
    assert parse_amount(raw) == Decimal(want)


@pytest.mark.parametrize("raw", ["-1", "100000", "1.234", "abc", "", 1.5, True, None, "NaN", "Infinity", -1])
def test_parse_amount_refuses(raw):
    with pytest.raises(ValueError):
        parse_amount(raw)
