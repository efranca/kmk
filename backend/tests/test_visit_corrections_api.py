"""Visit corrections: the original is never erased, every change after the fact is appended with who, when, what and why
(spec section 10; Review Focus 5 for the window)."""

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.pool import NullPool

from helpers import ORIGIN, login, sql
from test_clients_api import add
from test_properties_api import add_prop, prop_body
from test_schedule_api import create, uid
from test_visit_photos_api import hostile, image
from test_visits_api import NOT_FOUND, NOW, TODAY, _race, _users

from app.visits import storage

NEXT_DAY = datetime(2026, 11, 6, 15, 0, tzinfo=timezone.utc)  # 10:00 in Toronto, the day after the visit
WINDOW_END = "2026-11-07T05:00:00+00:00"  # 2026-11-07 00:00 in Toronto (EST)
PAST_WINDOW = datetime(2026, 11, 7, 5, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    from app.visits import service

    state = {"now": NOW}
    monkeypatch.setattr(service, "now", lambda: state["now"])
    return state


@pytest.fixture
def team(make_client, add_user, owner_engine, tmp_path):
    def session(name, role="user"):
        add_user(name, f"{name}@example.com", role=role)
        c = make_client(visit_photos_dir=str(tmp_path))
        token = login(c, name).json()["csrf_token"]
        return c, {**ORIGIN, "X-CSRF-Token": token}

    boss = session("boss", "admin")
    staff = {n: session(n) for n in ("ana", "bruno", "carla", "dan")}
    ids = {n: uid(owner_engine, n) for n in ("boss", *staff)}
    c, h = boss
    cid = add(c, h, name="Tremblay").json()["client"]["id"]
    pid = add_prop(c, h, cid).json()["property"]["id"]
    rooms = c.put(f"/api/properties/{pid}/rooms", json={"rooms": [{"id": None, "name": "Kitchen"}, {"id": None, "name": "Bath"}]}, headers=h).json()["rooms"]
    r = create(c, h, title="Ménage", start_date=TODAY, client_id=cid, property_id=pid, people=[ids["ana"], ids["bruno"], ids["carla"]])
    assert r.status_code == 201, r.text
    return SimpleNamespace(boss=boss, ids=ids, cid=cid, pid=pid, rooms=rooms, eid=r.json()["event"]["id"], root=tmp_path, **staff)


def url(t, day=TODAY, eid=None):
    return f"/api/visits/{eid or t.eid}/{day}"


def read(s, t, **kw):
    r = s[0].get(url(t, **kw))
    assert r.status_code == 200, r.text
    return r.json()["visit"]


def checkin(s, t, people, **kw):
    r = s[0].post(url(t, **kw) + "/checkin", json={"people": people}, headers=s[1])
    assert r.status_code == 200, r.text
    return r.json()["visit"]


def checkout(s, t, **kw):
    r = s[0].post(url(t, **kw) + "/checkout", json={"confirm_no_photos": True}, headers=s[1])
    assert r.status_code == 200, r.text
    return r.json()["visit"]


def correct(s, t, kind, reason="forgot", user_id=None, **kw):
    payload = {"kind": kind, "reason": reason}
    if user_id is not None:
        payload["user_id"] = user_id
    return s[0].post(url(t, **kw) + "/corrections", json=payload, headers=s[1])


def done(r):
    assert r.status_code == 201, r.text
    return r.json()["visit"]


def err(r):
    return r.status_code, r.json()


def upload(s, t, data, room=None, reason=None, **kw):
    params = {"room_id": room} if room is not None else {}
    if reason is not None:
        params["reason"] = reason
    return s[0].put(url(t, **kw) + "/photos", content=data, params=params, headers={**s[1], "Content-Type": "application/octet-stream"})


def remove(s, photo_url, reason=None):
    if reason is None:
        return s[0].delete(photo_url, headers=s[1])
    return s[0].request("DELETE", photo_url, json={"reason": reason}, headers=s[1])


def skip(s, t, room, correction_reason=None, **kw):
    body = {"room_id": room, "reason": "door locked"}
    if correction_reason is not None:
        body["correction_reason"] = correction_reason
    return s[0].post(url(t, **kw) + "/skips", json=body, headers=s[1])


def corrections_rows(owner_engine):
    return sql(owner_engine, "SELECT kind, actor_id, reason FROM visit_corrections ORDER BY id")


# ---- the brief's tests -----------------------------------------------------------------------------------------------


def test_forgotten_checkout_is_closed_by_correction(team, clock, owner_engine):
    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    clock["now"] = NEXT_DAY
    r = team.ana[0].post(url(team) + "/checkout", json={"confirm_no_photos": True}, headers=team.ana[1])
    assert err(r) == (422, {"error": "not_today"})
    r = team.ana[0].post(url(team) + "/corrections", json={"kind": "close"}, headers=team.ana[1])
    assert r.status_code == 422  # no reason
    v = done(correct(team.ana, team, "close", reason="  forgot to check out "))
    assert (v["state"], v["closed_at"], v["closed_by_name"], v["closed_without_photos"]) == ("closed", NEXT_DAY.isoformat(), "ana", True)
    assert v["corrected"] is True
    assert v["corrections"] == [
        {"kind": "close", "actor_name": "ana", "reason": "forgot to check out", "created_at": NEXT_DAY.isoformat(), "details": {"without_photos": True}}
    ]
    assert [p["name"] for p in v["people"]] == ["ana", "bruno"]  # the close counts for everyone checked in
    assert v["can_correct_until"] == WINDOW_END
    assert read(team.bruno, team)["corrections"] == v["corrections"]  # colleagues see it
    assert read(team.boss, team)["can_correct_until"] is None  # admins are never limited
    # a second press of the same correction changes nothing
    assert err(correct(team.ana, team, "close", reason="again")) == (409, {"error": "already_closed"})
    assert corrections_rows(owner_engine) == [("close", team.ids["ana"], "forgot to check out")]
    audit = sql(owner_engine, "SELECT details FROM audit_log WHERE action = 'visit_corrected'")
    assert len(audit) == 1 and audit[0][0] == {"visit_id": v["id"], "kind": "close"}
    assert "forgot" not in str(sql(owner_engine, "SELECT details FROM audit_log"))


def test_correction_needs_a_reason(team, owner_engine):
    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    c, h = team.ana
    bruno = team.ids["bruno"]
    for payload in (
        {"kind": "close"},
        {"kind": "close", "reason": ""},
        {"kind": "close", "reason": "   "},
        {"kind": "close", "reason": "x" * 201},
        {"kind": "close", "reason": None},
        {"kind": "erase", "reason": "x"},
        {"kind": "withdraw", "reason": "mistake"},  # whom?
        {"kind": "add_person", "reason": "late"},
        {"kind": "close", "reason": "x", "user_id": bruno},  # a close is not about one person
        {"kind": "withdraw", "reason": "x", "user_id": 0},
        {"kind": "close", "reason": "x", "extra": 1},
    ):
        assert c.post(url(team) + "/corrections", json=payload, headers=h).status_code == 422, payload
    assert done(correct(team.ana, team, "close", reason="x" * 200))["state"] == "closed"  # 200 characters is the limit
    assert len(corrections_rows(owner_engine)) == 1


def test_window_edge_in_toronto_time(team, clock):
    """Review Focus 5. 2026-11-01 is the day Toronto goes back to standard time: the window ends at 2026-11-03 00:00 EST."""
    c, h = team.boss
    eid = create(c, h, title="Dimanche", start_date="2026-11-01", client_id=team.cid, property_id=team.pid, people=[team.ids["ana"], team.ids["bruno"]]).json()["event"]["id"]
    day = "2026-11-01"
    clock["now"] = datetime(2026, 11, 1, 14, 0, tzinfo=timezone.utc)
    v = checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]], eid=eid, day=day)
    assert v["can_correct_until"] == "2026-11-03T05:00:00+00:00"
    clock["now"] = datetime(2026, 11, 3, 4, 59, 59, tzinfo=timezone.utc)  # 2026-11-02 23:59:59 in Toronto
    assert done(correct(team.ana, team, "close", eid=eid, day=day))["state"] == "closed"
    clock["now"] = datetime(2026, 11, 3, 5, 0, tzinfo=timezone.utc)  # 2026-11-03 00:00 in Toronto
    r = correct(team.ana, team, "withdraw", user_id=team.ids["bruno"], eid=eid, day=day)
    assert err(r) == (403, {"error": "correction_window_closed"})
    clock["now"] = datetime(2026, 12, 1, 15, 0, tzinfo=timezone.utc)
    v = done(correct(team.boss, team, "withdraw", user_id=team.ids["bruno"], eid=eid, day=day))
    assert [p["name"] for p in v["people"]] == ["ana"]
    assert done(correct(team.boss, team, "reopen", eid=eid, day=day))["state"] == "in_progress"


def test_window_end_is_midnight_company_time_on_dst_days():
    from app.visits.corrections import window_end

    utc = timezone.utc
    assert window_end(date(2026, 11, 1)) == datetime(2026, 11, 3, 5, 0, tzinfo=utc)  # visit on the change day
    assert window_end(date(2026, 10, 31)) == datetime(2026, 11, 2, 5, 0, tzinfo=utc)  # the next day is the change day
    assert window_end(date(2026, 10, 30)) == datetime(2026, 11, 1, 4, 0, tzinfo=utc)  # ends just before the change (EDT)
    assert window_end(date(2026, 3, 7)) == datetime(2026, 3, 9, 4, 0, tzinfo=utc)  # spring: 2026-03-08 has 23 hours
    assert window_end(date(9999, 12, 29)) == datetime(9999, 12, 31, 5, 0, tzinfo=utc)
    assert window_end(date(9999, 12, 30)) == window_end(date.max) == datetime.max.replace(tzinfo=utc)  # no overflow


def test_withdraw_a_mistaken_checkin_keeps_the_original_row(team, clock, owner_engine):
    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    original = sql(owner_engine, "SELECT checked_in_at FROM visit_people WHERE user_id = :u", u=team.ids["bruno"])[0][0]
    clock["now"] = later = datetime(2026, 11, 5, 14, 0, tzinfo=timezone.utc)
    v = done(correct(team.ana, team, "withdraw", reason="marked Bruno by mistake", user_id=team.ids["bruno"]))
    assert [p["name"] for p in v["people"]] == ["ana"]
    assert v["corrections"][0]["kind"] == "withdraw" and v["corrections"][0]["details"] == {"user_id": team.ids["bruno"], "user_name": "bruno"}
    rows = sql(owner_engine, "SELECT user_id, checked_in_at, withdrawn_at, withdrawn_by FROM visit_people ORDER BY id")
    assert rows == [(team.ids["ana"], original, None, None), (team.ids["bruno"], original, later, team.ids["ana"])]
    # Bruno keeps seeing the record (only active people are listed) and may still correct within the window ...
    seen = read(team.bruno, team)
    assert [p["name"] for p in seen["people"]] == ["ana"] and seen["can_correct_until"] == WINDOW_END
    assert err(correct(team.bruno, team, "withdraw", user_id=team.ids["bruno"])) == (409, {"error": "not_checked_in"})
    # ... but is no longer checked in: no photo, no check-out, and the close does not count him
    assert upload(team.bruno, team, image(), room=team.rooms[0]["id"]).status_code == 403
    v = checkout(team.ana, team)
    assert [p["user_id"] for p in v["people"]] == [team.ids["ana"]]


def test_add_person_after_close(team, clock, owner_engine):
    checkin(team.ana, team, [team.ids["ana"]])
    # while the visit is open on its day, a late arrival uses the normal check-in
    assert err(correct(team.ana, team, "add_person", user_id=team.ids["carla"])) == (409, {"error": "not_closed"})
    checkout(team.ana, team)
    clock["now"] = later = datetime(2026, 11, 5, 20, 0, tzinfo=timezone.utc)
    v = done(correct(team.ana, team, "add_person", reason="Carla came at noon", user_id=team.ids["carla"]))
    carla = [p for p in v["people"] if p["user_id"] == team.ids["carla"]]
    assert carla == [{"user_id": team.ids["carla"], "name": "carla", "checked_in_at": later.isoformat(), "checked_in_by_name": "ana", "self": False}]
    assert v["state"] == "closed"
    assert err(correct(team.ana, team, "add_person", user_id=team.ids["dan"])) == (403, {"error": "not_listed"})
    assert err(correct(team.ana, team, "add_person", user_id=team.ids["carla"])) == (409, {"error": "already_checked_in"})
    assert sql(owner_engine, "SELECT count(*) FROM visit_people")[0][0] == 2
    assert [k for k, *_ in corrections_rows(owner_engine)] == ["add_person"]


def test_only_admins_reopen(team, owner_engine):
    checkin(team.ana, team, [team.ids["ana"]])
    closed = checkout(team.ana, team)
    assert err(correct(team.ana, team, "reopen", reason="closed too early")) == (403, {"error": "forbidden"})
    v = done(correct(team.boss, team, "reopen", reason="closed too early"))
    assert (v["state"], v["closed_at"], v["closed_by_name"], v["closed_without_photos"]) == ("in_progress", None, None, False)
    # the close that was undone stays in the record
    assert v["corrections"][0]["details"] == {"closed_at": closed["closed_at"], "closed_by_name": "ana", "closed_without_photos": True}
    assert err(correct(team.boss, team, "reopen")) == (409, {"error": "not_closed"})
    assert checkout(team.ana, team)["state"] == "closed"
    assert [(k, a) for k, a, _ in corrections_rows(owner_engine)] == [("reopen", team.ids["boss"])]


def test_photo_after_close_needs_reason_and_is_recorded(team, clock, owner_engine, monkeypatch):
    from app.visits import photos

    kitchen, bath = team.rooms[0]["id"], team.rooms[1]["id"]
    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    first = upload(team.ana, team, image(), room=kitchen).json()["visit"]["photos"][0]
    checkout(team.ana, team)
    clock["now"] = NEXT_DAY

    assert err(upload(team.ana, team, image(), room=kitchen)) == (409, {"error": "already_closed"})
    assert err(upload(team.ana, team, image(), room=kitchen, reason="   ")) == (422, {"error": "invalid_reason"})
    r = upload(team.ana, team, image(), room=bath, reason="forgot the bathroom")
    assert r.status_code == 201, r.text
    v = r.json()["visit"]
    assert len(v["photos"]) == 2 and v["state"] == "closed"
    added = v["corrections"][0]
    assert (added["kind"], added["reason"], added["details"]) == ("add_photo", "forgot the bathroom", {"photo_id": v["photos"][1]["id"], "room": "Bath"})

    assert err(remove(team.ana, first["url"])) == (409, {"error": "already_closed"})
    assert err(remove(team.bruno, first["url"], reason="not mine")) == (403, {"error": "forbidden"})  # Staff remove only their own
    r = remove(team.ana, first["url"], reason="wrong house")
    assert r.status_code == 200, r.text
    assert r.json()["visit"]["corrections"][0]["details"] == {"photo_id": first["id"], "room": "Kitchen"}

    assert err(skip(team.ana, team, kitchen)) == (409, {"error": "already_closed"})
    v = done(skip(team.ana, team, kitchen, correction_reason="kitchen was locked"))
    assert [k["room_name"] for k in v["skips"]] == ["Kitchen"] and v["skips"][0]["reason"] == "door locked"
    assert [c["kind"] for c in v["corrections"]] == ["skip_room", "remove_photo", "add_photo"]  # newest first
    assert v["corrections"][0]["reason"] == "kitchen was locked"

    # past the window: Staff are refused before anything is read or decoded, admins are not limited
    calls = []
    real = photos.validate
    monkeypatch.setattr(photos, "validate", lambda data: calls.append(len(data)) or real(data))
    clock["now"] = PAST_WINDOW
    assert err(upload(team.ana, team, hostile(), room=kitchen, reason="late")) == (403, {"error": "correction_window_closed"})
    assert err(upload(team.carla, team, hostile(), room=kitchen, reason="late")) == (403, {"error": "not_checked_in"})
    assert calls == []
    assert upload(team.boss, team, image(), room=kitchen, reason="from the client's email").status_code == 201
    second = read(team.boss, team)["photos"][0]
    assert remove(team.boss, second["url"], reason="blurry").status_code == 200  # an admin removes anyone's photo
    kinds = [k for k, *_ in corrections_rows(owner_engine)]
    assert kinds == ["add_photo", "remove_photo", "skip_room", "add_photo", "remove_photo"]
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'visit_corrected'")[0][0] == 5
    # nothing was erased: the two photos removed by corrections keep their files until the purge (ruling R16)
    assert len(storage.all_ids(team.root)) == 3


def test_a_photo_removed_by_a_correction_keeps_its_file_for_admins(team, clock, owner_engine):
    """Ruling R16: the original is never erased. A correction marks the photo removed; its bytes stay until the 6-month
    purge, admins can still open it by id, everyone else gets the same 404 as for a photo that does not exist."""
    data = image(color=(10, 200, 10))
    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    first = upload(team.ana, team, data, room=team.rooms[0]["id"]).json()["visit"]["photos"][0]
    checkout(team.ana, team)
    clock["now"] = NEXT_DAY
    r = remove(team.ana, first["url"], reason="wrong house")
    assert r.status_code == 200, r.text
    v = r.json()["visit"]
    assert v["photos"] == [] and v["photo_count_total"] == 1
    assert (v["corrections"][0]["kind"], v["corrections"][0]["details"]) == ("remove_photo", {"photo_id": first["id"], "room": "Kitchen"})
    (file_id, deleted, by), = sql(owner_engine, "SELECT file_id, deleted_at IS NOT NULL, deleted_by FROM visit_photos WHERE id = :p", p=first["id"])
    assert deleted and by == team.ids["ana"]
    assert storage.all_ids(team.root) == {file_id}  # the bytes are still on disk
    g = team.boss[0].get(first["url"])
    assert g.status_code == 200 and g.content == data
    assert g.headers["cache-control"] == "private, no-store" and g.headers["x-content-type-options"] == "nosniff"
    for s in (team.ana, team.bruno, team.dan):
        g = s[0].get(first["url"])
        assert (g.status_code, g.json()) == (404, NOT_FOUND)
    assert err(remove(team.boss, first["url"], reason="again")) == (404, NOT_FOUND)  # removed once only
    sql(owner_engine, "UPDATE visit_photos SET purged_at = now() WHERE id = :p", p=first["id"])
    assert team.boss[0].get(first["url"]).status_code == 404  # a purged photo is gone for everyone


def test_someone_never_checked_in_cannot_correct(team, clock, owner_engine):
    checkin(team.ana, team, [team.ids["ana"]])
    for kind, user in (("close", None), ("withdraw", team.ids["ana"]), ("add_person", team.ids["carla"])):
        assert err(correct(team.carla, team, kind, user_id=user)) == (403, {"error": "not_checked_in"}), kind
    assert read(team.carla, team)["can_correct_until"] is None  # listed but not checked in: no Correct button
    assert read(team.ana, team)["can_correct_until"] == WINDOW_END
    checkout(team.ana, team)
    clock["now"] = NEXT_DAY
    # the visit was started by someone else: a late check-in of oneself goes through a colleague who was there
    assert err(correct(team.carla, team, "add_person", user_id=team.ids["carla"])) == (403, {"error": "not_checked_in"})
    # a visit someone may not see answers exactly like one that does not exist
    hidden = correct(team.dan, team, "close")
    assert err(hidden) == (404, NOT_FOUND) == err(correct(team.dan, team, "close", eid=999999)) == err(correct(team.ana, team, "close", day="2026-11-04"))
    assert corrections_rows(owner_engine) == []


def test_corrections_are_append_only_for_the_app_role(team, clock, app_engine, owner_engine):
    checkin(team.ana, team, [team.ids["ana"]])
    clock["now"] = NEXT_DAY
    done(correct(team.ana, team, "close"))
    for statement in ("UPDATE visit_corrections SET reason = 'nothing happened'", "DELETE FROM visit_corrections"):
        with pytest.raises(ProgrammingError):
            with app_engine.begin() as c:
                c.execute(text(statement))
    assert corrections_rows(owner_engine) == [("close", team.ids["ana"], "forgot")]


# ---- the rulings' tests ----------------------------------------------------------------------------------------------


def test_closed_visit_answers_the_same_to_someone_not_active(team):
    """Ruling R7: missing visit -> 403 not_checked_in, then closed -> 409 already_closed, then not active -> 403, for the
    photo upload (checked before the body) and the skip alike."""
    kitchen = team.rooms[0]["id"]
    checkin(team.ana, team, [team.ids["ana"]])
    for r in (upload(team.carla, team, image(), room=kitchen), skip(team.carla, team, kitchen)):
        assert err(r) == (403, {"error": "not_checked_in"})
    checkout(team.ana, team)
    for r in (upload(team.carla, team, image(), room=kitchen), skip(team.carla, team, kitchen)):
        assert err(r) == (409, {"error": "already_closed"})


def test_late_checkin_on_a_visit_never_started(team, clock, owner_engine):
    # on the visit's day the normal check-in is the way, and nothing is created
    assert err(correct(team.carla, team, "add_person", user_id=team.ids["carla"])) == (409, {"error": "not_closed"})
    assert sql(owner_engine, "SELECT count(*) FROM visits")[0][0] == 0
    clock["now"] = NEXT_DAY
    assert err(correct(team.carla, team, "add_person", user_id=team.ids["bruno"])) == (403, {"error": "not_checked_in"})  # oneself only
    assert err(correct(team.carla, team, "close")) == (403, {"error": "not_checked_in"})
    assert err(correct(team.dan, team, "add_person", user_id=team.ids["dan"])) == (404, NOT_FOUND)
    v = done(correct(team.carla, team, "add_person", reason="forgot to check in", user_id=team.ids["carla"]))
    assert v["id"] is not None and v["state"] == "in_progress" and v["date"] == TODAY
    assert [(p["name"], p["checked_in_by_name"], p["self"], p["checked_in_at"]) for p in v["people"]] == [("carla", "carla", True, NEXT_DAY.isoformat())]
    assert done(correct(team.carla, team, "add_person", user_id=team.ids["bruno"]))["people"][1]["name"] == "bruno"  # now she was there
    assert done(correct(team.carla, team, "close"))["state"] == "closed"
    assert [k for k, *_ in corrections_rows(owner_engine)] == ["add_person", "add_person", "close"]


def test_late_checkin_window_and_admin(team, clock, owner_engine):
    clock["now"] = PAST_WINDOW
    assert err(correct(team.carla, team, "add_person", user_id=team.ids["carla"])) == (403, {"error": "correction_window_closed"})
    assert sql(owner_engine, "SELECT count(*) FROM visits")[0][0] == 0
    assert read(team.carla, team)["can_correct_until"] == WINDOW_END  # in the past: the page shows no Correct button
    v = done(correct(team.boss, team, "add_person", reason="paper sheet", user_id=team.ids["carla"]))
    assert [(p["name"], p["checked_in_by_name"], p["self"]) for p in v["people"]] == [("carla", "boss", False)]
    # an admin cannot close a visit nobody is checked in on, nor withdraw someone who is not
    assert err(correct(team.boss, team, "withdraw", user_id=team.ids["ana"])) == (409, {"error": "not_checked_in"})
    assert done(correct(team.boss, team, "withdraw", user_id=team.ids["carla"]))["people"] == []
    assert err(correct(team.boss, team, "close")) == (409, {"error": "not_checked_in"})


def test_close_correction_keeps_the_rooms_rule(team, clock):
    c, h = team.boss
    assert c.patch(f"/api/properties/{team.pid}", json=prop_body(photos_required=True), headers=h).status_code == 200
    checkin(team.ana, team, [team.ids["ana"]])
    upload(team.ana, team, image(), room=team.rooms[0]["id"])
    clock["now"] = NEXT_DAY
    assert err(correct(team.ana, team, "close")) == (409, {"error": "rooms_missing", "rooms": ["Bath"]})
    assert err(skip(team.ana, team, team.rooms[1]["id"])) == (409, {"error": "correction_required"})  # after the visit's day
    assert done(skip(team.ana, team, team.rooms[1]["id"], correction_reason="bath was locked"))["state"] == "in_progress"
    v = done(correct(team.ana, team, "close"))
    assert (v["state"], v["closed_without_photos"], v["corrections"][0]["details"]) == ("closed", False, {"without_photos": False})


def test_open_visit_on_its_day_allows_plain_photo_changes(team, owner_engine):
    kitchen, bath = team.rooms[0]["id"], team.rooms[1]["id"]
    checkin(team.ana, team, [team.ids["ana"]])
    r = upload(team.ana, team, image(), room=kitchen)
    assert r.status_code == 201, r.text
    assert remove(team.ana, r.json()["visit"]["photos"][0]["url"]).status_code == 200
    v = done(skip(team.ana, team, bath))
    assert (v["state"], v["corrected"], v["corrections"]) == ("in_progress", False, [])
    assert corrections_rows(owner_engine) == []


def test_open_visit_after_its_day_needs_a_correction(team, clock, owner_engine, monkeypatch):
    """A visit left open is not a blank page: from the day after its date (here the DST day 2026-11-01), photo and skip
    changes need a reason, are limited to the correction window and are recorded."""
    from app.visits import photos

    c, h = team.boss
    eid = create(c, h, title="Dimanche", start_date="2026-11-01", client_id=team.cid, property_id=team.pid, people=[team.ids["ana"], team.ids["carla"]]).json()["event"]["id"]
    at = {"eid": eid, "day": "2026-11-01"}
    kitchen, bath = team.rooms[0]["id"], team.rooms[1]["id"]
    clock["now"] = datetime(2026, 11, 1, 14, 0, tzinfo=timezone.utc)
    checkin(team.ana, team, [team.ids["ana"]], **at)
    first = upload(team.ana, team, image(), room=kitchen, **at).json()["visit"]["photos"][0]
    calls = []
    real = photos.validate
    monkeypatch.setattr(photos, "validate", lambda data: calls.append(len(data)) or real(data))

    clock["now"] = datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)  # 2026-11-02 00:00 in Toronto (EST): the next day
    required = (409, {"error": "correction_required"})
    assert err(upload(team.ana, team, hostile(), room=bath, **at)) == required
    assert err(remove(team.ana, first["url"])) == required
    assert err(skip(team.ana, team, bath, **at)) == required
    assert calls == []  # refused before the body was decoded
    v = read(team.ana, team, **at)
    assert (len(v["photos"]), v["skips"], v["corrected"], v["state"]) == (1, [], False, "in_progress")
    assert corrections_rows(owner_engine) == [] and len(storage.all_ids(team.root)) == 1
    # someone only listed (never checked in) cannot, with or without a reason
    assert err(upload(team.carla, team, hostile(), room=bath, reason="late", **at)) == (403, {"error": "not_checked_in"})
    assert err(skip(team.carla, team, bath, correction_reason="late", **at)) == (403, {"error": "not_checked_in"})
    assert calls == []

    r = upload(team.ana, team, image(), room=bath, reason="forgot the bathroom", **at)
    assert r.status_code == 201, r.text
    assert remove(team.ana, first["url"], reason="wrong house").status_code == 200
    v = done(skip(team.ana, team, kitchen, correction_reason="kitchen was locked", **at))
    assert (v["state"], v["corrected"]) == ("in_progress", True)
    assert [(x["kind"], x["reason"], x["actor_name"]) for x in v["corrections"]] == [
        ("skip_room", "kitchen was locked", "ana"), ("remove_photo", "wrong house", "ana"), ("add_photo", "forgot the bathroom", "ana"),
    ]

    clock["now"] = datetime(2026, 11, 3, 4, 59, 59, tzinfo=timezone.utc)  # 2026-11-02 23:59:59 in Toronto: still inside
    assert upload(team.ana, team, image(), room=kitchen, reason="one more", **at).status_code == 201
    clock["now"] = datetime(2026, 11, 3, 5, 0, tzinfo=timezone.utc)  # 2026-11-03 00:00: the window is over
    closed = (403, {"error": "correction_window_closed"})
    assert err(upload(team.ana, team, hostile(), room=kitchen, reason="late", **at)) == closed
    assert err(skip(team.ana, team, bath, correction_reason="late", **at)) == closed
    mine = read(team.ana, team, **at)["photos"][0]
    assert err(remove(team.ana, mine["url"], reason="late")) == closed
    assert len(calls) == 2  # only the two accepted uploads were decoded
    # admins are never limited, and remove anyone's photo
    assert upload(team.boss, team, image(), room=kitchen, reason="from the client's email", **at).status_code == 201
    assert remove(team.boss, mine["url"], reason="blurry").status_code == 200
    kinds = [k for k, *_ in corrections_rows(owner_engine)]
    assert kinds == ["add_photo", "remove_photo", "skip_room", "add_photo", "add_photo", "remove_photo"]
    assert sql(owner_engine, "SELECT count(*) FROM audit_log WHERE action = 'visit_corrected'")[0][0] == 6


def test_payload_never_carries_property_details(team):
    v = checkin(team.ana, team, [team.ids["ana"]])
    assert set(v) == {
        "id", "event_id", "occurrence_date", "date", "title", "client_name", "property_name", "property_id", "photos_required", "rooms",
        "state", "people", "listed", "closed_at", "closed_by_name", "closed_without_photos", "corrected", "photos", "photo_count_total",
        "skips", "corrections", "can_correct_until",
    }
    assert v["corrected"] is False and v["corrections"] == []


# ---- two requests at the same moment ---------------------------------------------------------------------------------


@pytest.fixture
def race_engine(owner_engine):
    engine = create_engine(owner_engine.url, poolclass=NullPool)
    yield engine
    engine.dispose()


def _apply(db, user_id, eid, kind, person=None):
    from app.visits import corrections
    from app.visits.schemas import CorrectionIn

    actor = _users(db, user_id)[0]
    data = CorrectionIn(kind=kind, reason="forgot", user_id=person)
    return corrections.apply(db, actor, eid, date(2026, 11, 5), data, NEXT_DAY, "127.0.0.1")


def test_simultaneous_close_corrections_one_wins(team, race_engine, owner_engine):
    from app.auth.errors import ApiError

    checkin(team.ana, team, [team.ids["ana"], team.ids["bruno"]])
    ana, bruno = team.ids["ana"], team.ids["bruno"]
    error = _race(race_engine, lambda db: _apply(db, ana, team.eid, "close"), lambda db: _apply(db, bruno, team.eid, "close"))
    assert isinstance(error, ApiError) and (error.status, error.code) == (409, "already_closed")
    assert corrections_rows(owner_engine) == [("close", ana, "forgot")]


def test_simultaneous_late_checkins_make_one_visit(team, race_engine, owner_engine):
    from app.auth.errors import ApiError

    ana, carla = team.ids["ana"], team.ids["carla"]
    error = _race(race_engine, lambda db: _apply(db, ana, team.eid, "add_person", ana), lambda db: _apply(db, carla, team.eid, "add_person", carla))
    # the visit was started by the first one when the second got the lock: the second goes through a colleague
    assert isinstance(error, ApiError) and (error.status, error.code) == (403, "not_checked_in")
    assert sql(owner_engine, "SELECT count(*) FROM visits")[0][0] == 1
    assert sql(owner_engine, "SELECT user_id FROM visit_people") == [(ana,)]
