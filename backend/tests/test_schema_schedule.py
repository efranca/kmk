import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaA"


def add_user(conn, username="alice"):
    return conn.execute(
        text(
            "INSERT INTO users (username, email, password_hash, role, locale, status) "
            "VALUES (:u, :e, :h, 'user', 'fr-CA', 'active') RETURNING id"
        ),
        dict(u=username, e=f"{username}@example.com", h=HASH),
    ).scalar()


def add_event(conn, user_id, **overrides):
    values = dict(
        title="Visit", all_day=False, start_date="2026-11-05", start_time="09:00", duration_minutes=60,
        recurrence=None, ends_on=None, max_count=None, color=None, by=user_id,
    )
    values.update(overrides)
    return conn.execute(
        text(
            "INSERT INTO events (title, all_day, start_date, start_time, duration_minutes, recurrence, ends_on, "
            "max_count, color, created_by, updated_by) VALUES (:title, :all_day, :start_date, :start_time, "
            ":duration_minutes, CAST(:recurrence AS jsonb), :ends_on, :max_count, :color, :by, :by) RETURNING id"
        ),
        values,
    ).scalar()


def rejected(owner_engine, **overrides):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            add_event(c, add_user(c), **overrides)


RULE = '{"freq":"weekly","interval":1,"weekdays":["THU"],"month_day":null,"nth_weekdays":[]}'


def test_app_role_has_full_dml_on_schedule_tables(owner_engine, app_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
    with app_engine.begin() as c:
        eid = add_event(c, uid)
        c.execute(text("INSERT INTO event_people (event_id, user_id) VALUES (:e, :u)"), dict(e=eid, u=uid))
        c.execute(
            text("INSERT INTO event_exceptions (event_id, original_date, cancelled) VALUES (:e, '2026-11-05', true)"),
            dict(e=eid),
        )
        c.execute(text("INSERT INTO event_reminders (event_id, amount, unit) VALUES (:e, 2, 'hours')"), dict(e=eid))
        c.execute(
            text("INSERT INTO reminder_dismissals (user_id, event_id, occurrence_date) VALUES (:u, :e, '2026-11-05')"),
            dict(u=uid, e=eid),
        )
        c.execute(text("UPDATE events SET title = 'Visit 2' WHERE id = :e"), dict(e=eid))
        assert c.execute(text("SELECT title FROM events WHERE id = :e"), dict(e=eid)).scalar() == "Visit 2"
        c.execute(text("DELETE FROM events WHERE id = :e"), dict(e=eid))


def test_timed_event_needs_start_time(owner_engine):
    rejected(owner_engine, all_day=False, start_time=None)


def test_all_day_event_rejects_start_time(owner_engine):
    rejected(owner_engine, all_day=True, start_time="09:00")


def test_blank_title_is_rejected(owner_engine):
    rejected(owner_engine, title="   ")


def test_duration_must_be_in_range(owner_engine):
    rejected(owner_engine, duration_minutes=0)
    rejected(owner_engine, duration_minutes=1441)


def test_end_rule_not_both(owner_engine):
    rejected(owner_engine, recurrence=RULE, ends_on="2026-12-31", max_count=3)


def test_end_rule_needs_recurrence(owner_engine):
    rejected(owner_engine, recurrence=None, ends_on="2026-12-31")
    rejected(owner_engine, recurrence=None, max_count=3)


def test_max_count_must_be_positive(owner_engine):
    rejected(owner_engine, recurrence=RULE, max_count=0)


def test_color_must_be_in_palette(owner_engine):
    rejected(owner_engine, color="brown")
    with owner_engine.begin() as c:
        add_event(c, add_user(c), color="teal")


def test_deleting_event_cascades_people_exceptions_reminders(owner_engine):
    with owner_engine.begin() as c:
        uid = add_user(c)
        eid = add_event(c, uid, recurrence=RULE)
        c.execute(text("INSERT INTO event_people (event_id, user_id) VALUES (:e, :u)"), dict(e=eid, u=uid))
        c.execute(text("INSERT INTO event_exceptions (event_id, original_date) VALUES (:e, '2026-11-12')"), dict(e=eid))
        c.execute(text("INSERT INTO event_reminders (event_id, amount, unit) VALUES (:e, 1, 'days')"), dict(e=eid))
        c.execute(
            text("INSERT INTO reminder_dismissals (user_id, event_id, occurrence_date) VALUES (:u, :e, '2026-11-12')"),
            dict(u=uid, e=eid),
        )
        c.execute(text("DELETE FROM events WHERE id = :e"), dict(e=eid))
        for table in ("event_people", "event_exceptions", "event_reminders", "reminder_dismissals"):
            assert c.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0


@pytest.mark.parametrize("amount,unit", [(1, "minutes"), (0, "hours"), (100, "days")])
def test_reminder_unit_and_amount_checks(owner_engine, amount, unit):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            eid = add_event(c, add_user(c))
            c.execute(
                text("INSERT INTO event_reminders (event_id, amount, unit) VALUES (:e, :a, :u)"),
                dict(e=eid, a=amount, u=unit),
            )


def test_exception_duration_check(owner_engine):
    with pytest.raises(IntegrityError):
        with owner_engine.begin() as c:
            eid = add_event(c, add_user(c), recurrence=RULE)
            c.execute(
                text("INSERT INTO event_exceptions (event_id, original_date, duration_minutes) VALUES (:e, '2026-11-12', 0)"),
                dict(e=eid),
            )
