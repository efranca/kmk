# Personal Calendar Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each KMK user can create one secret `.ics` link that publishes the Schedule events they are listed on (title and time only), for FamillAI, Google, Apple or Outlook to subscribe to.

**Architecture:** A `calendar_feeds` table stores one token hash per user. Three guarded account routes create, read and revoke it. One public route looks the token up by hash, expands the user's events with the existing `expand()`, and serializes them with a small hand-written iCalendar writer (pure module). A card on the Account page drives it.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic (hand-written SQL), pytest; React, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-calendar-feed-design.md`

## Global Constraints

- Only events where the user is in `event_people`. Events with no people are excluded.
- Each `VEVENT` holds only `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`. No notes, location, icon, color, people, reminders.
- Window: 31 days before today to 365 days after today (company time zone, `America/Toronto`).
- `UID` = `{event_id}-{original_date ISO}@kmk-entretien.ca`.
- Feed URL: `{settings.public_base_url}/api/schedule/feed/{token}.ics`. Token from `new_session_token()`, stored as `hash_token(token)`. Shown once, never returned again.
- Every failure of the feed route (unknown, revoked, malformed token, user not `active`) is `404 {"error": "not_found"}`. Limited callers get `429 {"error": "too_many_attempts"}`.
- Rate-limit kind `"feed"`, failures only, `ratelimit.serialize` before `is_limited`, identifier = first 16 hex chars of `hash_token(raw)`.
- Response headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, no-store`.
- Audit actions `calendar_feed_created`, `calendar_feed_revoked` via `audit.log(...)`, never with the token or URL.
- Migration `0015`, hand-written SQL, `GRANT SELECT, INSERT, UPDATE, DELETE ... TO kmk_app`; `app/models.py` in step.
- Every new UI string in `en.json`, `fr-CA.json`, `pt-BR.json` with the same keys, prefix `feed`.
- Minor version bump: `0.3.0` → `0.4.0` in `frontend/package.json` and `backend/pyproject.toml`.
- Test first, watch it fail. Commit after each task, messages ending with the trailer in the existing history.

## Review Focus

- **A title with a comma, semicolon, backslash or newline, or longer than 75 octets with accents/emoji.** It must come out escaped and folded on octet boundaries without splitting a UTF-8 character. Test in Task 1 (`test_escapes_and_folds_utf8`).
- **An event the user was listed on, then removed from.** It must disappear from the next fetch. Test in Task 3 (`test_removed_person_loses_event`).
- **A "this occurrence only" change that moves an occurrence's time or title, and a cancelled occurrence.** The moved one shows the new values with the same UID; the cancelled one is absent. Test in Task 3 (`test_exception_and_cancellation`).
- **An all-day event and a timed event that runs past midnight** (e.g. 23:00 for 120 min). All-day uses `VALUE=DATE` with `DTEND` the next day; the timed one ends at 23:59 the same day, as on screen (`expand()` caps at `END_OF_DAY`). Test in Task 1 (`test_all_day_dates`) and Task 3 (`test_late_event_ends_same_day`).
- **A user disabled after creating a link.** The feed returns 404 at once. Test in Task 3 (`test_disabled_user_gets_404`).

---

### Task 1: iCalendar writer (pure)

**Files:**
- Create: `backend/app/schedule/ics.py`
- Test: `backend/tests/test_schedule_ics.py`

**Interfaces:**
- Consumes: `Occurrence` from `app/schedule/occurrences.py` (fields `event_id, original_date, date, start_time, end_time, all_day, title`).
- Produces: `render_feed(occurrences: list[Occurrence], stamp: datetime) -> str` (CRLF line endings, ends with `END:VCALENDAR\r\n`); `escape_text(s: str) -> str`; `fold(line: str) -> str`.

- [ ] **Step 1: Write the failing tests**

```python
from datetime import date, datetime, time, timezone
from app.schedule.ics import escape_text, fold, render_feed
from app.schedule.occurrences import Occurrence

STAMP = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)

def occ(**kw):
    base = dict(event_id=7, original_date=date(2026, 11, 5), date=date(2026, 11, 5), start_time=time(9, 0),
                end_time=time(10, 0), all_day=False, title="Visit", notes="SECRET", repeating=False, modified=False)
    base.update(kw)
    return Occurrence(**base)

def test_calendar_envelope():
    out = render_feed([], STAMP)
    assert out.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//KMK Entretien//Schedule//EN\r\n")
    assert "X-WR-TIMEZONE:America/Toronto\r\n" in out and "BEGIN:VTIMEZONE\r\nTZID:America/Toronto\r\n" in out
    assert out.endswith("END:VCALENDAR\r\n")

def test_timed_event_fields_only():
    out = render_feed([occ()], STAMP)
    assert "UID:7-2026-11-05@kmk-entretien.ca\r\n" in out
    assert "DTSTAMP:20261126T120000Z\r\n" in out
    assert "DTSTART;TZID=America/Toronto:20261105T090000\r\n" in out
    assert "DTEND;TZID=America/Toronto:20261105T100000\r\n" in out
    assert "SUMMARY:Visit\r\n" in out
    assert "SECRET" not in out and "DESCRIPTION" not in out and "LOCATION" not in out

def test_all_day_dates():
    out = render_feed([occ(all_day=True, start_time=None, end_time=None)], STAMP)
    assert "DTSTART;VALUE=DATE:20261105\r\n" in out and "DTEND;VALUE=DATE:20261106\r\n" in out

def test_escapes_and_folds_utf8():
    assert escape_text("a,b;c\\d\ne") == "a\\,b\\;c\\\\d\\ne"
    line = "SUMMARY:" + "é" * 60
    folded = fold(line)
    parts = folded.split("\r\n ")
    assert all(len(p.encode()) <= 75 for p in parts)
    assert "".join(parts) == line  # no character split
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_schedule_ics.py`
Expected: FAIL, `ModuleNotFoundError: app.schedule.ics`.

- [ ] **Step 3: Implement `app/schedule/ics.py`**

`fold` splits on UTF-8 octets (first segment ≤ 75 octets, continuation segments ≤ 74 plus the leading space), never inside a character. `escape_text` escapes `\` first, then `;` `,` and newlines (`\r\n`, `\n` → `\n`). The `VTIMEZONE` for `America/Toronto` is a fixed block (STANDARD: `DTSTART:19701101T020000`, `RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU`, offset `-0400`→`-0500`, `TZNAME:EST`; DAYLIGHT: `DTSTART:19700308T020000`, `RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU`, `-0500`→`-0400`, `TZNAME:EDT`). Also emit `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `X-WR-CALNAME:KMK`. Every content line passes through `fold`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && .venv/bin/pytest -q tests/test_schedule_ics.py`
Expected: 4 passed.

- [ ] **Step 5: Commit**

`git add backend/app/schedule/ics.py backend/tests/test_schedule_ics.py && git commit -m "feat(schedule): iCalendar writer for the personal feed"`

---

### Task 2: Storage and the account routes

**Files:**
- Create: `backend/alembic/versions/0015_calendar_feeds.py`, `backend/app/schedule/feed.py`, `backend/tests/test_calendar_feed_api.py`
- Modify: `backend/app/models.py` (add `CalendarFeed`, and `"feed"` wherever `LoginAttempt.kind` values are listed), `backend/tests/conftest.py:69` (add `calendar_feeds` to the TRUNCATE list), `backend/app/main.py` (include `feed.router`), `backend/tests/test_schema_permissions.py` (if it enumerates tables, add `calendar_feeds`)

**Interfaces:**
- Produces:
  - Table `calendar_feeds(user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ NULL)`; `login_attempts_kind_valid` becomes `CHECK (kind IN ('login','reset_request','token','mfa','feed'))` (downgrade restores the 0004 list).
  - `CalendarFeed` model with those columns.
  - `router = APIRouter()` in `app/schedule/feed.py` with:
    - `POST /api/account/calendar-feed` → `201 {"url": str, "created_at": iso}`; `Depends(guard())`.
    - `GET /api/account/calendar-feed` → `200 {"exists": bool, "created_at": iso|None, "last_used_at": iso|None}`; `Depends(guard(csrf=False))`.
    - `DELETE /api/account/calendar-feed` → `204`; `Depends(guard())`; idempotent.
  - `feed_url(settings: Settings, raw: str) -> str`.

- [ ] **Step 1: Write the failing tests** (reuse `session`/`uid` helpers in the style of `test_schedule_api.py`)

```python
def test_create_returns_url_once(alice, owner_engine):
    c, h = alice
    r = c.post("/api/account/calendar-feed", headers=h)
    assert r.status_code == 201
    url = r.json()["url"]
    assert url.startswith("https://app.kmk-entretien.ca/api/schedule/feed/") and url.endswith(".ics")
    raw = url.rsplit("/", 1)[1][:-4]
    stored = sql(owner_engine, "SELECT token_hash FROM calendar_feeds")[0][0]
    assert stored == hash_token(raw) and raw not in stored
    info = c.get("/api/account/calendar-feed").json()
    assert info["exists"] is True and "url" not in info and raw not in str(info)

def test_regenerate_replaces(alice, owner_engine):
    c, h = alice
    first = c.post("/api/account/calendar-feed", headers=h).json()["url"]
    second = c.post("/api/account/calendar-feed", headers=h).json()["url"]
    assert first != second and sql(owner_engine, "SELECT count(*) FROM calendar_feeds")[0][0] == 1

def test_revoke(alice):
    c, h = alice
    c.post("/api/account/calendar-feed", headers=h)
    assert c.delete("/api/account/calendar-feed", headers=h).status_code == 204
    assert c.get("/api/account/calendar-feed").json() == {"exists": False, "created_at": None, "last_used_at": None}
    assert c.delete("/api/account/calendar-feed", headers=h).status_code == 204

def test_audit_has_no_token(alice, owner_engine):
    c, h = alice
    url = c.post("/api/account/calendar-feed", headers=h).json()["url"]
    c.delete("/api/account/calendar-feed", headers=h)
    rows = sql(owner_engine, "SELECT action, details::text FROM audit_log WHERE action LIKE 'calendar_feed_%' ORDER BY id")
    assert [r[0] for r in rows] == ["calendar_feed_created", "calendar_feed_revoked"]
    assert all(url.rsplit("/", 1)[1][:-4] not in (r[1] or "") for r in rows)

def test_post_needs_csrf(alice):
    c, _ = alice
    assert c.post("/api/account/calendar-feed", headers=ORIGIN).status_code == 403
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_calendar_feed_api.py`
Expected: FAIL (404 on the routes / missing table).

- [ ] **Step 3: Write migration `0015` (revises `0014`), the model, the TRUNCATE entry, and the routes in `app/schedule/feed.py`**

POST: `DELETE` then `INSERT` the row for `actor.id` in one transaction (or `INSERT ... ON CONFLICT (user_id) DO UPDATE`), `audit.log(db, "calendar_feed_created", actor_user_id=actor.id, ip=request_ip(...))`, commit, return the URL. DELETE: delete the row, audit only if a row was removed.

- [ ] **Step 4: Run migration and tests**

Run: `cd backend && .venv/bin/pytest -q tests/test_calendar_feed_api.py tests/test_mfa_guard.py tests/test_schema_permissions.py tests/test_ratelimit_kinds.py`
Expected: all pass (the three new routes are guarded, so `test_mfa_guard.py` needs no change yet).

- [ ] **Step 5: Commit**

`git commit -m "feat(schedule): store a personal calendar feed token"`

---

### Task 3: The public feed route

**Files:**
- Modify: `backend/app/schedule/feed.py`, `backend/app/schedule/service.py` (add one function), `backend/tests/test_mfa_guard.py:5-14` (add to `PUBLIC`)
- Test: `backend/tests/test_calendar_feed_api.py` (extend)

**Interfaces:**
- Consumes: `render_feed` (Task 1), `CalendarFeed` (Task 2), `service._data`, `service._exception_data`, `service._people_of`, `service._exceptions_of`, `expand`, `service.now_toronto()`.
- Produces: `service.assigned_occurrences(db: Session, user_id: int, from_: date, to: date) -> list[Occurrence]` (strictly `user_id in people`, sorted by date then start time); route `GET /api/schedule/feed/{token}.ics`.

- [ ] **Step 1: Write the failing tests**

```python
def feed(c, url):
    return c.get(url.replace("https://app.kmk-entretien.ca", ""))

def make_feed(c, h):
    return c.post("/api/account/calendar-feed", headers=h).json()["url"]

def test_only_assigned_titles_and_times(alice, bob, owner_engine, make_client):
    c, h = alice
    me, other = uid(owner_engine, "alice"), uid(owner_engine, "bob")
    create(c, h, title="Mine", notes="client address", people=[me])           # dates near today
    create(c, h, title="Everyone")                                            # no people
    create(c, h, title="Bobs", people=[other])
    r = feed(make_client(), make_feed(c, h))                                  # fresh client: no cookie
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/calendar; charset=utf-8"
    assert r.headers["cache-control"] == "private, no-store"
    assert "SUMMARY:Mine" in r.text
    assert "Everyone" not in r.text and "Bobs" not in r.text and "client address" not in r.text

def test_bad_tokens_same_404(alice, make_client):
    c, h = alice
    url = make_feed(c, h)
    anon = make_client()
    c.post("/api/account/calendar-feed", headers=h)                           # old url now revoked
    bodies = {(feed(anon, u).status_code, feed(anon, u).text) for u in
              [url, "/api/schedule/feed/nope.ics", "/api/schedule/feed/" + "a" * 43 + ".ics"]}
    assert bodies == {(404, '{"error":"not_found"}')}

def test_disabled_user_gets_404(alice, owner_engine, make_client): ...      # UPDATE users SET status='disabled'; 404
def test_removed_person_loses_event(alice, bob, owner_engine, make_client): ...  # PATCH people=[other]; title gone
def test_exception_and_cancellation(alice, owner_engine, make_client): ...  # weekly event; PATCH scope=this new title; DELETE scope=this another date; same UID for the moved one, cancelled UID absent
def test_late_event_ends_same_day(alice, owner_engine, make_client): ...    # 23:00 + 120 min → DTEND ...T235900
def test_window_bounds(alice, owner_engine, make_client): ...               # today-32 absent, today-31 present, today+365 present, today+366 absent (freeze service.now_toronto with monkeypatch)
def test_updates_last_used(alice, owner_engine, make_client): ...           # last_used_at set after a fetch
def test_failures_rate_limited(alice, make_client, monkeypatch): ...        # with rl_ip_max lowered via settings override, the (n+1)th bad token → 429; a good token from another IP still 200
```

The `bob` fixture is `session(make_client, add_user, "bob")`. Dates in these tests are computed from `date.today()` (or a frozen `now_toronto`), not fixed to November 2026.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_calendar_feed_api.py tests/test_mfa_guard.py`
Expected: feed tests FAIL with 404 from the router; `test_mfa_guard.py` still passes.

- [ ] **Step 3: Implement**

Route order: parse `{token}` (path segment ending `.ics`; anything else is the 404), `ratelimit.serialize(db, ip, ident, "feed")`, `is_limited(..., kind="feed")` → 429, look up `CalendarFeed` joined to `User` by `token_hash` with `User.status == 'active'`; on miss `record_attempt(..., False, kind="feed")`, `db.commit()`, then raise 404. On hit, set `last_used_at = now()`, compute today from `service.now_toronto().date()`, call `assigned_occurrences`, `render_feed(..., stamp=datetime.now(timezone.utc))`, commit, return `Response(content, media_type="text/calendar; charset=utf-8", headers={"Cache-Control": "private, no-store"})`. Add `("GET", "/api/schedule/feed/{token}.ics")` to `PUBLIC` in `test_mfa_guard.py` with a comment `# token in the URL (calendar subscription); see docs/security.md`. Note the guard test calls it with a half-authenticated session and expects the non-guard behavior (404 for its fake token).

- [ ] **Step 4: Run all backend tests**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

`git commit -m "feat(schedule): public .ics feed of a user's assigned events"`

---

### Task 4: Account page card

**Files:**
- Create: `frontend/src/settings/CalendarFeedCard.tsx`, `frontend/src/settings/CalendarFeedCard.test.tsx`
- Modify: `frontend/src/AccountPage.tsx` (render `<CalendarFeedCard csrfToken={csrfToken} />` after `ChangePassword`), `frontend/src/locales/en.json`, `fr-CA.json`, `pt-BR.json`

**Interfaces:**
- Consumes: the three account routes from Task 2.
- Produces: `CalendarFeedCard({ csrfToken }: { csrfToken: string })`.

Keys (English copy fixed here; fr-CA and pt-BR translated with the same meaning):
`feedTitle` "Calendar feed", `feedHint` "Add your KMK events (title and time only) to FamillAI, Google Calendar, Apple Calendar or Outlook. Only events you are listed on are included.", `feedCreate` "Create link", `feedRegenerate` "Create a new link", `feedRevoke` "Revoke link", `feedCopy` "Copy", `feedCopied` "Link copied", `feedShownOnce` "Copy this link now. It will not be shown again.", `feedWarning` "Anyone with this link can read your event titles and times. Revoking it cuts off every app that uses it.", `feedActive` "A link is active since {{date}}.", `feedLastUsed` "Last read {{date}}.", `feedNone` "No link yet.", `feedConfirmRevoke` "Revoke the link? Every app using it stops updating.", `feedConfirmRegenerate` "Create a new link? The current one stops working in every app."

- [ ] **Step 1: Write the failing tests** (mock `fetch` the way `Account.test.tsx` does)

- shows `feedNone` and `feedCreate` when `GET` returns `{exists:false,...}`;
- clicking Create sends `POST /api/account/calendar-feed` with header `X-CSRF-Token`, then shows the returned URL in a read-only input, `feedShownOnce`, and a Copy button that calls `navigator.clipboard.writeText(url)`;
- when `exists:true`: shows `feedActive`, Regenerate and Revoke; Revoke asks `feedConfirmRevoke` and sends `DELETE`; Regenerate asks `feedConfirmRegenerate` before `POST`;
- `feedWarning` is always visible;
- the URL is not shown after a reload (a fresh `GET`).
- locale key-set test (existing) passes with the new keys.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/settings/CalendarFeedCard.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the card** in the style of `NotificationsCard.tsx` (`section.section.settings-card`, `Button`, `ErrorNotice`, `useToast` for "Link copied"); confirmation uses the existing confirm dialog in `ui/` if there is one, otherwise `window.confirm`.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 5: Commit**

`git commit -m "feat(account): calendar feed card"`

---

### Task 5: Docs and version

**Files:**
- Modify: `docs/security.md` (new section: token-authenticated read route, hash-only storage, failures rate-limited under kind `feed`, uniform 404, the token travels in the URL and so appears in Caddy/Cloudflare access logs and in the subscribing app, title-and-time only, assigned events only), `docs/operations.md` (how a user revokes; how an admin removes one: `DELETE FROM calendar_feeds WHERE user_id = ...` as owner; possible Cloudflare skip rule for `/api/schedule/feed/` if Google or FamillAI get challenged), `docs/roadmap.md` (status), `docs/README.md` (feature list if it has one), `CLAUDE.md` (migrations `0001` to `0015`; `schedule/ics.py`, `schedule/feed.py` in the layout), `frontend/package.json` and `backend/pyproject.toml` (`0.4.0`).

- [ ] **Step 1: Update docs and versions as listed.**
- [ ] **Step 2: Verify** `cd backend && .venv/bin/pytest -q` and `cd frontend && npx vitest run && npm run build` pass, and `grep -n '"version"' frontend/package.json` / `grep -n '^version' backend/pyproject.toml` both show `0.4.0`.
- [ ] **Step 3: Commit** `git commit -m "docs: personal calendar feed; version 0.4.0"`

---

### After deploy (owner, not the assistant)

1. Create the link on the Account page, paste it into FamillAI (My calendars → Connect a calendar), choose "Busy only" or "Everyone sees details".
2. If FamillAI reports it cannot read the link, check Cloudflare's security events for `/api/schedule/feed/` and add a skip rule for that path.
3. Optionally subscribe from Google Calendar (Other calendars → From URL); expect slow refreshes.
