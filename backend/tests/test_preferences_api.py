import pytest

from helpers import ORIGIN, login, sql

DEFAULTS = {
    "theme": "kmk",
    "sidebar_collapsed": False,
    "tasks_view": "list",
    "show_tasks_on_schedule": False,
    "show_task_categories": False,
    "show_document_categories": False,
    "show_menu_labels": True,
    "documents_view": "list",
    "dashboard_widgets": {"my_events": True, "all_events": True, "my_tasks": True},
}


def session(make_client, add_user, username="alice", role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    r = login(c, username)
    return c, {**ORIGIN, "X-CSRF-Token": r.json()["csrf_token"]}, r.json()


def test_login_and_me_carry_defaults(make_client, add_user):
    c, h, first = session(make_client, add_user)
    assert first["preferences"] == DEFAULTS
    assert c.get("/api/auth/me").json()["preferences"] == DEFAULTS
    assert "preferences" not in first["user"]


def test_patch_persists_and_merges(make_client, add_user):
    c, h, _ = session(make_client, add_user)
    r = c.patch("/api/me/preferences", json={"theme": "dark"}, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["theme"] == "dark"
    r = c.patch("/api/me/preferences", json={"tasks_view": "board", "dashboard_widgets": {"my_tasks": False}}, headers=h)
    prefs = r.json()["preferences"]
    assert prefs["theme"] == "dark" and prefs["tasks_view"] == "board"
    assert prefs["dashboard_widgets"] == {"my_events": True, "all_events": True, "my_tasks": False}
    assert c.get("/api/auth/me").json()["preferences"] == prefs


def test_follows_the_account_to_another_client(make_client, add_user):
    c, h, _ = session(make_client, add_user)
    c.patch("/api/me/preferences", json={"sidebar_collapsed": True}, headers=h)
    other = make_client()
    assert login(other, "alice").json()["preferences"]["sidebar_collapsed"] is True


@pytest.mark.parametrize(
    "body",
    [
        {"nope": 1},
        {"theme": "purple"},
        {"sidebar_collapsed": "yes"},
        {"tasks_view": "tiles"},
        {"dashboard_widgets": {"bogus": True}},
        {"dashboard_widgets": {"my_tasks": "no"}},
    ],
)
def test_bad_input_is_422_and_changes_nothing(make_client, add_user, body):
    c, h, _ = session(make_client, add_user)
    assert c.patch("/api/me/preferences", json=body, headers=h).status_code == 422
    assert c.get("/api/auth/me").json()["preferences"] == DEFAULTS


def test_needs_a_session_and_csrf(make_client, add_user):
    c, h, _ = session(make_client, add_user)
    assert make_client().patch("/api/me/preferences", json={"theme": "dark"}, headers=ORIGIN).status_code == 401
    assert c.patch("/api/me/preferences", json={"theme": "dark"}, headers=ORIGIN).status_code in (401, 403)


def test_garbage_in_the_column_falls_back_to_defaults(make_client, add_user, owner_engine):
    c, h, _ = session(make_client, add_user)
    sql(owner_engine, "UPDATE users SET preferences = '{\"theme\": \"purple\", \"tasks_view\": \"board\", \"junk\": 1}'")
    prefs = c.get("/api/auth/me").json()["preferences"]
    assert prefs["theme"] == "kmk" and prefs["tasks_view"] == "board"


def test_admin_user_list_has_no_preferences(make_client, add_user):
    c, h, _ = session(make_client, add_user, "boss", role="admin")
    users = c.get("/api/admin/users").json()["users"]
    assert all("preferences" not in u for u in users)


def test_category_chips_on_the_tasks_page_are_off_until_chosen_and_follow_the_account(make_client, add_user):
    c, h, first = session(make_client, add_user)
    assert first["preferences"]["show_task_categories"] is False
    r = c.patch("/api/me/preferences", json={"show_task_categories": True}, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["show_task_categories"] is True
    assert login(make_client(), "alice").json()["preferences"]["show_task_categories"] is True
    assert c.patch("/api/me/preferences", json={"show_task_categories": "yes"}, headers=h).status_code == 422  # strict: a boolean


def test_category_chips_on_the_documents_page_are_off_until_chosen_and_follow_the_account(make_client, add_user):
    c, h, first = session(make_client, add_user)
    assert first["preferences"]["show_document_categories"] is False
    r = c.patch("/api/me/preferences", json={"show_document_categories": True}, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["show_document_categories"] is True
    assert login(make_client(), "alice").json()["preferences"]["show_document_categories"] is True
    assert c.patch("/api/me/preferences", json={"show_document_categories": 1}, headers=h).status_code == 422


def test_menu_names_in_the_phone_bar_are_on_until_turned_off_and_follow_the_account(make_client, add_user):
    c, h, first = session(make_client, add_user)
    assert first["preferences"]["show_menu_labels"] is True
    r = c.patch("/api/me/preferences", json={"show_menu_labels": False}, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["show_menu_labels"] is False
    assert login(make_client(), "alice").json()["preferences"]["show_menu_labels"] is False
    assert c.patch("/api/me/preferences", json={"show_menu_labels": "no"}, headers=h).status_code == 422


def test_documents_view_is_list_until_changed_and_follows_the_account(make_client, add_user):
    c, h, first = session(make_client, add_user)
    assert first["preferences"]["documents_view"] == "list"
    r = c.patch("/api/me/preferences", json={"documents_view": "tiles"}, headers=h)
    assert r.status_code == 200 and r.json()["preferences"]["documents_view"] == "tiles"
    assert login(make_client(), "alice").json()["preferences"]["documents_view"] == "tiles"
    for bad in ("grid", "", 1):
        assert c.patch("/api/me/preferences", json={"documents_view": bad}, headers=h).status_code == 422
    assert c.get("/api/auth/me").json()["preferences"]["documents_view"] == "tiles"  # a refused value changed nothing
