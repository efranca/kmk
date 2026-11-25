import hashlib

import pytest

from app.quotes import arrival, limits
from helpers import ORIGIN, sql

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
HEIC = b"\x00\x00\x00\x18ftypheic" + b"0" * 100


def qbody(**kw):
    base = dict(
        name="Maria Silva", email="Maria@Example.com", phone="418-555-0100", locale="fr-CA", kind="airbnb", city="Québec",
        property="apartment", bedrooms=2, bathrooms=1.5, frequency="weekly",
    )
    base.update(kw)
    return base


def hdr(ip="203.0.113.7", **extra):
    return {**ORIGIN, "X-Real-Client-Ip": ip, **extra}


def start(c, ip="203.0.113.7", **kw):
    return c.post("/api/public/quotes", json=qbody(**kw), headers=hdr(ip))


def photo(c, qid, token, data=JPEG):
    return c.put(f"/api/public/quotes/{qid}/photos", content=data, headers={**ORIGIN, "X-Quote-Token": token})


def submit(c, qid, token):
    return c.post(f"/api/public/quotes/{qid}/submit", headers={**ORIGIN, "X-Quote-Token": token})


def draft_row(owner_engine, token="tok", hours_old=0, ip="9.9.9.9"):
    return sql(
        owner_engine,
        "INSERT INTO quotes (kind, name, email, phone, locale, ip, ip_key, token_hash, created_at) "
        "VALUES ('airbnb', 'N', 'n@example.com', '4185550100', 'fr-CA', :ip, :ip, :h, now() - make_interval(hours => :hrs)) RETURNING id",
        ip=ip, h=hashlib.sha256(token.encode()).hexdigest(), hrs=hours_old,
    )[0][0]


def test_draft_photo_submit_happy_path(client, owner_engine):
    r = client.post("/api/public/quotes", json=qbody(message="Beaucoup de détails"), headers=hdr() | {"User-Agent": "TestAgent/1", "X-Geo-Country": "CA", "X-Geo-City": "Quebec"})
    assert r.status_code == 201, r.text
    qid, token = r.json()["id"], r.json()["token"]
    assert photo(client, qid, token).status_code == 201
    assert photo(client, qid, token, PNG).json()["photo"]["content_type"] == "image/png"
    done = submit(client, qid, token)
    assert done.status_code == 200 and done.json() == {"reference": f"D-{qid:04d}"}
    row = sql(owner_engine, "SELECT status, email, ip, geo_country, geo_city, user_agent, locale, details->>'city', (details->>'bedrooms')::int, deadline_at - submitted_at, message FROM quotes")[0]
    assert tuple(row[:4]) == ("new", "maria@example.com", "203.0.113.7", "CA")
    assert row[4] == "Quebec" and row[5] == "TestAgent/1" and row[6] == "fr-CA" and row[7] == "Québec" and row[8] == 2
    assert row[9].total_seconds() == 24 * 3600 and row[10] == "Beaucoup de détails"
    assert sql(owner_engine, "SELECT count(*) FROM quote_photos")[0][0] == 2
    audit = sql(owner_engine, "SELECT ip, details::text FROM audit_log WHERE action = 'quote_received'")
    assert len(audit) == 1 and audit[0][0] == "203.0.113.7" and "maria" not in audit[0][1].lower()


def test_eleventh_request_in_an_hour_is_rate_limited(client):
    for _ in range(10):
        assert start(client).status_code == 201
    r = start(client)
    assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
    assert start(client, ip="198.51.100.9").status_code == 201


def test_ipv6_counts_per_slash_64(client):
    for i in range(10):
        assert start(client, ip=f"2001:db8:1:2::{i + 1}").status_code == 201
    assert start(client, ip="2001:db8:1:2:ffff::1").status_code == 429
    assert start(client, ip="2001:db8:1:3::1").status_code == 201


def test_requests_older_than_an_hour_do_not_count(client, owner_engine):
    for _ in range(10):
        start(client)
    sql(owner_engine, "UPDATE quotes SET created_at = now() - interval '61 minutes'")
    assert start(client).status_code == 201


def test_message_word_and_char_limits(client):
    assert start(client, message="word " * 2000).status_code == 201
    too = start(client, message="word " * 2001)
    assert too.status_code == 422 and too.json() == {"error": "too_long"}
    assert start(client, message="é" * 20000).status_code == 201
    assert start(client, message="é" * 20001).json() == {"error": "too_long"}


def test_commercial_needs_a_message_and_airbnb_does_not(client):
    commercial = dict(kind="commercial", property="office", frequency="weekly", message=None)
    for key in ("bedrooms", "bathrooms"):
        commercial[key] = None
    assert start(client, **commercial).status_code == 422
    assert start(client, **{**commercial, "message": "Clinique de 3000 pi²"}).status_code == 201
    assert start(client, message=None).status_code == 201


def test_airbnb_fields_are_refused_on_commercial(client):
    r = start(client, kind="commercial", property="office", frequency="weekly", message="x", bedrooms=3)
    assert r.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [dict(email="nope"), dict(phone="call me"), dict(name=""), dict(locale="en"), dict(kind="villa"), dict(frequency="daily"), dict(bedrooms=21), dict(city="")],
)
def test_invalid_fields_are_refused(client, bad):
    assert start(client, **bad).status_code == 422


def test_honeypot_stores_nothing(client, owner_engine):
    r = start(client, website="http://spam.example")
    assert r.status_code == 201 and r.json()["id"] == 0
    assert submit(client, 0, r.json()["token"]).json() == {"reference": "D-0000"}
    assert sql(owner_engine, "SELECT count(*) FROM quotes")[0][0] == 0


def test_photo_rules(client, owner_engine):
    a = start(client).json()
    b = start(client).json()
    assert photo(client, a["id"], "wrong").status_code == 404
    assert photo(client, a["id"], b["token"]).status_code == 404
    r = photo(client, a["id"], a["token"], b"%PDF-1.4 not a photo")
    assert r.status_code == 422 and r.json() == {"error": "unsupported_type"}
    assert photo(client, a["id"], a["token"], HEIC).status_code == 201
    big = JPEG + b"0" * (limits.MAX_PHOTO_BYTES - len(JPEG) + 1)
    assert photo(client, a["id"], a["token"], big).json() == {"error": "file_too_large"}
    for _ in range(9):
        assert photo(client, a["id"], a["token"]).status_code == 201
    assert photo(client, a["id"], a["token"]).json() == {"error": "too_many_photos"}
    assert submit(client, a["id"], a["token"]).status_code == 200
    assert photo(client, a["id"], a["token"]).status_code == 404  # after submit
    old = draft_row(owner_engine, token="old", hours_old=3)
    assert photo(client, old, "old").status_code == 404


def test_pending_photo_storage_cap_answers_busy(client, monkeypatch):
    a = start(client).json()
    monkeypatch.setattr(limits, "MAX_PENDING_PHOTO_BYTES", 10)
    r = photo(client, a["id"], a["token"])
    assert r.status_code == 503 and r.json() == {"error": "busy"}


def test_submit_twice_is_idempotent(client, monkeypatch):
    calls = {"arrive": 0, "notify": 0}
    monkeypatch.setattr(arrival, "on_submitted", lambda db, quote: calls.__setitem__("arrive", calls["arrive"] + 1))
    monkeypatch.setattr(arrival, "notify", lambda engine, settings, quote_id: calls.__setitem__("notify", calls["notify"] + 1))
    a = start(client).json()
    first, second = submit(client, a["id"], a["token"]), submit(client, a["id"], a["token"])
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    assert calls == {"arrive": 1, "notify": 1}
    assert submit(client, a["id"], "wrong").status_code == 404


def test_expired_drafts_are_cleaned_when_the_next_request_starts(client, owner_engine):
    old = draft_row(owner_engine, hours_old=3)
    sql(owner_engine, "INSERT INTO quote_photos (quote_id, content_type, size, data) VALUES (:q, 'image/png', 3, 'abc')", q=old)
    fresh = draft_row(owner_engine, token="fresh", hours_old=1, ip="8.8.8.8")
    assert start(client).status_code == 201
    ids = [r[0] for r in sql(owner_engine, "SELECT id FROM quotes WHERE id IN (:a, :b)", a=old, b=fresh)]
    assert ids == [fresh]
    assert sql(owner_engine, "SELECT count(*) FROM quote_photos")[0][0] == 0


def test_config_returns_only_the_phone(client, owner_engine):
    sql(owner_engine, "INSERT INTO app_settings (key, value) VALUES ('public_phone', '(418) 555-0100'), ('quote_from', 'secret@example.com')")
    r = client.get("/api/public/quotes/config")
    assert r.status_code == 200 and r.json() == {"phone": "(418) 555-0100"}
