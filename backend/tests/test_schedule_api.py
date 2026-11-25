import pytest

from helpers import ORIGIN, login, sql

WEEKLY_THU = {"freq": "weekly", "interval": 1, "weekdays": ["THU"], "month_day": None, "nth_weekdays": []}


def session(make_client, add_user, username, role="user"):
    add_user(username, f"{username}@example.com", role=role)
    c = make_client()
    token = login(c, username).json()["csrf_token"]
    return c, {**ORIGIN, "X-CSRF-Token": token}


def uid(owner_engine, username):
    return sql(owner_engine, "SELECT id FROM users WHERE username = :u", u=username)[0][0]


def body(**kw):
    base = {"title": "Visit", "start_date": "2026-11-05", "start_time": "09:00", "duration_minutes": 60}
    base.update(kw)
    return base


def create(c, h, **kw):
    return c.post("/api/schedule/events", json=body(**kw), headers=h)


def listing(c, frm="2026-11-01", to="2026-11-30", **params):
    r = c.get("/api/schedule/events", params={"from": frm, "to": to, **params})
    assert r.status_code == 200, r.text
    return r.json()["occurrences"]


def titles_by_date(c, **kw):
    return [(o["date"], o["title"]) for o in listing(c, **kw)]


@pytest.fixture
def alice(make_client, add_user):
    return session(make_client, add_user, "alice")


def test_list_returns_only_range(alice):
    c, h = alice
    create(c, h)
    create(c, h, start_date="2026-12-05")
    assert [o["date"] for o in listing(c)] == ["2026-11-05"]


def test_event_fields_in_the_listing(alice, owner_engine):
    c, h = alice
    create(c, h, title="Walk", notes="n", icon="🚶", color="blue")
    o = listing(c)[0]
    assert (o["title"], o["notes"], o["icon"], o["color"]) == ("Walk", "n", "🚶", "blue")
    assert (o["start_time"], o["end_time"], o["all_day"]) == ("09:00", "10:00", False)
    assert (o["repeating"], o["modified"], o["created_by"]) == (False, False, uid(owner_engine, "alice"))


def test_everyone_event_has_empty_people(alice):
    c, h = alice
    create(c, h, people=[])
    assert listing(c)[0]["people"] == []


def test_color_resolved_from_lowest_person_id(make_client, add_user, owner_engine):
    from app.schedule.service import PALETTE

    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    a, b = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    create(c, h, people=[b, a])
    create(c, h, start_date="2026-11-06")
    create(c, h, start_date="2026-11-07", people=[b], color="pink")
    colors = {o["date"]: o["color"] for o in listing(c)}
    assert colors["2026-11-05"] == PALETTE[min(a, b) % 8]
    assert colors["2026-11-06"] == "teal"
    assert colors["2026-11-07"] == "pink"


def test_create_repeating_moves_first_date_to_rule(alice):
    c, h = alice
    r = create(c, h, start_date="2026-11-03", recurrence=WEEKLY_THU)
    assert r.status_code == 201
    assert r.json()["event"]["start_date"] == "2026-11-05"
    assert [o["date"] for o in listing(c)] == ["2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"]


def test_range_over_400_days_is_422(alice):
    c, _ = alice
    r = c.get("/api/schedule/events", params={"from": "2026-01-01", "to": "2027-02-10"})
    assert (r.status_code, r.json()) == (422, {"error": "range_too_large"})


def test_to_before_from_is_422(alice):
    c, _ = alice
    r = c.get("/api/schedule/events", params={"from": "2026-02-01", "to": "2026-01-01"})
    assert (r.status_code, r.json()) == (422, {"error": "bad_range"})


def test_unlisted_plain_user_cannot_patch_or_delete(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    ec, eh = session(make_client, add_user, "carol")
    eid = create(c, h, people=[uid(owner_engine, "bob")]).json()["event"]["id"]
    assert ec.patch(f"/api/schedule/events/{eid}", json=body(title="Hijack"), headers=eh).status_code == 403
    assert ec.delete(f"/api/schedule/events/{eid}", headers=eh).status_code == 403
    assert listing(c)[0]["title"] == "Visit"


def test_listed_person_may_change_event(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    bc, bh = session(make_client, add_user, "bob")
    eid = create(c, h, people=[uid(owner_engine, "bob")]).json()["event"]["id"]
    r = bc.patch(f"/api/schedule/events/{eid}", json=body(title="Renamed", people=[uid(owner_engine, "bob")]), headers=bh)
    assert r.status_code == 200
    assert listing(c)[0]["title"] == "Renamed"


def test_unknown_event_is_404(alice):
    c, h = alice
    assert c.get("/api/schedule/events/9999").status_code == 404
    r = c.patch("/api/schedule/events/9999", json=body(), headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "not_found"})
    assert c.delete("/api/schedule/events/9999", headers=h).status_code == 404


def test_everyone_event_non_creator_plain_user_is_403(make_client, add_user):
    c, h = session(make_client, add_user, "alice")
    bc, bh = session(make_client, add_user, "bob")
    eid = create(c, h).json()["event"]["id"]
    assert bc.patch(f"/api/schedule/events/{eid}", json=body(title="x"), headers=bh).status_code == 403
    assert bc.delete(f"/api/schedule/events/{eid}", headers=bh).status_code == 403


def test_admin_can_change_any_event(make_client, add_user):
    c, h = session(make_client, add_user, "alice")
    ac, ah = session(make_client, add_user, "boss", role="admin")
    eid = create(c, h).json()["event"]["id"]
    assert ac.patch(f"/api/schedule/events/{eid}", json=body(title="By admin"), headers=ah).status_code == 200
    assert ac.delete(f"/api/schedule/events/{eid}", headers=ah).status_code == 200
    assert listing(c) == []


@pytest.mark.parametrize("status", ["disabled", "invited", "deleted"])
def test_cannot_add_inactive_user(make_client, add_user, owner_engine, status):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com", status=status, password=None if status == "invited" else "Abcdef1!")
    r = create(c, h, people=[uid(owner_engine, "bob")])
    assert (r.status_code, r.json()) == (422, {"error": "unknown_person"})
    assert create(c, h, people=[987654]).status_code == 422


def test_event_of_disabled_user_still_lists(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    bob = uid(owner_engine, "bob")
    create(c, h, people=[bob])
    sql(owner_engine, "UPDATE users SET status = 'disabled' WHERE id = :i", i=bob)
    assert listing(c)[0]["people"] == [bob]


def test_this_scope_cancels_one_occurrence(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    r = c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2026-11-12"}, headers=h)
    assert r.status_code == 200
    assert [o["date"] for o in listing(c)] == ["2026-11-05", "2026-11-19", "2026-11-26"]


def test_this_scope_moves_one_occurrence(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    r = c.patch(
        f"/api/schedule/events/{eid}",
        json=body(recurrence=WEEKLY_THU, start_date="2026-11-13", start_time="10:00", title="Moved",
                  scope="this", occurrence_date="2026-11-12"),
        headers=h,
    )
    assert r.status_code == 200, r.text
    moved = [o for o in listing(c) if o["modified"]]
    assert [(o["date"], o["original_date"], o["start_time"], o["title"]) for o in moved] == [
        ("2026-11-13", "2026-11-12", "10:00", "Moved")
    ]


def test_this_scope_rejects_people_change(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    r = c.patch(
        f"/api/schedule/events/{eid}",
        json=body(recurrence=WEEKLY_THU, people=[uid(owner_engine, "bob")], scope="this", occurrence_date="2026-11-12"),
        headers=h,
    )
    assert (r.status_code, r.json()) == (422, {"error": "series_field_changed"})


def test_scope_this_needs_an_occurrence_date_that_exists(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    r = c.delete(f"/api/schedule/events/{eid}", params={"scope": "this"}, headers=h)
    assert (r.status_code, r.json()) == (422, {"error": "occurrence_date_required"})
    r = c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2026-11-06"}, headers=h)
    assert (r.status_code, r.json()) == (422, {"error": "not_an_occurrence"})


def test_following_splits_series_and_keeps_remaining_count(alice):
    c, h = alice
    first = create(c, h, recurrence=WEEKLY_THU, max_count=4).json()["event"]["id"]
    r = c.patch(
        f"/api/schedule/events/{first}",
        json=body(recurrence=WEEKLY_THU, max_count=4, title="Later", start_date="2026-11-19",
                  scope="following", occurrence_date="2026-11-19"),
        headers=h,
    )
    assert r.status_code == 200, r.text
    tail = r.json()["event"]
    assert tail["id"] != first and tail["max_count"] == 2 and tail["start_date"] == "2026-11-19"
    assert titles_by_date(c) == [
        ("2026-11-05", "Visit"), ("2026-11-12", "Visit"), ("2026-11-19", "Later"), ("2026-11-26", "Later"),
    ]
    old = c.get(f"/api/schedule/events/{first}").json()["event"]
    assert (old["ends_on"], old["max_count"]) == ("2026-11-18", None)


def test_following_on_the_first_occurrence_acts_as_all(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    r = c.patch(
        f"/api/schedule/events/{eid}",
        json=body(recurrence=WEEKLY_THU, title="All of them", scope="following", occurrence_date="2026-11-05"),
        headers=h,
    )
    assert r.json()["event"]["id"] == eid
    assert {o["title"] for o in listing(c)} == {"All of them"}


def test_delete_following_ends_the_series_the_day_before(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    c.delete(f"/api/schedule/events/{eid}", params={"scope": "following", "occurrence_date": "2026-11-19"}, headers=h)
    assert [o["date"] for o in listing(c)] == ["2026-11-05", "2026-11-12"]


def test_all_scope_deletes_the_series(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU).json()["event"]["id"]
    assert c.delete(f"/api/schedule/events/{eid}", headers=h).status_code == 200
    assert listing(c) == []


def test_event_detail_has_rule_people_reminders_and_exceptions(alice):
    c, h = alice
    eid = create(c, h, recurrence=WEEKLY_THU, reminders=[{"amount": 2, "unit": "hours"}]).json()["event"]["id"]
    c.delete(f"/api/schedule/events/{eid}", params={"scope": "this", "occurrence_date": "2026-11-12"}, headers=h)
    e = c.get(f"/api/schedule/events/{eid}").json()["event"]
    assert e["recurrence"]["weekdays"] == ["THU"]
    assert e["reminders"] == [{"amount": 2, "unit": "hours"}]
    assert [(x["original_date"], x["cancelled"]) for x in e["exceptions"]] == [("2026-11-12", True)]


def test_search_ignores_case_and_accents(alice):
    c, h = alice
    create(c, h, title="Réunion équipe")
    create(c, h, title="Dentist", start_date="2026-11-06")
    assert [o["title"] for o in listing(c, q="REUNION")] == ["Réunion équipe"]
    assert len(listing(c, q="r")) == 2  # under two letters the search is ignored


def test_search_matches_notes_and_person_names(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("maria", "maria@example.com")
    sql(owner_engine, "UPDATE users SET name = 'María Silva' WHERE username = 'maria'")
    create(c, h, title="A", people=[uid(owner_engine, "maria")])
    create(c, h, title="B", notes="bring the keys", start_date="2026-11-06")
    assert [o["title"] for o in listing(c, q="maria")] == ["A"]
    assert [o["title"] for o in listing(c, q="KEYS")] == ["B"]


def test_people_filter_keeps_those_on_it_and_everyone_events(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    a, b = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    create(c, h, title="mine", people=[a])
    create(c, h, title="bobs", people=[b], start_date="2026-11-06")
    create(c, h, title="all", start_date="2026-11-07")
    assert [o["title"] for o in listing(c, people=str(b))] == ["bobs", "all"]
    assert [o["title"] for o in listing(c, people=f"{a},{b}")] == ["mine", "bobs", "all"]


def test_create_event_audited_without_notes_text_in_log(alice, owner_engine):
    c, h = alice
    eid = create(c, h, notes="top secret client address").json()["event"]["id"]
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action = 'event_created'")
    assert len(rows) == 1 and rows[0][0] == "event_created"
    assert str(eid) in rows[0][1] and "secret" not in rows[0][1]


def test_update_and_delete_are_audited(alice, owner_engine):
    c, h = alice
    eid = create(c, h).json()["event"]["id"]
    c.patch(f"/api/schedule/events/{eid}", json=body(title="New", notes="private words"), headers=h)
    c.delete(f"/api/schedule/events/{eid}", headers=h)
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action LIKE 'event_%' ORDER BY id")
    assert [r[0] for r in rows] == ["event_created", "event_updated", "event_deleted"]
    assert "title" in rows[1][1] and "private" not in rows[1][1]


def test_eleven_reminders_rejected_and_ten_accepted(alice):
    c, h = alice
    ten = [{"amount": n, "unit": "hours"} for n in range(1, 11)]
    assert create(c, h, reminders=ten).status_code == 201
    r = create(c, h, reminders=[*ten, {"amount": 11, "unit": "hours"}])
    assert (r.status_code, r.json()) == (422, {"error": "too_many_reminders"})


def test_duplicate_reminder_rejected(alice):
    c, h = alice
    r = create(c, h, reminders=[{"amount": 2, "unit": "hours"}, {"amount": 2, "unit": "hours"}])
    assert (r.status_code, r.json()) == (422, {"error": "duplicate_reminder"})


def test_end_before_the_first_occurrence_rejected(alice):
    c, h = alice
    r = create(c, h, recurrence=WEEKLY_THU, ends_on="2026-11-01")
    assert (r.status_code, r.json()) == (422, {"error": "before_start"})


def test_people_lists_active_users_first_and_flags_inactive_ones(make_client, add_user, owner_engine):
    from app.schedule.service import PALETTE

    c, _ = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    add_user("gone", "gone@example.com", status="disabled")
    add_user("new", "new@example.com", status="invited", password=None)
    sql(owner_engine, "UPDATE users SET name = 'Bob Tremblay' WHERE username = 'bob'")
    people = c.get("/api/schedule/people").json()["people"]
    by_name = {p["name"]: p for p in people}
    assert set(by_name) == {"alice", "Bob Tremblay", "gone"}  # invited accounts never appear on events
    assert [by_name[n]["active"] for n in ("alice", "Bob Tremblay", "gone")] == [True, True, False]
    bob = by_name["Bob Tremblay"]
    assert bob["color"] == PALETTE[bob["id"] % 8]


def test_editing_an_event_whose_person_was_later_disabled_still_works(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    add_user("bob", "bob@example.com")
    a, b = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    eid = create(c, h, people=[a, b]).json()["event"]["id"]
    sql(owner_engine, "UPDATE users SET status = 'disabled' WHERE id = :i", i=b)
    r = c.patch(f"/api/schedule/events/{eid}", json=body(title="Renamed", people=[a, b]), headers=h)
    assert r.status_code == 200, r.text
    assert c.get(f"/api/schedule/events/{eid}").json()["event"]["people"] == [a, b]
    # but a disabled person still cannot be newly added
    add_user("carl", "carl@example.com", status="disabled")
    r = c.patch(f"/api/schedule/events/{eid}", json=body(people=[a, b, uid(owner_engine, "carl")]), headers=h)
    assert (r.status_code, r.json()) == (422, {"error": "unknown_person"})


def test_splitting_a_series_keeps_its_creator(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    ac, ah = session(make_client, add_user, "boss", role="admin")
    alice_id = uid(owner_engine, "alice")
    first = create(c, h, recurrence=WEEKLY_THU, people=[alice_id]).json()["event"]["id"]
    r = ac.patch(
        f"/api/schedule/events/{first}",
        json=body(recurrence=WEEKLY_THU, people=[alice_id], title="Later", start_date="2026-11-19", scope="following", occurrence_date="2026-11-19"),
        headers=ah,
    )
    tail = r.json()["event"]
    assert tail["created_by"] == alice_id and tail["updated_by"] == uid(owner_engine, "boss")
    assert c.patch(f"/api/schedule/events/{tail['id']}", json=body(title="Mine"), headers=h).status_code == 200


def test_out_of_range_numbers_are_422_not_500(alice):
    c, h = alice
    huge = 10**30
    assert create(c, h, recurrence=WEEKLY_THU, max_count=10**12).status_code == 422
    assert create(c, h, recurrence=WEEKLY_THU, start_date="9999-12-30").status_code == 422
    assert create(c, h, people=[huge]).status_code == 422
    assert c.get(f"/api/schedule/events/{huge}").status_code == 422
    assert c.patch(f"/api/schedule/events/{huge}", json=body(), headers=h).status_code == 422
    assert c.delete(f"/api/schedule/events/{huge}", headers=h).status_code == 422
    r = c.post("/api/schedule/reminders/dismiss", json={"event_id": huge, "occurrence_date": "2026-11-05"}, headers=h)
    assert r.status_code == 422
    assert c.get("/api/schedule/events", params={"from": "2026-11-01", "to": "2026-11-30", "people": str(huge)}).status_code == 422


def test_mutations_need_a_csrf_token_and_a_session(make_client, add_user):
    anon = make_client()
    assert anon.get("/api/schedule/events", params={"from": "2026-11-01", "to": "2026-11-30"}).status_code == 401
    assert anon.post("/api/schedule/events", json=body(), headers=ORIGIN).status_code == 401
    c, _ = session(make_client, add_user, "alice")
    assert c.post("/api/schedule/events", json=body(), headers=ORIGIN).status_code == 403


def test_schedule_responses_are_not_cached(alice):
    c, _ = alice
    r = c.get("/api/schedule/events", params={"from": "2026-11-01", "to": "2026-11-30"})
    assert r.headers["cache-control"] == "no-store"


def test_event_made_by_the_website_is_listed_with_no_creator(make_client, add_user, owner_engine):
    c, h = session(make_client, add_user, "alice")
    sql(owner_engine, "INSERT INTO events (title, start_date, start_time, duration_minutes) VALUES ('Quote deadline', '2026-11-05', '09:00', 30)")
    occurrence = [o for o in listing(c) if o["title"] == "Quote deadline"][0]
    assert occurrence["created_by"] is None
    eid = occurrence["event_id"]
    event = c.get(f"/api/schedule/events/{eid}").json()["event"]
    assert event["created_by"] is None and event["updated_by"] is None
