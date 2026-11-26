from datetime import date, datetime, time, timezone

from app.schedule.ics import escape_text, fold, render_feed
from app.schedule.occurrences import Occurrence

STAMP = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def occ(**kw):
    base = dict(event_id=7, original_date=date(2026, 11, 5), date=date(2026, 11, 5), start_time=time(9, 0),
                end_time=time(10, 0), all_day=False, title="Visit", notes="SECRET", repeating=False, modified=False)
    base.update(kw)
    return Occurrence(**base)


def test_calendar_envelope():
    out = render_feed([], STAMP)
    assert out.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//KMK Entretien//Schedule//EN\r\n")
    assert "X-WR-TIMEZONE:America/Toronto\r\n" in out and "BEGIN:VTIMEZONE\r\nTZID:America/Toronto\r\n" in out
    assert out.endswith("END:VCALENDAR\r\n")
    assert "\n" not in out.replace("\r\n", "")  # every line ends with CRLF


def test_timed_event_fields_only():
    out = render_feed([occ()], STAMP)
    assert "UID:7-2026-11-05@kmk-entretien.ca\r\n" in out
    assert "DTSTAMP:20261126T120000Z\r\n" in out
    assert "DTSTART;TZID=America/Toronto:20261105T090000\r\n" in out
    assert "DTEND;TZID=America/Toronto:20261105T100000\r\n" in out
    assert "SUMMARY:Visit\r\n" in out
    assert "SECRET" not in out and "DESCRIPTION" not in out and "LOCATION" not in out


def test_moved_occurrence_keeps_original_uid():
    out = render_feed([occ(original_date=date(2026, 11, 5), date=date(2026, 11, 6))], STAMP)
    assert "UID:7-2026-11-05@kmk-entretien.ca\r\n" in out and "DTSTART;TZID=America/Toronto:20261106T090000\r\n" in out


def test_all_day_dates():
    out = render_feed([occ(all_day=True, start_time=None, end_time=None)], STAMP)
    assert "DTSTART;VALUE=DATE:20261105\r\n" in out and "DTEND;VALUE=DATE:20261106\r\n" in out


def test_escapes_and_folds_utf8():
    assert escape_text("a,b;c\\d\ne") == "a\\,b\;c\\\\d\\ne"
    assert escape_text("x\r\ny") == "x\\ny"
    line = "SUMMARY:" + "é" * 60
    folded = fold(line)
    parts = folded.split("\r\n ")
    assert len(parts) > 1
    assert all(len(p.encode()) <= 75 for p in parts)
    assert "".join(parts) == line  # no character split
    assert fold("SUMMARY:short") == "SUMMARY:short"


def test_summary_is_escaped_in_feed():
    out = render_feed([occ(title="Smith, Inc; floor 2")], STAMP)
    assert "SUMMARY:Smith\\, Inc\; floor 2\r\n" in out
