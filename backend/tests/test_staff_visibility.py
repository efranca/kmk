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
