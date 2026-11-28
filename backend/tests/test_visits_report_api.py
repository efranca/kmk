"""The "Visits done" report: who did how many closed visits (what the owner pays by), its CSV and its route order."""

import csv
import io

import pytest

from helpers import sql
from test_clients_api import add
from test_properties_api import add_prop
from test_schedule_api import create, session, uid

RANGE = {"from": "2026-11-01", "to": "2026-11-30"}


@pytest.fixture
def team(make_client, add_user, owner_engine):
    boss = session(make_client, add_user, "boss", role="admin")
    staff = session(make_client, add_user, "ana")
    ids = {n: uid(owner_engine, n) for n in ("boss", "ana")}
    for n in ("bruno", "carla"):
        add_user(n, f"{n}@example.com")
        ids[n] = uid(owner_engine, n)
    c, h = boss
    cid = add(c, h, name="Tremblay").json()["client"]["id"]
    pid = add_prop(c, h, cid, name="Chalet").json()["property"]["id"]
    return type("T", (), {"boss": boss, "staff": staff, "ids": ids, "cid": cid, "pid": pid, "owner": owner_engine})


def make_visit(t, day, who=(), closed=True, client_name="Tremblay", prop="Chalet", no_photos=False):
    """A visit row on its own event (one event per visit, the series key being unique)."""
    c, h = t.boss
    eid = create(c, h, title="Ménage", start_date=day, client_id=t.cid, property_id=t.pid).json()["event"]["id"]
    closed_at = f"'{day} 14:30+00'" if closed else "NULL"
    vid = sql(
        t.owner,
        "INSERT INTO visits (event_id, occurrence_date, visit_date, client_id, property_id, client_name, property_name, closed_at, closed_without_photos) "
        f"VALUES (:e, :d, :d, :c, :p, :cn, :pn, {closed_at}, :np) RETURNING id",
        e=eid, d=day, c=t.cid, p=t.pid, cn=client_name, pn=prop, np=no_photos,
    )[0][0]
    for name in who:
        add_person(t, vid, name)
    return vid, eid


def add_person(t, vid, name, withdrawn=False, by=None):
    sql(
        t.owner,
        "INSERT INTO visit_people (visit_id, user_id, user_name, checked_in_at, checked_in_by, withdrawn_at) "
        "SELECT :v, :u, :n, (SELECT visit_date FROM visits WHERE id = :v)::timestamptz + interval '13 hours 5 minutes', :by, "
        + ("now()" if withdrawn else "NULL"),
        v=vid, u=t.ids[name], n=name.capitalize(), by=t.ids[by or name],
    )


def report(t, **params):
    return t.boss[0].get("/api/visits/report", params={**RANGE, **params})


def by_name(r):
    return {p["name"]: p for p in r.json()["people"]}


def test_counts_per_person_for_closed_visits_only(team):
    make_visit(team, "2026-11-03", ["ana", "bruno"])
    make_visit(team, "2026-11-10", ["ana"])
    make_visit(team, "2026-11-11", ["ana"], closed=False)
    make_visit(team, "2026-10-31", ["ana"])  # before the range
    make_visit(team, "2026-12-01", ["ana"])  # after
    r = report(team)
    assert r.status_code == 200, r.text
    assert [(p["name"], p["visits"]) for p in r.json()["people"]] == [("Ana", 2), ("Bruno", 1)]


def test_withdrawn_person_is_not_counted(team):
    v, _ = make_visit(team, "2026-11-03", ["ana", "bruno"])
    sql(team.owner, "UPDATE visit_people SET withdrawn_at = now() WHERE visit_id = :v AND user_name = 'Bruno'", v=v)
    add_person(team, v, "bruno")  # withdrawn then added again: counted once
    add_person(team, v, "carla", withdrawn=True)
    w, _ = make_visit(team, "2026-11-04", ["carla"])  # everybody withdrawn after the close: counts for nobody
    sql(team.owner, "UPDATE visit_people SET withdrawn_at = now() WHERE visit_id = :v", v=w)
    r = report(team)
    assert r.status_code == 200
    assert [(p["name"], p["visits"]) for p in r.json()["people"]] == [("Ana", 1), ("Bruno", 1)]
    assert r.json()["open"] == []


def test_open_visits_are_listed_apart(team):
    make_visit(team, "2026-11-03", ["ana"])
    make_visit(team, "2026-11-04", ["bruno", "carla"], closed=False)
    make_visit(team, "2026-11-05", [], closed=False)  # no check-in: not listed
    r = report(team)
    assert [p["name"] for p in r.json()["people"]] == ["Ana"]
    assert [(o["date"], o["client_name"], o["property_name"], o["people"]) for o in r.json()["open"]] == [("2026-11-04", "Tremblay", "Chalet", ["Bruno", "Carla"])]


def test_summary_markers_corrected_and_without_photos(team):
    a, _ = make_visit(team, "2026-11-03", ["ana"], no_photos=True)
    make_visit(team, "2026-11-04", ["ana"])
    sql(team.owner, "INSERT INTO visit_corrections (visit_id, kind, reason) VALUES (:v, 'close', 'forgot')", v=a)
    ana = by_name(report(team))["Ana"]
    assert (ana["visits"], ana["corrected"], ana["without_photos"]) == (2, 1, 1)


def test_person_detail_lists_markers(team):
    v, _ = make_visit(team, "2026-11-03", ["ana"], no_photos=True)
    add_person(team, v, "bruno", by="ana")
    for i, deleted in enumerate((False, False, True)):
        sql(
            team.owner,
            "INSERT INTO visit_photos (visit_id, file_id, room_name, content_type, size, sha256, deleted_at) VALUES (:v, :f, 'Kitchen', 'image/webp', 1, 'x', "
            + ("now()" if deleted else "NULL")
            + ")",
            v=v, f=f"f{i}",
        )
    sql(team.owner, "INSERT INTO visit_corrections (visit_id, kind, reason) VALUES (:v, 'close', 'forgot')", v=v)
    make_visit(team, "2026-11-04", ["bruno"])
    r = team.boss[0].get(f"/api/visits/report/{team.ids['bruno']}", params=RANGE)
    assert r.status_code == 200, r.text
    first, second = r.json()["visits"]
    assert (first["date"], first["client_name"], first["property_name"], first["photos"], first["without_photos"], first["corrected"], first["checked_in_by_name"]) == (
        "2026-11-03", "Tremblay", "Chalet", 2, True, True, "ana",
    )
    assert (first["checked_in_at"], first["closed_at"]) == ("08:05", "09:30")  # company time (EST)
    assert (second["photos"], second["corrected"], second["without_photos"]) == (0, False, False)


def detail(t, name):
    r = t.boss[0].get(f"/api/visits/report/{t.ids[name]}", params=RANGE)
    assert r.status_code == 200, r.text
    return r.json()["visits"]


def test_person_detail_says_exactly_who_checked_in_by_ids_not_names(team):
    make_visit(team, "2026-11-03", ["ana"])  # ana checks herself in, then is renamed
    sql(team.owner, "UPDATE users SET name = 'Ana Lima' WHERE id = :u", u=team.ids["ana"])
    (own,) = detail(team, "ana")
    assert (own["self"], own["checked_in_by_name"]) == (True, "Ana Lima")  # the names differ, the ids do not
    # two people with the same display name: bruno marks carla
    sql(team.owner, "UPDATE users SET name = 'Sam' WHERE id IN (:b, :c)", b=team.ids["bruno"], c=team.ids["carla"])
    v, _ = make_visit(team, "2026-11-04")
    add_person(team, v, "carla", by="bruno")
    add_person(team, v, "bruno")
    sql(team.owner, "UPDATE visit_people SET user_name = 'Sam' WHERE visit_id = :v", v=v)
    (marked,) = detail(team, "carla")
    assert (marked["self"], marked["checked_in_by_name"]) == (False, "Sam")
    (himself,) = detail(team, "bruno")
    assert himself["self"] is True
    # the detail agrees with the summary
    people = {p["user_id"]: p["visits"] for p in report(team).json()["people"]}
    assert people == {team.ids["ana"]: 1, team.ids["bruno"]: 1, team.ids["carla"]: 1}


def test_person_detail_when_the_checker_account_was_deleted(team):
    v, _ = make_visit(team, "2026-11-03")
    add_person(team, v, "carla", by="bruno")
    sql(team.owner, "DELETE FROM users WHERE id = :u", u=team.ids["bruno"])
    assert sql(team.owner, "SELECT checked_in_by FROM visit_people WHERE visit_id = :v", v=v)[0] == (None,)
    (line,) = detail(team, "carla")
    assert (line["self"], line["checked_in_by_name"]) == (False, None)
    assert by_name(report(team))["Carla"]["visits"] == 1


def test_csv_columns_unchanged_by_the_self_flag(team):
    make_visit(team, "2026-11-03", ["ana"])
    rows = list(csv.reader(io.StringIO(team.boss[0].get("/api/visits/report.csv", params=RANGE).content.decode("utf-8-sig"))))
    assert rows[0] == ["date", "person", "client", "property", "check_in", "check_out", "photos", "closed_without_photos", "corrected", "checked_in_by"]
    assert len(rows[1]) == 10
    assert "self" not in report(team).json()["people"][0]


def test_person_detail_keeps_a_visit_whose_event_was_deleted(team):
    v, eid = make_visit(team, "2026-11-03", ["ana"], client_name="Gone Inc", prop="Old house")
    sql(team.owner, "DELETE FROM events WHERE id = :e", e=eid)
    sql(team.owner, "DELETE FROM properties WHERE id = :p", p=team.pid)
    sql(team.owner, "DELETE FROM clients WHERE id = :c", c=team.cid)
    assert sql(team.owner, "SELECT event_id, property_id, client_id FROM visits WHERE id = :v", v=v)[0] == (None, None, None)
    r = team.boss[0].get(f"/api/visits/report/{team.ids['ana']}", params=RANGE)
    assert r.status_code == 200, r.text
    (row,) = r.json()["visits"]
    assert (row["client_name"], row["property_name"], row["event_id"]) == ("Gone Inc", "Old house", None)
    assert by_name(report(team))["Ana"]["visits"] == 1
    assert "Gone Inc" in team.boss[0].get("/api/visits/report.csv", params=RANGE).content.decode("utf-8")


def parse(r):
    text = r.content.decode("utf-8")
    assert text.startswith("﻿")
    return list(csv.reader(io.StringIO(text[1:], newline="")))


def test_csv_columns_and_formula_guard(team):
    v, _ = make_visit(team, "2026-11-03", ["ana", "bruno"], client_name='=HYPERLINK("http://x","y")')
    add_person(team, v, "carla", by="ana")
    sql(team.owner, "UPDATE visits SET property_name = E'\\t+cmd' WHERE id = :v", v=v)
    make_visit(team, "2026-11-04", ["ana"], prop='Café, "bar"', no_photos=True)
    r = team.boss[0].get("/api/visits/report.csv", params=RANGE)
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"] == 'attachment; filename="visites-2026-11-01-2026-11-30.csv"'
    assert r.content.decode("utf-8").count("\r\n") == 5
    rows = parse(r)
    assert rows[0] == ["date", "person", "client", "property", "check_in", "check_out", "photos", "closed_without_photos", "corrected", "checked_in_by"]
    assert len(rows) == 5
    assert rows[1][:4] == ["2026-11-03", "Ana", "'=HYPERLINK(\"http://x\",\"y\")", "'\t+cmd"]
    assert rows[1][4:] == ["08:05", "09:30", "0", "no", "no", "ana"]
    assert rows[3][1] == "Carla" and rows[3][9] == "ana"
    assert rows[4][3] == 'Café, "bar"' and rows[4][7] == "yes"


def test_csv_keeps_accents_from_a_name(team):
    make_visit(team, "2026-11-03", ["ana"], client_name="Hélène Côté")
    assert "Hélène Côté" in team.boss[0].get("/api/visits/report.csv", params=RANGE).content.decode("utf-8")


def test_report_is_for_admins_only(team):
    for path in ("/api/visits/report", "/api/visits/report.csv", f"/api/visits/report/{team.ids['ana']}"):
        r = team.staff[0].get(path, params=RANGE)
        assert (r.status_code, r.json()) == (403, {"error": "forbidden"}), path


def test_range_too_long(team):
    for path in ("/api/visits/report", "/api/visits/report.csv", f"/api/visits/report/{team.ids['ana']}"):
        r = team.boss[0].get(path, params={"from": "2025-11-01", "to": "2026-11-30"})
        assert (r.status_code, r.json()) == (422, {"error": "range_too_long"}), path
        assert team.boss[0].get(path, params={"from": "2026-01-01", "to": "2026-12-31"}).status_code == 200, path
    assert team.boss[0].get("/api/visits/report", params={"from": "2024-01-01", "to": "2024-12-31"}).status_code == 200  # 366 days


def test_bad_dates_and_reversed_range(team):
    assert team.boss[0].get("/api/visits/report", params={"from": "nope", "to": "2026-11-30"}).status_code == 422
    assert team.boss[0].get("/api/visits/report", params={"from": "2026-11-30", "to": "2026-11-01"}).status_code == 422
    assert team.boss[0].get("/api/visits/report", params={"to": "2026-11-01"}).status_code == 422


@pytest.mark.parametrize("path", ["/api/visits/report", "/api/visits/report.csv", "/api/visits/report/1"])
def test_static_routes_are_not_swallowed_by_the_visit_route(team, path):
    r = team.boss[0].get(path, params=RANGE)
    assert r.status_code == 200, r.text
