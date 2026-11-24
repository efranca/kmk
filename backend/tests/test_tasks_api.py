import pytest

from helpers import ORIGIN, login, sql


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def body(**kw):
    base = {"title": "Mop the floor"}
    base.update(kw)
    return base


def create(c, h, **kw):
    r = c.post("/api/tasks", json=body(**kw), headers=h)
    assert r.status_code == 201, r.text
    return r.json()["task"]


def listing(c, **params):
    r = c.get("/api/tasks", params=params)
    assert r.status_code == 200, r.text
    return r.json()["tasks"]


@pytest.fixture
def alice(make_client, add_user):
    return session(make_client, add_user, "alice")


def test_create_and_read_back_all_fields(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    bob = uid(owner_engine, "bob")
    cat = c.post("/api/tasks/categories", json={"name": "Office"}, headers=h).json()["category"]["id"]
    t = create(c, h, description="  Use the blue bucket ", icon="🧹", category_id=cat, people=[bob], due_date="2026-11-30", show_on_dashboard=False)
    assert t["title"] == "Mop the floor" and t["description"] == "Use the blue bucket" and t["icon"] == "🧹"
    assert (t["category_id"], t["people"], t["due_date"], t["show_on_dashboard"]) == (cat, [bob], "2026-11-30", False)
    assert (t["status"], t["completed_at"]) == ("pending", None)
    assert t["created_by"] == {"id": uid(owner_engine, "alice"), "name": "alice"} and t["updated_by"]["name"] == "alice"
    assert c.get(f"/api/tasks/{t['id']}").json()["task"] == t


def test_listing_order_pending_first_then_due_date_nulls_last(alice):
    c, h = alice
    create(c, h, title="no date")
    create(c, h, title="later", due_date="2026-12-10")
    create(c, h, title="soon", due_date="2026-11-25")
    done = create(c, h, title="done", due_date="2026-11-01")
    c.post(f"/api/tasks/{done['id']}/complete", headers=h)
    assert [t["title"] for t in listing(c)] == ["soon", "later", "no date", "done"]


def test_status_filter(alice):
    c, h = alice
    create(c, h, title="a")
    b = create(c, h, title="b")
    c.post(f"/api/tasks/{b['id']}/complete", headers=h)
    assert [t["title"] for t in listing(c, status="pending")] == ["a"]
    assert [t["title"] for t in listing(c, status="completed")] == ["b"]
    assert len(listing(c, status="all")) == 2
    assert c.get("/api/tasks", params={"status": "bogus"}).status_code == 422


def test_person_filter_and_none_for_whole_team(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    bob = uid(owner_engine, "bob")
    create(c, h, title="for bob", people=[bob])
    create(c, h, title="for all")
    assert [t["title"] for t in listing(c, person=bob)] == ["for bob"]
    assert [t["title"] for t in listing(c, person="none")] == ["for all"]
    assert c.get("/api/tasks", params={"person": "x"}).json() == {"error": "invalid_people"}


def test_unknown_category_is_422(alice):
    c, h = alice
    r = c.post("/api/tasks", json=body(category_id=999), headers=h)
    assert (r.status_code, r.json()) == (422, {"error": "category_not_found"})


@pytest.mark.parametrize("status", ["invited", "disabled"])
def test_inactive_person_is_422(make_client, add_user, owner_engine, status):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com", status=status)
    r = c.post("/api/tasks", json=body(people=[uid(owner_engine, "bob")]), headers=h)
    assert (r.status_code, r.json()) == (422, {"error": "unknown_person"})


def test_patch_keeps_disabled_person(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    bob = uid(owner_engine, "bob")
    t = create(c, h, people=[bob])
    sql(owner_engine, "UPDATE users SET status = 'disabled' WHERE username = 'bob'")
    r = c.patch(f"/api/tasks/{t['id']}", json=body(title="Renamed", people=[bob]), headers=h)
    assert r.status_code == 200 and r.json()["task"]["people"] == [bob] and r.json()["task"]["title"] == "Renamed"
    assert listing(c)[0]["people"] == [bob]


def test_unlisted_plain_user_cannot_patch_or_delete(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    t = create(c, h, people=[uid(owner_engine, "bob")])
    cc, hh = session(make_client, add_user, "carol")
    assert cc.patch(f"/api/tasks/{t['id']}", json=body(), headers=hh).status_code == 403
    assert cc.delete(f"/api/tasks/{t['id']}", headers=hh).status_code == 403
    assert cc.post(f"/api/tasks/{t['id']}/complete", headers=hh).status_code == 403


def test_listed_person_may_edit(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    bc, bh = session(make_client, add_user, "bob")
    t = create(c, h, people=[uid(owner_engine, "bob")])
    assert bc.patch(f"/api/tasks/{t['id']}", json=body(title="By bob", people=t["people"]), headers=bh).status_code == 200
    assert bc.post(f"/api/tasks/{t['id']}/complete", headers=bh).status_code == 200


def test_anyone_ticks_whole_team_task_but_cannot_edit_it(make_client, add_user):
    c, h = session(make_client, add_user, "alice")
    t = create(c, h)
    cc, hh = session(make_client, add_user, "carol")
    assert cc.post(f"/api/tasks/{t['id']}/complete", headers=hh).status_code == 200
    assert cc.post(f"/api/tasks/{t['id']}/reopen", headers=hh).status_code == 200
    assert cc.patch(f"/api/tasks/{t['id']}", json=body(), headers=hh).status_code == 403
    assert cc.delete(f"/api/tasks/{t['id']}", headers=hh).status_code == 403


def test_admin_changes_any_task(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    t = create(c, h)
    ac, ah = session(make_client, add_user, "admin1", role="admin")
    assert ac.patch(f"/api/tasks/{t['id']}", json=body(title="Admin edit"), headers=ah).status_code == 200
    assert ac.delete(f"/api/tasks/{t['id']}", headers=ah).status_code == 204
    assert listing(c) == []


def test_complete_is_idempotent(make_client, add_user):
    c, h = session(make_client, add_user, "alice")
    t = create(c, h)
    first = c.post(f"/api/tasks/{t['id']}/complete", headers=h).json()["task"]
    cc, hh = session(make_client, add_user, "carol")
    second = cc.post(f"/api/tasks/{t['id']}/complete", headers=hh).json()["task"]
    assert first["status"] == "completed" and first["completed_at"]
    assert second["completed_at"] == first["completed_at"]


def test_reopen_clears_completion(alice, owner_engine):
    c, h = alice
    t = create(c, h)
    c.post(f"/api/tasks/{t['id']}/complete", headers=h)
    r = c.post(f"/api/tasks/{t['id']}/reopen", headers=h).json()["task"]
    assert (r["status"], r["completed_at"]) == ("pending", None)
    assert sql(owner_engine, "SELECT completed_by FROM tasks")[0][0] is None


def test_clear_completed_only_deletes_permitted(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    bc, bh = session(make_client, add_user, "bob")
    mine, theirs = create(c, h, title="mine"), create(bc, bh, title="theirs")
    for client, hd, t in ((c, h, mine), (bc, bh, theirs)):
        client.post(f"/api/tasks/{t['id']}/complete", headers=hd)
    create(c, h, title="still open")
    r = c.delete("/api/tasks/completed", headers=h)
    assert (r.status_code, r.json()) == (200, {"deleted": 1})
    assert sorted(t["title"] for t in listing(c)) == ["still open", "theirs"]


def test_audit_rows_never_contain_text(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    t = create(c, h, title="SecretTitle", description="SecretNotes")
    c.patch(f"/api/tasks/{t['id']}", json=body(title="OtherSecret", description="SecretNotes"), headers=h)
    c.post(f"/api/tasks/{t['id']}/complete", headers=h)
    c.post(f"/api/tasks/{t['id']}/reopen", headers=h)
    c.delete(f"/api/tasks/{t['id']}", headers=h)
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action LIKE 'task\\_%' ORDER BY id")
    assert [r[0] for r in rows] == ["task_created", "task_updated", "task_completed", "task_reopened", "task_deleted"]
    assert all("Secret" not in r[1] for r in rows)
    assert '"title"' in rows[1][1]  # the changed field name is recorded, never its text


@pytest.mark.parametrize("title", ["", "   ", "bad\x07title", "x" * 201])
def test_bad_titles_are_422(alice, title):
    c, h = alice
    assert c.post("/api/tasks", json=body(title=title), headers=h).status_code == 422


def test_other_bad_inputs_are_422(alice):
    c, h = alice
    for extra in ({"description": "x" * 2001}, {"people": list(range(1, 52))}, {"due_date": "1999-01-01"}, {"colour": "red"}, {"icon": "x" * 17}):
        assert c.post("/api/tasks", json=body(**extra), headers=h).status_code == 422, extra


def test_unknown_task_is_404(alice):
    c, h = alice
    assert c.get("/api/tasks/999").json() == {"error": "task_not_found"}
    assert c.patch("/api/tasks/999", json=body(), headers=h).status_code == 404
    assert c.post("/api/tasks/999/complete", headers=h).status_code == 404
    assert c.delete("/api/tasks/999", headers=h).status_code == 404
