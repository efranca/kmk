"""Visit photos: upload by room, view, delete and room skips (spec sections 8, 9, 14, 15)."""

import os
import io
import threading
import time
from types import SimpleNamespace

import pytest
from PIL import Image

from helpers import ORIGIN, login, sql
from test_clients_api import add
from test_properties_api import add_prop, prop_body
from test_schedule_api import create, uid
from test_visits_api import NOT_FOUND, NOW, TODAY, checkin, checkout, ok, read

from app.visits import storage


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    from app.visits import service

    state = {"now": NOW}
    monkeypatch.setattr(service, "now", lambda: state["now"])
    return state


def image(fmt="WEBP", color=(200, 30, 30), size=(32, 24)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format=fmt)
    return out.getvalue()


@pytest.fixture
def team(make_client, add_user, owner_engine, tmp_path):
    def session(name, role="user"):
        add_user(name, f"{name}@example.com", role=role)
        c = make_client(visit_photos_dir=str(tmp_path))
        token = login(c, name).json()["csrf_token"]
        return c, {**ORIGIN, "X-CSRF-Token": token}

    boss = session("boss", "admin")
    staff = {n: session(n) for n in ("ana", "bruno", "dan")}
    ids = {n: uid(owner_engine, n) for n in ("boss", *staff)}
    c, h = boss
    cid = add(c, h, name="Tremblay").json()["client"]["id"]
    pid = add_prop(c, h, cid).json()["property"]["id"]
    rooms = c.put(f"/api/properties/{pid}/rooms", json={"rooms": [{"id": None, "name": "Kitchen"}, {"id": None, "name": "Bath"}]}, headers=h).json()["rooms"]
    r = create(c, h, title="Ménage", start_date=TODAY, client_id=cid, property_id=pid, people=[ids["ana"], ids["bruno"]])
    assert r.status_code == 201, r.text
    pid2 = add_prop(c, h, cid, name="Chalet").json()["property"]["id"]  # a second property with its own room
    other = c.put(f"/api/properties/{pid2}/rooms", json={"rooms": [{"id": None, "name": "Loft"}]}, headers=h).json()["rooms"]
    return SimpleNamespace(boss=boss, ids=ids, cid=cid, pid=pid, rooms=rooms, other_room=other[0], eid=r.json()["event"]["id"], root=tmp_path, **staff)


def purl(t):
    return f"/api/visits/{t.eid}/{TODAY}/photos"


def surl(t):
    return f"/api/visits/{t.eid}/{TODAY}/skips"


def upload(s, t, data, room=None, other=None):
    params = {}
    if room is not None:
        params["room_id"] = room
    if other is not None:
        params["other_name"] = other
    return s[0].put(purl(t), content=data, params=params, headers={**s[1], "Content-Type": "application/octet-stream"})


def zeroed_after_header(data: bytes) -> bytes:
    """A real picture whose header is intact and whose pixel data is gone (verify() accepts it, decoding does not)."""
    return data[:200] + b"\x00" * (len(data) - 200)


def started(t):
    return ok(checkin(t.ana, t, [t.ids["ana"], t.ids["bruno"]]))


def test_upload_view_and_delete_a_photo(team):
    started(team)
    data = image()
    r = upload(team.ana, team, data, room=team.rooms[0]["id"])
    assert r.status_code == 201, r.text
    v = r.json()["visit"]
    p = v["photos"][0]
    assert (p["room_id"], p["room_name"], p["uploaded_by_name"], p["url"]) == (team.rooms[0]["id"], "Kitchen", "ana", f"/api/visit-photos/{p['id']}")
    assert v["photo_count_total"] == 1
    g = team.bruno[0].get(p["url"])  # a colleague on the visit sees it
    assert g.status_code == 200 and g.content == data
    assert g.headers["content-type"] == "image/webp"
    assert g.headers["cache-control"] == "private, no-store" and g.headers["x-content-type-options"] == "nosniff"
    d = team.ana[0].delete(p["url"], headers=team.ana[1])
    assert d.status_code == 200 and d.json()["visit"]["photos"] == [] and d.json()["visit"]["photo_count_total"] == 1
    assert team.ana[0].get(p["url"]).status_code == 404
    assert storage.all_ids(team.root) == set()


def test_jpeg_is_accepted(team):
    started(team)
    r = upload(team.ana, team, image("JPEG"), room=team.rooms[0]["id"])
    assert r.status_code == 201
    assert team.ana[0].get(r.json()["visit"]["photos"][0]["url"]).headers["content-type"] == "image/jpeg"


def test_photo_is_filed_under_a_room_or_other(team, owner_engine):
    started(team)
    r = upload(team.ana, team, image(), other="Garage")
    assert r.status_code == 201, r.text
    p = r.json()["visit"]["photos"][0]
    assert (p["room_id"], p["room_name"]) == (None, "Garage")
    for kw in ({}, {"other": ""}, {"other": "x" * 61}):
        assert upload(team.ana, team, image(), **kw).status_code == 422, kw
    audit = sql(owner_engine, "SELECT details FROM audit_log WHERE action = 'visit_photo_added'")
    assert len(audit) == 1 and set(audit[0][0]) == {"visit_id", "room"}


def test_not_an_image_is_refused_and_leaves_no_file(team):
    started(team)
    for data in (b"%PDF-1.4\n" + b"x" * 500, b"RIFF\x10\x00\x00\x00WEBPjunkjunkjunk", b"\xff\xd8\xff\xe0 not really a jpeg", image("PNG"), zeroed_after_header(image("JPEG", size=(300, 300))), zeroed_after_header(image("WEBP", size=(300, 300)))):
        r = upload(team.ana, team, data, room=team.rooms[0]["id"])
        assert (r.status_code, r.json()) == (422, {"error": "invalid_photo"})
    assert storage.all_ids(team.root) == set()
    assert ok(read(team.ana, team))["photos"] == []


def test_too_large_is_refused(team):
    started(team)
    r = upload(team.ana, team, b"\x00" * 614401, room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (422, {"error": "photo_too_large"})
    assert storage.all_ids(team.root) == set()


def test_room_of_another_property_is_refused(team):
    started(team)
    r = upload(team.ana, team, image(), room=team.other_room["id"])
    assert (r.status_code, r.json()) == (422, {"error": "invalid_room"})
    assert storage.all_ids(team.root) == set()


def test_low_disk_answers_storage_full(team, monkeypatch):
    started(team)
    monkeypatch.setattr(storage, "free_bytes", lambda root: 1024**3 - 1)
    r = upload(team.ana, team, image(), room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (503, {"error": "storage_full"})
    assert storage.all_ids(team.root) == set()


def test_only_the_uploader_removes_and_only_while_open(team):
    started(team)
    p = upload(team.ana, team, image(), room=team.rooms[0]["id"]).json()["visit"]["photos"][0]
    r = team.bruno[0].delete(p["url"], headers=team.bruno[1])
    assert (r.status_code, r.json()) == (403, {"error": "forbidden"})
    ok(checkout(team.ana, team, True))
    r = team.ana[0].delete(p["url"], headers=team.ana[1])
    assert (r.status_code, r.json()) == (409, {"error": "already_closed"})
    assert team.ana[0].get(p["url"]).status_code == 200
    r = upload(team.ana, team, image(), room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (409, {"error": "already_closed"})
    r = team.ana[0].post(surl(team), json={"room_id": team.rooms[1]["id"], "reason": "locked"}, headers=team.ana[1])
    assert (r.status_code, r.json()) == (409, {"error": "already_closed"})


def test_must_be_checked_in_to_add(team):
    r = upload(team.ana, team, image(), room=team.rooms[0]["id"])  # no visit yet
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    r = upload(team.bruno, team, image(), room=team.rooms[0]["id"])  # listed but not checked in
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    assert storage.all_ids(team.root) == set()


def test_photo_of_a_visit_i_cannot_see_is_404(team):
    started(team)
    p = upload(team.ana, team, image(), room=team.rooms[0]["id"]).json()["visit"]["photos"][0]
    hidden = team.dan  # not listed, no check-in
    unknown = hidden[0].get("/api/visit-photos/999999")
    seen = hidden[0].get(p["url"])
    assert (seen.status_code, seen.json()) == (404, NOT_FOUND) == (unknown.status_code, unknown.json())
    r = hidden[0].delete(p["url"], headers=hidden[1])
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    r = upload(hidden, team, image(), room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    r = hidden[0].post(surl(team), json={"room_id": team.rooms[1]["id"], "reason": "x"}, headers=hidden[1])
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    assert team.boss[0].get(p["url"]).status_code == 200  # admins see every visit


def test_purged_photos_are_404(team, owner_engine):
    started(team)
    p = upload(team.ana, team, image(), room=team.rooms[0]["id"]).json()["visit"]["photos"][0]
    sql(owner_engine, "UPDATE visit_photos SET purged_at = now() WHERE id = :i", i=p["id"])
    r = team.ana[0].get(p["url"])
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    v = ok(read(team.ana, team))
    assert v["photos"] == [] and v["photo_count_total"] == 1


def test_missing_file_is_404_not_500(team):
    started(team)
    p = upload(team.ana, team, image(), room=team.rooms[0]["id"]).json()["visit"]["photos"][0]
    for i in storage.all_ids(team.root):
        storage.delete(team.root, i)
    assert team.ana[0].get(p["url"]).status_code == 404


def test_skip_counts_for_photos_required(team):
    c, h = team.boss
    assert c.patch(f"/api/properties/{team.pid}", json=prop_body(photos_required=True), headers=h).status_code == 200
    started(team)
    upload(team.ana, team, image(), room=team.rooms[0]["id"])
    r = checkout(team.ana, team, True)
    assert (r.status_code, r.json()) == (409, {"error": "rooms_missing", "rooms": ["Bath"]})
    s = team.ana

    def skip(body):
        return s[0].post(surl(team), json=body, headers=s[1])

    assert skip({"room_id": team.other_room["id"], "reason": "locked"}).status_code == 422
    assert skip({"room_id": team.rooms[1]["id"], "reason": "   "}).status_code == 422
    r = skip({"room_id": team.rooms[1]["id"], "reason": "  door locked "})
    assert r.status_code == 201, r.text
    sk = r.json()["visit"]["skips"]
    assert [(x["room_id"], x["room_name"], x["reason"], x["skipped_by_name"]) for x in sk] == [(team.rooms[1]["id"], "Bath", "door locked", "ana")]
    assert skip({"room_id": team.rooms[1]["id"], "reason": "again"}).status_code == 409
    v = ok(checkout(team.ana, team, False))
    assert (v["state"], v["closed_without_photos"]) == ("closed", False)


def test_removed_photo_does_not_cover_a_room(team):
    c, h = team.boss
    c.patch(f"/api/properties/{team.pid}", json=prop_body(photos_required=True), headers=h)
    started(team)
    for room in team.rooms:
        p = upload(team.ana, team, image(), room=room["id"]).json()["visit"]["photos"][-1]
    team.ana[0].delete(p["url"], headers=team.ana[1])
    r = checkout(team.ana, team, True)
    assert (r.status_code, r.json()) == (409, {"error": "rooms_missing", "rooms": ["Bath"]})


def test_failed_insert_deletes_the_file(team, monkeypatch):
    from app.visits import photos

    started(team)

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(photos.audit, "log", boom)
    with pytest.raises(RuntimeError):
        upload(team.ana, team, image(), room=team.rooms[0]["id"])
    assert storage.all_ids(team.root) == set()


def test_storage_refuses_bad_ids_and_deletes_quietly(tmp_path):
    for bad in ("../x", "A" * 32, "ab", "0" * 31 + "/", ""):
        with pytest.raises(ValueError):
            storage.open_bytes(tmp_path, bad)
    storage.delete(tmp_path, "0" * 32)  # missing: no error
    fid = storage.save(tmp_path, b"abc")
    assert storage.open_bytes(tmp_path, fid) == b"abc" and storage.all_ids(tmp_path) == {fid}
    assert not list(tmp_path.rglob("*.tmp"))


def test_new_photo_files_are_640_and_shard_dirs_750(tmp_path):
    old = os.umask(0o077)  # the process umask must neither widen nor narrow the modes
    try:
        a = storage.save(tmp_path, b"abc")
    finally:
        os.umask(old)
    os.umask(0o000)
    try:
        b = storage.save(tmp_path, b"def")
    finally:
        os.umask(old)
    for fid in (a, b):
        assert (tmp_path / fid[:2] / fid).stat().st_mode & 0o777 == 0o640
        assert (tmp_path / fid[:2]).stat().st_mode & 0o777 == 0o750


def test_upload_waiting_for_the_visit_lock_does_not_block_the_event_loop(team, owner_engine):
    started(team)
    visit_id = sql(owner_engine, "SELECT id FROM visits")[0][0]
    holder = owner_engine.connect()
    holder.exec_driver_sql(f"SELECT id FROM visits WHERE id = {int(visit_id)} FOR UPDATE")
    result = {}
    client = team.ana[0]
    with client:  # one shared event loop for every request of this app

        def put():
            result["r"] = upload(team.ana, team, image(), room=team.rooms[0]["id"])

        thread = threading.Thread(target=put)
        thread.start()
        time.sleep(1.5)  # the upload is now waiting for the row lock
        timer = threading.Timer(4, holder.rollback)
        timer.start()
        began = time.monotonic()
        health = client.get("/api/health")
        waited = time.monotonic() - began
        timer.cancel()
        holder.rollback()
        thread.join(15)
    holder.close()
    assert health.status_code == 200 and waited < 3, "the loop was blocked by the upload waiting for the lock"
    assert result["r"].status_code == 201, result["r"].text


@pytest.fixture
def decodes(monkeypatch):
    """Records every call of the (expensive) decode helper."""
    from app.visits import photos

    real = photos.validate
    calls = []

    def spy(data):
        calls.append(len(data))
        return real(data)

    monkeypatch.setattr(photos, "validate", spy)
    return calls


def hostile():
    return zeroed_after_header(image("JPEG", size=(300, 300)))


def test_nothing_is_decoded_for_someone_who_may_not_add(team, decodes):
    for who in (team.ana, team.bruno):  # visit not started, then listed but not checked in
        r = upload(who, team, hostile(), room=team.rooms[0]["id"])
        assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    ok(checkin(team.ana, team, [team.ids["ana"]]))
    r = upload(team.bruno, team, hostile(), room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (403, {"error": "not_checked_in"})
    assert upload(team.dan, team, hostile(), room=team.rooms[0]["id"]).status_code == 404
    assert upload(team.ana, team, hostile(), room=team.other_room["id"]).status_code == 422  # room refused before decoding too
    assert decodes == []


def test_nothing_is_decoded_on_a_closed_visit(team, decodes):
    started(team)
    ok(checkout(team.ana, team, True))
    r = upload(team.ana, team, hostile(), room=team.rooms[0]["id"])
    assert (r.status_code, r.json()) == (409, {"error": "already_closed"})
    assert decodes == []


def test_decoding_never_runs_more_than_two_at_once(team, monkeypatch):
    from app.visits import photos

    started(team)
    state = {"now": 0, "max": 0}
    lock = threading.Lock()
    two_inside = threading.Event()
    gate = threading.Event()

    def slow_validate(data):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
            if state["now"] == 2:
                two_inside.set()
        assert gate.wait(15)
        with lock:
            state["now"] -= 1
        return "image/webp"

    monkeypatch.setattr(photos, "validate", slow_validate)
    client = team.ana[0]
    results = []
    with client:
        threads = [threading.Thread(target=lambda: results.append(upload(team.ana, team, image(), room=team.rooms[0]["id"]))) for _ in range(2)]
        for t in threads:
            t.start()
        assert two_inside.wait(15)
        third = upload(team.ana, team, image(), room=team.rooms[0]["id"])  # both slots are taken
        gate.set()
        for t in threads:
            t.join(15)
    assert (third.status_code, third.json()) == (503, {"error": "busy"})
    assert sorted(r.status_code for r in results) == [201, 201]
    assert state["max"] == 2


def test_the_slot_is_released_when_decoding_fails(team):
    started(team)
    for _ in range(4):  # more than the two slots
        assert upload(team.ana, team, hostile(), room=team.rooms[0]["id"]).status_code == 422
    assert upload(team.ana, team, image(), room=team.rooms[0]["id"]).status_code == 201
