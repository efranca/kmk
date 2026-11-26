"""Writing a personal calendar feed as iCalendar text (RFC 5545).

Pure: no database, no clock. Only the title and the times of each occurrence are written; nothing else about an
event (notes, people, icon, reminders) ever reaches the feed.
"""

from datetime import datetime, timedelta, timezone

from app.schedule.occurrences import Occurrence

TZID = "America/Toronto"
UID_DOMAIN = "kmk-entretien.ca"
MAX_LINE_OCTETS = 75

# The company time zone's rules since 2007 (second Sunday of March, first Sunday of November).
_VTIMEZONE = [
    "BEGIN:VTIMEZONE",
    f"TZID:{TZID}",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "END:STANDARD",
    "END:VTIMEZONE",
]


def escape_text(s: str) -> str:
    """A TEXT value: backslash first, then the separators, and any line break as \\n."""
    s = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return s.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")


def fold(line: str) -> str:
    """Split a content line into pieces of at most 75 octets (continuations start with a space), never inside a
    UTF-8 character."""
    parts: list[str] = []
    current, size, limit = "", 0, MAX_LINE_OCTETS
    for ch in line:
        n = len(ch.encode())
        if size + n > limit:
            parts.append(current)
            current, size, limit = "", 0, MAX_LINE_OCTETS - 1  # the leading space counts
        current += ch
        size += n
    parts.append(current)
    return "\r\n ".join(parts)


def _event_lines(o: Occurrence, stamp: str) -> list[str]:
    lines = ["BEGIN:VEVENT", f"UID:{o.event_id}-{o.original_date.isoformat()}@{UID_DOMAIN}", f"DTSTAMP:{stamp}"]
    if o.all_day or o.start_time is None:
        lines.append(f"DTSTART;VALUE=DATE:{o.date:%Y%m%d}")
        lines.append(f"DTEND;VALUE=DATE:{o.date + timedelta(days=1):%Y%m%d}")
    else:
        end = o.end_time or o.start_time
        lines.append(f"DTSTART;TZID={TZID}:{o.date:%Y%m%d}T{o.start_time:%H%M%S}")
        lines.append(f"DTEND;TZID={TZID}:{o.date:%Y%m%d}T{end:%H%M%S}")
    lines.append(f"SUMMARY:{escape_text(o.title)}")
    lines.append("END:VEVENT")
    return lines


def render_feed(occurrences: list[Occurrence], stamp: datetime) -> str:
    """The whole calendar, with CRLF line endings."""
    dtstamp = stamp.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//KMK Entretien//Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:KMK",
        f"X-WR-TIMEZONE:{TZID}",
        *_VTIMEZONE,
    ]
    for o in occurrences:
        lines.extend(_event_lines(o, dtstamp))
    lines.append("END:VCALENDAR")
    return "".join(fold(line) + "\r\n" for line in lines)
