from sqlalchemy import text

from helpers import ORIGIN, PW, login

# On the wire a city name is UTF-8 bytes; the server sees them decoded as latin-1.
GEO = {"X-Geo-Country": "CA", "X-Geo-City": "Montréal".encode("utf-8")}


def row(owner_engine):
    with owner_engine.begin() as c:
        return c.execute(text("SELECT last_ip, country, city, last_seen_at FROM sessions")).one()


def test_login_records_the_place(client, add_user, owner_engine):
    add_user("alice", "alice@example.com")
    assert login(client, "alice", headers={**ORIGIN, **GEO}).status_code == 200
    r = row(owner_engine)
    assert (r.country, r.city) == ("CA", "Montréal")


def test_garbage_location_never_breaks_login(client, add_user, owner_engine):
    add_user("alice", "alice@example.com")
    bad = {"X-Geo-Country": "<script>", "X-Geo-City": "\x01" * 5}
    assert login(client, "alice", headers={**ORIGIN, **bad}).status_code == 200
    r = row(owner_engine)
    assert r.country is None and r.city is None


def test_a_request_updates_last_access_at_most_every_five_minutes(client, add_user, owner_engine):
    add_user("alice", "alice@example.com")
    login(client, "alice", headers={**ORIGIN, **GEO})
    with owner_engine.begin() as c:
        c.execute(text("UPDATE sessions SET last_seen_at = now() - interval '10 minutes', city = NULL"))
    before = row(owner_engine).last_seen_at
    assert client.get("/api/auth/me", headers=GEO).status_code == 200
    first = row(owner_engine)
    assert first.last_seen_at > before and first.city == "Montréal"
    # A second request right after changes nothing, even from a "different" place.
    assert client.get("/api/auth/me", headers={"X-Geo-Country": "US", "X-Geo-City": "Boston"}).status_code == 200
    second = row(owner_engine)
    assert second.last_seen_at == first.last_seen_at and second.city == "Montréal"


def test_location_headers_are_ignored_from_an_untrusted_peer(make_client, add_user, owner_engine):
    add_user("alice", "alice@example.com")
    c = make_client(peer="203.0.113.9")
    assert login(c, "alice", headers={**ORIGIN, **GEO}).status_code == 200
    r = row(owner_engine)
    assert r.country is None and r.city is None
