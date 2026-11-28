"""Staff (role "user") see only the tasks and events that list them (or that they made); admins see everything.
Staff cannot add categories either."""

from helpers import ORIGIN, login, sql


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def titles(r):
    assert r.status_code == 200, r.text
    return sorted(x["title"] for x in (r.json().get("tasks") or r.json().get("occurrences") or []))


def event(c, h, title, people):
    r = c.post("/api/schedule/events", json={"title": title, "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60, "people": people}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["event"]["id"]


def task(c, h, title, people):
    r = c.post("/api/tasks", json={"title": title, "people": people}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["task"]["id"]


def world(make_client, add_user, owner_engine):
    boss, bh = session(make_client, add_user, "boss", role="admin")
    ann, ah = session(make_client, add_user, "ann")
    bob, _ = session(make_client, add_user, "bob")
    a, b = uid(owner_engine, "ann"), uid(owner_engine, "bob")
    ids = {
        "task_ann": task(boss, bh, "For Ann", [a]), "task_both": task(boss, bh, "For both", [a, b]),
        "task_bob": task(boss, bh, "For Bob", [b]), "task_all": task(boss, bh, "For all", []),
        "ev_ann": event(boss, bh, "Ann visit", [a]), "ev_both": event(boss, bh, "Both visit", [a, b]),
        "ev_bob": event(boss, bh, "Bob visit", [b]), "ev_all": event(boss, bh, "All visit", []),
        "bh": bh,
    }
    return boss, ann, ah, bob, a, b, ids


def test_staff_list_only_tasks_that_list_them_and_see_the_other_people(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    assert titles(ann.get("/api/tasks")) == ["For Ann", "For both"]
    both = next(t for t in ann.get("/api/tasks").json()["tasks"] if t["title"] == "For both")
    assert both["people"] == sorted([a, b])  # she can see who else is on it
    assert titles(boss.get("/api/tasks")) == sorted(["For Ann", "For Bob", "For both", "For all"])


def test_staff_cannot_read_a_task_that_is_not_theirs(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    assert ann.get(f"/api/tasks/{ids['task_ann']}").status_code == 200
    for key in ("task_bob", "task_all"):
        assert ann.get(f"/api/tasks/{ids[key]}").status_code == 404
        assert ann.post(f"/api/tasks/{ids[key]}/complete", headers=ah).status_code == 404
        assert ann.patch(f"/api/tasks/{ids[key]}", json={"title": "x"}, headers=ah).status_code == 404
        assert ann.delete(f"/api/tasks/{ids[key]}", headers=ah).status_code == 404


def test_staff_still_see_a_task_they_made_for_someone_else(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    mine = task(ann, ah, "Ann made it", [b])
    assert "Ann made it" in titles(ann.get("/api/tasks"))
    assert ann.get(f"/api/tasks/{mine}").status_code == 200


def test_staff_list_only_events_that_list_them(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    params = {"from": "2026-11-01", "to": "2026-11-30"}
    assert titles(ann.get("/api/schedule/events", params=params)) == ["Ann visit", "Both visit"]
    assert titles(boss.get("/api/schedule/events", params=params)) == ["All visit", "Ann visit", "Bob visit", "Both visit"]
    assert titles(ann.get("/api/schedule/events", params={**params, "q": "visit"})) == ["Ann visit", "Both visit"]


def test_staff_cannot_read_or_touch_an_event_that_is_not_theirs(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    assert ann.get(f"/api/schedule/events/{ids['ev_both']}").status_code == 200
    for key in ("ev_bob", "ev_all"):
        assert ann.get(f"/api/schedule/events/{ids[key]}").status_code == 404
        assert ann.patch(f"/api/schedule/events/{ids[key]}", json={"title": "x", "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60, "people": []}, headers=ah).status_code == 404
        assert ann.delete(f"/api/schedule/events/{ids[key]}", headers=ah).status_code == 404


def test_only_admins_add_categories(make_client, add_user):
    boss, bh = session(make_client, add_user, "boss", role="admin")
    ann, ah = session(make_client, add_user, "ann")
    assert ann.post("/api/tasks/categories", json={"name": "Office"}, headers=ah).status_code == 403
    assert boss.post("/api/tasks/categories", json={"name": "Office"}, headers=bh).status_code == 201
    assert ann.get("/api/tasks/categories").status_code == 200  # she can still use them


EVENT = {"start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60}


def test_staff_cannot_change_an_event_an_admin_made_even_when_it_lists_them(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    eid = ids["ev_ann"]  # made by the admin, for Ann
    assert ann.get(f"/api/schedule/events/{eid}").status_code == 200
    assert ann.patch(f"/api/schedule/events/{eid}", json={**EVENT, "title": "x", "people": [a]}, headers=ah).status_code == 403
    assert ann.delete(f"/api/schedule/events/{eid}", headers=ah).status_code == 403


def test_staff_events_are_for_themselves_only(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    bh = ids["bh"]
    for people in ([], [b], [a, b]):
        r = ann.post("/api/schedule/events", json={**EVENT, "title": "Mine", "people": people}, headers=ah)
        assert r.status_code == 201, r.text
        assert r.json()["event"]["people"] == [a]  # always just her
    # a client she is scheduled for can be picked; one she is not scheduled for cannot (the existing client rule)
    mine, other = (boss.post("/api/clients", json={"name": n, "kinds": ["airbnb"]}, headers=bh).json()["client"]["id"] for n in ("Chantal Roy", "Not Hers"))
    boss.post("/api/schedule/events", json={**EVENT, "title": "Visit", "people": [a], "client_id": mine}, headers=bh)
    r = ann.post("/api/schedule/events", json={**EVENT, "title": "With client", "people": [a], "client_id": mine}, headers=ah)
    assert r.status_code == 201 and r.json()["event"]["client_id"] == mine
    assert ann.post("/api/schedule/events", json={**EVENT, "title": "Other", "people": [a], "client_id": other}, headers=ah).status_code == 422
    # her own event can be edited, but stays hers alone
    eid = ann.post("/api/schedule/events", json={**EVENT, "title": "Mine", "people": [a]}, headers=ah).json()["event"]["id"]
    r = ann.patch(f"/api/schedule/events/{eid}", json={**EVENT, "title": "Renamed", "people": [a, b]}, headers=ah)
    assert r.status_code == 200 and r.json()["event"]["people"] == [a] and r.json()["event"]["title"] == "Renamed"
    assert ann.delete(f"/api/schedule/events/{eid}", headers=ah).status_code == 200


def test_admins_still_make_events_for_anyone_and_say_who_can_change_what(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    mine = ann.post("/api/schedule/events", json={**EVENT, "title": "Mine", "people": [a]}, headers=ah).json()["event"]
    assert mine["editable"] is True
    assert ann.get(f"/api/schedule/events/{ids['ev_ann']}").json()["event"]["editable"] is False
    params = {"from": "2026-11-01", "to": "2026-11-30"}
    flags = {o["title"]: o["editable"] for o in ann.get("/api/schedule/events", params=params).json()["occurrences"]}
    assert flags == {"Ann visit": False, "Both visit": False, "Mine": True}
    assert all(o["editable"] for o in boss.get("/api/schedule/events", params=params).json()["occurrences"])


def test_staff_tasks_are_for_themselves_only(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    for people in ([], [b], [a, b]):
        r = ann.post("/api/tasks", json={"title": "Mine", "people": people}, headers=ah)
        assert r.status_code == 201, r.text
        assert r.json()["task"]["people"] == [a]
    # admins assign anyone
    assert boss.post("/api/tasks", json={"title": "For Bob", "people": [b]}, headers=ids["bh"]).json()["task"]["people"] == [b]


def test_staff_only_move_and_complete_tasks_an_admin_made(make_client, add_user, owner_engine):
    boss, ann, ah, bob, a, b, ids = world(make_client, add_user, owner_engine)
    tid = ids["task_ann"]  # made by the admin, for Ann
    assert ann.get(f"/api/tasks/{tid}").json()["task"]["editable"] is False
    assert ann.post(f"/api/tasks/{tid}/start", headers=ah).status_code == 200
    assert ann.post(f"/api/tasks/{tid}/complete", headers=ah).status_code == 200
    assert ann.post(f"/api/tasks/{tid}/reopen", headers=ah).status_code == 200
    assert ann.patch(f"/api/tasks/{tid}", json={"title": "x", "people": [a]}, headers=ah).status_code == 403
    assert ann.delete(f"/api/tasks/{tid}", headers=ah).status_code == 403
    assert boss.get(f"/api/tasks/{tid}").json()["task"]["editable"] is True
    # her own task can be edited and deleted; "clear completed" leaves the admin's task alone
    mine = task(ann, ah, "Mine", [a])
    assert ann.get(f"/api/tasks/{mine}").json()["task"]["editable"] is True
    ann.post(f"/api/tasks/{tid}/complete", headers=ah)
    ann.post(f"/api/tasks/{mine}/complete", headers=ah)
    assert ann.delete("/api/tasks/completed", headers=ah).json() == {"deleted": 1}
    assert ann.get(f"/api/tasks/{tid}").status_code == 200
    assert ann.get(f"/api/tasks/{mine}").status_code == 404
