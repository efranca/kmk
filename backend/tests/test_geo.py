import pytest

from app.auth import geo


@pytest.mark.parametrize("raw, expected", [("CA", "CA"), ("ca", "CA"), (" us ", "US"), ("CAN", None), ("", None), ("T1", None), ("XX1", None), (None, None), ("é1", None)])
def test_country(raw, expected):
    assert geo.sanitize_country(raw) == expected


def test_city_drops_control_characters_and_trims():
    assert geo.sanitize_city("  Montr\x00éal\n ") == "Montréal"


def test_city_is_cut_to_100_characters():
    assert geo.sanitize_city("a" * 300) == "a" * 100


@pytest.mark.parametrize("raw", [None, "", "   ", "\x00\x01\n"])
def test_city_without_content_is_none(raw):
    assert geo.sanitize_city(raw) is None


def test_city_sent_as_utf8_bytes_is_repaired():
    assert geo.sanitize_city("Montr\u00c3\u00a9al") == "Montréal"
