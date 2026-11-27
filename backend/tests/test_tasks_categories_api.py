from helpers import ORIGIN, login, sql


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def make(c, h, name="Office", icon="🏢"):
    return c.post("/api/tasks/categories", json={"name": name, "icon": icon}, headers=h)


def test_admin_creates_category_and_staff_cannot(make_client, add_user):
    s, sh = session(make_client, add_user, "staffer")
    assert make(s, sh).status_code == 403
    c, h = session(make_client, add_user, "alice", role="admin")
    r = make(c, h)
    assert r.status_code == 201
    cat = r.json()["category"]
    assert (cat["name"], cat["icon"]) == ("Office", "🏢")
    assert c.get("/api/tasks/categories").json()["categories"] == [cat]


def test_list_is_ordered_by_name_ignoring_case(make_client, add_user):
    c, h = session(make_client, add_user, "alice", role="admin")
    for n in ("beta", "Alpha", "Gamma"):
        make(c, h, n, None)
    assert [x["name"] for x in c.get("/api/tasks/categories").json()["categories"]] == ["Alpha", "beta", "Gamma"]


def test_duplicate_name_any_case_is_409(make_client, add_user):
    c, h = session(make_client, add_user, "admin1", role="admin")
    make(c, h, "Office")
    assert make(c, h, "office").status_code == 409
    assert make(c, h, "office").json() == {"error": "category_exists"}
    other = make(c, h, "Shop").json()["category"]["id"]
    r = c.patch(f"/api/tasks/categories/{other}", json={"name": "OFFICE"}, headers=h)
    assert (r.status_code, r.json()) == (409, {"error": "category_exists"})


def test_plain_user_cannot_rename_or_delete(make_client, add_user):
    a, ah = session(make_client, add_user, "boss", role="admin")
    cid = make(a, ah).json()["category"]["id"]
    c, h = session(make_client, add_user, "alice")
    assert c.patch(f"/api/tasks/categories/{cid}", json={"name": "X"}, headers=h).status_code == 403
    assert c.delete(f"/api/tasks/categories/{cid}", headers=h).status_code == 403


def test_admin_renames_and_changes_icon(make_client, add_user):
    c, h = session(make_client, add_user, "admin1", role="admin")
    cid = make(c, h).json()["category"]["id"]
    r = c.patch(f"/api/tasks/categories/{cid}", json={"name": "Shop", "icon": "🛒"}, headers=h)
    assert r.status_code == 200
    assert (r.json()["category"]["name"], r.json()["category"]["icon"]) == ("Shop", "🛒")


def test_delete_keeps_tasks_without_category(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "admin1", role="admin")
    cid = make(c, h).json()["category"]["id"]
    uid = sql(owner_engine, "SELECT id FROM users")[0][0]
    sql(owner_engine, "INSERT INTO tasks (title, category_id, created_by, updated_by) VALUES ('Mop', :c, :u, :u)", c=cid, u=uid)
    assert c.delete(f"/api/tasks/categories/{cid}", headers=h).status_code == 204
    assert sql(owner_engine, "SELECT category_id FROM tasks")[0][0] is None


def test_unknown_category_is_404(make_client, add_user):
    c, h = session(make_client, add_user, "admin1", role="admin")
    assert c.patch("/api/tasks/categories/999", json={"name": "X"}, headers=h).status_code == 404
    assert c.delete("/api/tasks/categories/999", headers=h).json() == {"error": "category_not_found"}


def test_audit_rows_have_no_name(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "admin1", role="admin")
    cid = make(c, h, "SecretName").json()["category"]["id"]
    c.patch(f"/api/tasks/categories/{cid}", json={"name": "OtherSecret"}, headers=h)
    c.delete(f"/api/tasks/categories/{cid}", headers=h)
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action LIKE 'task_category%' ORDER BY id")
    assert [r[0] for r in rows] == ["task_category_created", "task_category_updated", "task_category_deleted"]
    assert all("Secret" not in r[1] for r in rows)


def test_extra_field_and_bad_name_rejected(make_client, add_user):
    c, h = session(make_client, add_user, "alice")
    assert c.post("/api/tasks/categories", json={"name": "A", "color": "red"}, headers=h).status_code == 422
    assert c.post("/api/tasks/categories", json={"name": "   "}, headers=h).status_code == 422
    assert c.post("/api/tasks/categories", json={"name": "x" * 51}, headers=h).status_code == 422
