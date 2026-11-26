# Personal calendar feed for FamillAI (short design)

Date: 2026-11-26. Status: draft for the owner's approval. Size: a small feature (one table, one public route, three
account routes, one small card).

## Intent and why

The owner wants the KMK Schedule to show up in FamillAI, the family app. FamillAI already reads Google, Apple and
Outlook calendars, but only by a pasted iCal (`.ics`) link, one direction, read-only, refreshed about every 10 minutes
(`famillai/docs/superpowers/specs/2026-11-25-calendar-import-design.md`). KMK publishes no such link today. This adds
it. **FamillAI does not change.**

## Goals

- Each signed-in KMK user can create a **personal feed link** from the Account page and paste it into FamillAI.
- The feed carries only the events **that list that user** (a row in `event_people`). Events for "everyone" (no
  people listed) are **not** included (owner's decision).
- Per event: **title, date and time only** (owner's decision). No notes, location, icon, people, reminders.
- The link can be revoked (regenerate or delete); the old one stops working at once.
- The same link also works in Google Calendar ("From URL"), Apple Calendar (`webcal://`) and Outlook ("Subscribe from
  web"). It is **a single link per user** (owner's decision): revoking it cuts off every app using it at once, and
  the card says so. Google refreshes subscribed links slowly (hours, not controllable), unlike FamillAI's ~10 minutes.

## Non-goals

- Writing back from FamillAI to KMK. Two-way sync. Reminders or push through the feed.
- A company-wide feed, or a feed for a person other than the signed-in user.
- Tasks, quotes or anything other than Schedule events.
- Showing the full link again after creation (only a hash is stored).

## Anti-goals (a failure even if it works)

- A feed that includes another person's events, unassigned events, or any field beyond title and time.
- A raw token stored, logged by the app, put in an audit row, or returned after creation.
- Token guessing or enumeration: every bad token gets the same 404, in the same time, with rate limiting.
- The feed route weakening the guard: it is the **only** token-authenticated route and is listed explicitly.

## Approaches

- **A. A personal feed link for each user (chosen).** Token per user, hash stored, generated on request from the
  existing expansion code, nothing else stored.
- **B. One company-wide link.** Simpler, but exposes everyone's events to whoever holds it. Rejected.
- **C. FamillAI signs in to KMK.** FamillAI cannot do MFA, so it would need a special service account. Rejected.

## Design (my calls, for the owner to correct)

**Storage.** New table `calendar_feeds` (migration `0015`, hand-written SQL, `app/models.py` in step): `user_id`
(primary key, FK to `users`, `ON DELETE CASCADE`), `token_hash` (unique), `created_at`, `last_used_at`. One feed per
user. The runtime role `kmk_app` gets the same privileges as other tables.

**Token.** `new_session_token()` / `hash_token()` from `app/security.py`, the same helpers used for session and
single-use tokens (not `issue_token`, which is single-use and expiring). Creating a new one replaces the old row.

**Routes.**
- `POST /api/account/calendar-feed`: guarded (`Depends(guard())`, CSRF). Creates or replaces the feed and returns the
  full URL **once**: `{public_base_url}/api/schedule/feed/{token}.ics`. Audit `calendar_feed_created`.
- `DELETE /api/account/calendar-feed`: guarded. Revokes. Audit `calendar_feed_revoked`.
- `GET /api/account/calendar-feed`: guarded. Returns `{exists, created_at, last_used_at}`, never the link.
- `GET /api/schedule/feed/{token}.ics`: **public, token-authenticated**, no cookie and no CSRF (it is a GET that
  changes nothing except `last_used_at`). Added to the public-route list in `tests/test_mfa_guard.py` with a comment.
  Disabled users, and users whose account is not active, get the same 404 as a bad token.

**Rate limiting.** Failed lookups by address, using the existing limiter with its own `kind` (`"feed"`) and
`ratelimit.serialize`. Constant-time comparison is not needed (lookup by hash), and a bad token and a revoked token
return the identical 404.

**Content.** Window: 31 days back to 365 days ahead (under `MAX_RANGE_DAYS = 400`). For each event listing the user
(strictly `user in people`, unlike the on-screen filter, which also shows unassigned events), expand with the
existing `expand()` and write one `VEVENT` per occurrence: `UID` = `{event_id}-{original_date}@kmk-entretien.ca`,
`SUMMARY` = title, `DTSTART`/`DTEND` (or `VALUE=DATE` for all-day), `DTSTAMP`. Cancelled occurrences are simply
absent. Times are the company wall-clock time; the feed declares `America/Toronto` through `X-WR-TIMEZONE` and a
`VTIMEZONE`, so DST stays right in FamillAI. `SUMMARY` is escaped and long lines are folded per RFC 5545. Response
headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, no-store`.

**Account page.** A small "Calendar feed" card (en/fr/pt keys, flat, in all three locale files): create, copy the
link, revoke, and the line "Anyone with this link can read your event titles and times. Revoke it if it leaks."
Copy states how to paste it into FamillAI (My calendars, Connect a calendar).

**Recommendation to the owner for FamillAI's side:** leave the new calendar on "Busy only" if the titles should not
reach the family. With "Everyone sees details" FamillAI shows the titles.

## Constraints

- Test first (watch it fail): feed contains only assigned events; unassigned events absent; title and time only (no
  notes in the output, checked by searching the raw body); revoked, regenerated, unknown and disabled-user tokens give
  the same 404; the route is in the guard test's public list; repeating events, an exception, a cancelled occurrence
  and an all-day event come out right; DST day.
- No new compose setting (`public_base_url` already exists).
- Docs: `docs/security.md` (a new token-authenticated read route, and that the token travels in the URL so it
  appears in Caddy and Cloudflare access logs), `docs/operations.md` (how to revoke), `docs/roadmap.md`.
- Raise the minor version in `frontend/package.json` and `backend/pyproject.toml`.

## Risks, said plainly

- The link is a bearer secret with no MFA. That is the nature of `.ics` subscriptions. Mitigations: hashed, revocable,
  rate-limited, read-only, title and time only.
- Titles may still contain client names. The owner accepted this.
- Cloudflare might challenge FamillAI's server-side fetch. Not verified; we find out in the first end-to-end test
  after deploy, and a Cloudflare skip rule for `/api/schedule/feed/` would be the fix.

## Left to the builder

Exact `.ics` serializer (hand-written is enough; a library is optional), the card's layout, the migration's grants,
and test file names.
