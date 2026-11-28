import threading
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from helpers import sql
from test_clients_api import add
from test_properties_api import add_prop, prop_body
from test_schedule_api import body, create, session, uid

TODAY = "2026-11-05"  # a Thursday
NOW = datetime(2026, 11, 5, 13, 0, tzinfo=timezone.utc)  # 08:00 in Toronto
NOT_FOUND = {"error": "not_found"}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    from app.visits import service

    state = {"now": NOW}
    monkeypatch.setattr(service, "now", lambda: state["now"])
    return state


@pytest.fixture
def team(make_client, add_user, owner_engine):
    boss = session(make_client, add_user, "boss", role="admin")
    staff = {n: session(make_client, add_user, n) for n in ("ana", "bruno", "carla", "dan")}
    ids = {n: uid(owner_engine, n) for n in ("boss", *staff)}
    c, h = boss
    cid = add(c, h, name="Tremblay").json()["client"]["id"]
    pid = add_prop(c, h, cid).json()["property"]["id"]
    r = create(c, h, title="Ménage", start_date=TODAY, client_id=cid, property_id=pid, people=[ids["ana"], ids["bruno"], ids["carla"]])
    assert r.status_code == 201, r.text
    return SimpleNamespace(boss=boss, ids=ids, cid=cid, pid=pid, eid=r.json()["event"]["id"], **staff)


def url(t, day=TODAY, eid=None):
    return f"/api/visits/{eid or t.eid}/{day}"


def read(s, t, **kw):
    return s[0].get(url(t, **kw))


def checkin(s, t, people, **kw):
    c, h = s
    return c.post(url(t, **kw) + "/checkin", json={"people": people}, headers=h)


def checkout(s, t, confirm=False, **kw):
    c, h = s
    return c.post(url(t, **kw) + "/checkout", json={"confirm_no_photos": confirm}, headers=h)


def today(s):
    r = s[0].get("/api/visits/today")
    assert r.status_code == 200, r.text
    return r.json()["visits"]


def ok(r):
    assert r.status_code == 200, r.text
    return r.json()["visit"]


def people_of(visit):
    return [(p["name"], p["checked_in_by_name"], p["self"]) for p in visit["people"]]


def test_today_route_is_not_swallowed_by_the_visit_route(team):
    r = team.ana[0].get("/api/visits/today")
    assert r.status_code == 200, r.text
    assert "visits" in r.json()


def test_today_lists_my_visits_only(team):
    c, h = team.boss
    ids = team.ids
    early = create(c, h, title="Early", start_date=TODAY, start_time="07:00", client_id=team.cid, property_id=team.pid, people=[ids["ana"]]).json()["event"]["id"]
    create(c, h, title="Dan's", start_date=TODAY, client_id=team.cid, property_id=team.pid, people=[ids["dan"]])
    create(c, h, title="Tomorrow", start_date="2026-11-06", client_id=team.cid, property_id=team.pid, people=[ids["ana"]])
    create(c, h, title="Meeting", start_date=TODAY, people=[ids["ana"]])  # no property: no visit

    mine = today(team.ana)
    assert [(v["event_id"], v["title"]) for v in mine] == [(early, "Early"), (team.eid, "Ménage")]
    v = mine[1]
    assert (v["id"], v["state"], v["occurrence_date"], v["date"]) == (None, "not_started", TODAY, TODAY)
    assert (v["client_name"], v["property_name"], v["property_id"]) == ("Tremblay", "Beach house", team.pid)
    assert (v["photos_required"], v["rooms"], v["people"], v["photos"], v["skips"], v["corrections"]) == (False, [], [], [], [], [])
    assert (v["closed_at"], v["closed_by_name"], v["closed_without_photos"], v["corrected"], v["can_correct_until"]) == (None, None, False, False, None)
    assert sorted(p["name"] for p in v["listed"]) == ["ana", "bruno", "carla"]
    assert [v["title"] for v in today(team.dan)] == ["Dan's"]
    assert today(team.boss) == []  # admins see every visit, but "today" is the ones that list me


def test_first_arrival_checks_in_self_and_colleagues(team, owner_engine):
    v = ok(checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]]))
    assert v["state"] == "in_progress" and v["id"] is not None
    assert people_of(v) == [("ana", "ana", True), ("bruno", "ana", False)]
    assert all(p["checked_in_at"] == NOW.isoformat() for p in v["people"])
    assert people_of(ok(read(team.bruno, team))) == people_of(v)
    row = sql(owner_engine, "SELECT event_id, occurrence_date, visit_date, client_name, property_name, property_id, client_id FROM visits")
    assert [tuple(r) for r in row] == [(team.eid, date(2026, 11, 5), date(2026, 11, 5), "Tremblay", "Beach house", team.pid, team.cid)]
    audit = sql(owner_engine, "SELECT actor_user_id, details FROM audit_log WHERE action = 'visit_checkin'")
    assert len(audit) == 1 and audit[0][0] == team.ids["ana"] and audit[0][1]["visit_id"] == v["id"]


def test_late_arrival_checks_in_self(team, clock):
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    r = checkin(team.carla, team, [team.ids["bruno"]])  # not checked in yet: may not mark someone else
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    clock["now"] = datetime(2026, 11, 5, 14, 15, tzinfo=timezone.utc)
    v = ok(checkin(team.carla, team, [team.ids["carla"]]))
    assert people_of(v) == [("ana", "ana", True), ("carla", "carla", True)]
    assert [p["checked_in_at"] for p in v["people"]] == [NOW.isoformat(), clock["now"].isoformat()]
    assert all(p["user_id"] != team.ids["bruno"] for p in v["people"])


def test_person_not_listed_cannot_check_in_or_be_marked(team):
    r = checkin(team.ana, team, [team.ids["ana"], team.ids["dan"]])
    assert (r.status_code, r.json()) == (403, {"error": "not_listed"})
    assert ok(read(team.ana, team))["people"] == []  # nothing recorded, not even ana
    r = checkin(team.boss, team, [team.ids["boss"]])  # an admin sees every visit but checks in only where listed
    assert (r.status_code, r.json()) == (403, {"error": "not_listed"})
    r = checkin(team.dan, team, [team.ids["dan"]])  # cannot see it at all
    assert (r.status_code, r.json()) == (404, NOT_FOUND)


def test_check_in_twice_is_409(team, owner_engine):
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    r = checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    assert (r.status_code, r.json()) == (409, {"error": "already_checked_in"})
    ok(checkin(team.ana, team, [team.ids["bruno"]]))
    r = checkin(team.bruno, team, [team.ids["bruno"]])
    assert (r.status_code, r.json()) == (409, {"error": "already_checked_in"})
    counts = sql(owner_engine, "SELECT user_id, count(*) FROM visit_people WHERE withdrawn_at IS NULL GROUP BY user_id ORDER BY user_id")
    assert [tuple(r) for r in counts] == sorted([(team.ids["ana"], 1), (team.ids["bruno"], 1)])


def test_double_submission_records_once(team, owner_engine):
    """Review Focus 3: a double tap on Check-in or Check-out never makes a second row or a second close."""
    first, second = checkin(team.ana, team, [team.ids["ana"]]), checkin(team.ana, team, [team.ids["ana"]])
    assert first.status_code == 200 and (second.status_code, second.json()) == (409, {"error": "already_checked_in"})
    assert sql(owner_engine, "SELECT count(*) FROM visit_people WHERE withdrawn_at IS NULL")[0][0] == 1
    first, second = checkout(team.ana, team, True), checkout(team.ana, team, True)
    assert first.status_code == 200 and (second.status_code, second.json()) == (409, {"error": "already_closed"})
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'visit_checkout'")[0][0] == 1


def test_not_today_is_422(team, clock):
    for moment in (datetime(2026, 11, 6, 5, 0, tzinfo=timezone.utc), datetime(2026, 11, 4, 23, 0, tzinfo=timezone.utc)):
        clock["now"] = moment  # 00:00 on the 6th and 18:00 on the 4th in Toronto
        r = checkin(team.ana, team, [team.ids["ana"]])
        assert (r.status_code, r.json()) == (422, {"error": "not_today"})
    clock["now"] = datetime(2026, 11, 6, 4, 59, tzinfo=timezone.utc)  # 23:59 on the 5th in Toronto, already the 6th in UTC
    ok(checkin(team.ana, team, [team.ids["ana"]]))


def test_moved_occurrence_is_checked_in_on_its_actual_date(team, owner_engine):
    c, h = team.boss
    eid = create(c, h, title="Moved", start_date="2026-11-04", client_id=team.cid, property_id=team.pid, people=[team.ids["ana"]]).json()["event"]["id"]
    sql(owner_engine, "INSERT INTO event_exceptions (event_id, original_date, cancelled, start_date) VALUES (:e, '2026-11-04', false, '2026-11-05')", e=eid)
    assert [(v["occurrence_date"], v["date"]) for v in today(team.ana) if v["event_id"] == eid] == [("2026-11-04", TODAY)]
    v = ok(checkin(team.ana, team, [team.ids["ana"]], eid=eid, day="2026-11-04"))
    assert (v["occurrence_date"], v["date"]) == ("2026-11-04", TODAY)
    assert sql(owner_engine, "SELECT visit_date FROM visits WHERE event_id = :e", e=eid)[0][0] == date(2026, 11, 5)
    r = checkin(team.ana, team, [team.ids["ana"]], eid=eid, day=TODAY)  # not an occurrence of that event
    assert (r.status_code, r.json()) == (404, NOT_FOUND)


def test_cancelled_occurrence_has_no_visit(team, owner_engine):
    sql(owner_engine, "INSERT INTO event_exceptions (event_id, original_date, cancelled) VALUES (:e, :d, true)", e=team.eid, d=date(2026, 11, 5))
    assert (read(team.ana, team).status_code, checkin(team.ana, team, [team.ids["ana"]]).status_code) == (404, 404)
    assert today(team.ana) == []


def test_far_dates_never_fail(team):
    c, h = team.boss
    weekly = {"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": None, "nth_weekdays": []}
    series = create(c, h, title="Weekly", start_date=TODAY, recurrence=weekly, client_id=team.cid, property_id=team.pid, people=[team.ids["ana"]]).json()["event"]["id"]
    for eid in (team.eid, series):
        for day in ("0001-01-01", "9999-12-31"):
            assert (read(team.ana, team, eid=eid, day=day).status_code, read(team.dan, team, eid=eid, day=day).status_code) == (404, 404), (eid, day)
    # 9999-12-30 is a Thursday: a real (far) occurrence of the endless series, readable, but not open for check-in
    assert (read(team.ana, team, eid=series, day="9999-12-30").status_code, read(team.dan, team, eid=series, day="9999-12-30").status_code) == (200, 404)
    r = checkin(team.ana, team, [team.ids["ana"]], eid=series, day="9999-12-30")
    assert (r.status_code, r.json()) == (422, {"error": "not_today"})


def test_checkout_by_any_checked_in_person_closes_for_all(team, owner_engine):
    r = checkout(team.ana, team, True)  # nobody checked in yet
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    ok(checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]]))
    r = checkout(team.carla, team, True)  # listed, but not checked in
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    v = ok(checkout(team.bruno, team, True))
    assert (v["state"], v["closed_by_name"], v["closed_at"]) == ("closed", "bruno", NOW.isoformat())
    seen = ok(read(team.ana, team))
    assert seen["state"] == "closed" and [p["name"] for p in seen["people"]] == ["ana", "bruno"]
    assert sql(owner_engine, "SELECT closed_by FROM visits")[0][0] == team.ids["bruno"]


def test_checkout_without_photos_needs_confirmation(team, owner_engine):
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    r = checkout(team.ana, team, False)
    assert (r.status_code, r.json()) == (409, {"error": "no_photos"})
    assert ok(read(team.ana, team))["state"] == "in_progress"
    v = ok(checkout(team.ana, team, True))
    assert (v["state"], v["closed_without_photos"]) == ("closed", True)
    audit = sql(owner_engine, "SELECT actor_user_id, details FROM audit_log WHERE action = 'visit_checkout'")
    assert len(audit) == 1 and audit[0][0] == team.ids["ana"] and audit[0][1]["visit_id"] == v["id"]


def add_photo(owner_engine, visit_id, room_id, room_name, deleted=False):
    sql(
        owner_engine,
        "INSERT INTO visit_photos (visit_id, file_id, room_id, room_name, content_type, size, sha256, deleted_at) "
        "VALUES (:v, md5(random()::text), :r, :n, 'image/webp', 100, 'x', CASE WHEN :d THEN now() END)",
        v=visit_id, r=room_id, n=room_name, d=deleted,
    )


def test_photos_required_blocks_checkout_with_missing_rooms(team, owner_engine):
    c, h = team.boss
    assert c.patch(f"/api/properties/{team.pid}", json=prop_body(photos_required=True), headers=h).status_code == 200
    rooms = c.put(f"/api/properties/{team.pid}/rooms", json={"rooms": [{"id": None, "name": "Kitchen"}, {"id": None, "name": "Bath"}]}, headers=h).json()["rooms"]
    v = ok(checkin(team.ana, team, [team.ids["ana"]]))
    assert v["photos_required"] is True and [r["name"] for r in v["rooms"]] == ["Kitchen", "Bath"]
    r = checkout(team.ana, team, True)
    assert (r.status_code, r.json()) == (409, {"error": "rooms_missing", "rooms": ["Kitchen", "Bath"]})
    add_photo(owner_engine, v["id"], rooms[0]["id"], "Kitchen")
    add_photo(owner_engine, v["id"], rooms[1]["id"], "Bath", deleted=True)  # a removed photo does not count
    r = checkout(team.ana, team, True)
    assert (r.status_code, r.json()) == (409, {"error": "rooms_missing", "rooms": ["Bath"]})
    sql(owner_engine, "INSERT INTO visit_room_skips (visit_id, room_id, room_name, reason) VALUES (:v, :r, 'Bath', 'locked')", v=v["id"], r=rooms[1]["id"])
    v = ok(checkout(team.ana, team, False))  # there is a photo: no confirmation needed
    assert (v["state"], v["closed_without_photos"]) == ("closed", False)


def test_second_checkout_is_409(team):
    ok(checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]]))
    ok(checkout(team.ana, team, True))
    for who in (team.bruno, team.ana):
        r = checkout(who, team, True)
        assert (r.status_code, r.json()) == (409, {"error": "already_closed"})


def test_no_checkin_after_close(team, owner_engine):
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    ok(checkout(team.ana, team, True))
    for who, person in ((team.carla, "carla"), (team.ana, "bruno")):
        r = checkin(who, team, [team.ids[person]])
        assert (r.status_code, r.json()) == (409, {"error": "already_closed"})
    assert sql(owner_engine, "SELECT count(*) FROM visit_people")[0][0] == 1


def test_staff_not_on_visit_gets_404(team):
    """Review Focus 1: a visit that does not list me answers exactly like one that does not exist."""
    missing = [
        ("GET", "/api/visits/99999999/2026-11-05", None),
        ("GET", url(team, day="2026-11-06"), None),
    ]
    ok(checkin(team.ana, team, [team.ids["ana"]]))  # started, so a visit row exists
    c, h = team.dan
    calls = [
        ("GET", url(team), None),
        ("POST", url(team) + "/checkin", {"people": [team.ids["dan"]]}),
        ("POST", url(team) + "/checkin", {"people": [team.ids["ana"]]}),
        ("POST", url(team) + "/checkout", {"confirm_no_photos": True}),
    ]
    for method, path, payload in missing + calls:
        r = c.request(method, path, json=payload, headers=h)
        assert (r.status_code, r.json()) == (404, NOT_FOUND), path
    for method, path, payload in [("POST", "/api/visits/99999999/2026-11-05/checkin", {"people": [team.ids["dan"]]}), ("POST", "/api/visits/99999999/2026-11-05/checkout", {"confirm_no_photos": True})]:
        r = c.request(method, path, json=payload, headers=h)
        assert (r.status_code, r.json()) == (404, NOT_FOUND), path
    assert today(team.dan) == []
    assert ok(read(team.boss, team))["people"][0]["name"] == "ana"  # admins see every visit


def test_visit_survives_agenda_changes(team, owner_engine):
    """Review Focus 2: the record outlives the Agenda; a person taken off the Agenda item cannot check in again."""
    ids = team.ids
    v = ok(checkin(team.ana, team, [ids["ana"], ids["bruno"]]))
    c, h = team.boss
    r = c.patch(f"/api/schedule/events/{team.eid}", json=body(title="Ménage", start_date=TODAY, client_id=team.cid, property_id=team.pid, people=[ids["ana"], ids["carla"]]), headers=h)
    assert r.status_code == 200, r.text
    seen = ok(read(team.bruno, team))  # still sees the visit he is checked in on, and stays on it
    assert [p["name"] for p in seen["people"]] == ["ana", "bruno"] and sorted(p["name"] for p in seen["listed"]) == ["ana", "carla"]
    r = checkin(team.bruno, team, [ids["bruno"]])
    assert (r.status_code, r.json()) == (403, {"error": "not_listed"})
    r = checkin(team.ana, team, [ids["bruno"]])
    assert (r.status_code, r.json()) == (403, {"error": "not_listed"})

    assert c.delete(f"/api/properties/{team.pid}", headers=h).status_code == 204
    after = ok(read(team.boss, team))
    assert (after["property_name"], after["client_name"], after["property_id"]) == ("Beach house", "Tremblay", None)
    assert [p["name"] for p in after["people"]] == ["ana", "bruno"]

    assert c.delete(f"/api/schedule/events/{team.eid}", headers=h).status_code == 200
    assert c.delete(f"/api/clients/{team.cid}", headers=h).status_code == 204
    row = sql(owner_engine, "SELECT event_id, property_id, client_id, property_name, client_name, visit_date FROM visits WHERE id = :v", v=v["id"])
    assert [tuple(r) for r in row] == [(None, None, None, "Beach house", "Tremblay", date(2026, 11, 5))]
    names = sql(owner_engine, "SELECT user_name FROM visit_people WHERE visit_id = :v AND withdrawn_at IS NULL ORDER BY id", v=v["id"])
    assert [r[0] for r in names] == ["ana", "bruno"]


def test_event_without_property_has_no_visit(team):
    c, h = team.boss
    eid = create(c, h, title="Meeting", start_date=TODAY, client_id=team.cid, people=[team.ids["ana"]]).json()["event"]["id"]
    assert (read(team.ana, team, eid=eid).status_code, read(team.boss, team, eid=eid).status_code) == (404, 404)
    r = checkin(team.ana, team, [team.ids["ana"]], eid=eid)
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    assert [v["event_id"] for v in today(team.ana)] == [team.eid]


def test_bad_bodies_are_refused(team):
    c, h = team.ana
    for payload in ({"people": []}, {"people": [0]}, {"people": [team.ids["ana"]], "extra": 1}, {}):
        assert c.post(url(team) + "/checkin", json=payload, headers=h).status_code == 422, payload
    assert c.post(url(team) + "/checkout", json={"confirm_no_photos": True, "x": 1}, headers=h).status_code == 422


# ---- two requests at the same moment (Review Focus 3) ----------------------------------------------------------------


def _users(db, *ids):
    from app.models import User

    return [db.get(User, i) for i in ids]


def _race(engine, first, second):
    """Run `first` in one transaction and, while it is still open, `second` in another; returns what `second` raised."""
    result: dict = {}
    a, b = Session(engine), Session(engine)
    try:
        first(a)

        def run():
            try:
                second(b)
                b.commit()
            except Exception as e:  # noqa: BLE001 - reported to the test
                b.rollback()
                result["error"] = e

        t = threading.Thread(target=run)
        t.start()
        t.join(0.5)
        assert t.is_alive(), "the second request must wait for the first one's lock"
        a.commit()
        t.join(10)
        assert not t.is_alive()
    finally:
        a.close()
        b.close()
    return result.get("error")


@pytest.fixture
def race_engine(owner_engine):
    engine = create_engine(owner_engine.url, poolclass=NullPool)
    yield engine
    engine.dispose()


def test_simultaneous_first_checkins_make_one_visit(team, race_engine, owner_engine):
    from app.visits import service

    day = date(2026, 11, 5)
    ana_id, bruno_id = team.ids["ana"], team.ids["bruno"]
    error = _race(
        race_engine,
        lambda db: service.check_in(db, _users(db, ana_id)[0], team.eid, day, [ana_id], NOW, "127.0.0.1"),
        lambda db: service.check_in(db, _users(db, bruno_id)[0], team.eid, day, [bruno_id], NOW, "127.0.0.1"),
    )
    assert error is None
    assert sql(owner_engine, "SELECT count(*) FROM visits")[0][0] == 1
    assert sql(owner_engine, "SELECT count(*) FROM visit_people")[0][0] == 2


def test_simultaneous_checkouts_one_wins(team, race_engine, owner_engine):
    from app.auth.errors import ApiError
    from app.visits import service

    day = date(2026, 11, 5)
    ok(checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]]))
    ana_id, bruno_id = team.ids["ana"], team.ids["bruno"]
    error = _race(
        race_engine,
        lambda db: service.check_out(db, _users(db, ana_id)[0], team.eid, day, True, NOW, "127.0.0.1"),
        lambda db: service.check_out(db, _users(db, bruno_id)[0], team.eid, day, True, NOW, "127.0.0.1"),
    )
    assert isinstance(error, ApiError) and (error.status, error.code) == (409, "already_closed")
    assert sql(owner_engine, "SELECT closed_by FROM visits")[0][0] == ana_id
