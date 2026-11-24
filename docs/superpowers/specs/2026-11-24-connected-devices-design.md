# Connected devices and users (super admin only)

## Intent
The super admin sees who is signed in, from which device and place, and can end any session (a lost phone, a former employee, something odd). Modeled on FamillAI's connected-devices design, restricted to the super admin for now; an "own devices" panel for everyone is a later step on the same data.

## Goals
- New page **Devices** (`/devices`, nav entry shown only to the super admin), grouped by person: avatar, name, role chip, then one row per **active** session (not revoked, not expired): browser and OS (parsed from the user agent), last access (relative time), last IP, approximate location with flag, when the session started, "This device" on the caller's own session, and a **Sign out** button (with confirmation). Per person: **Sign out all devices**.
- The page says plainly: signing a device out does not block it; to keep someone out, also reset the password or disable the account.
- Backend (all through `Depends(guard())` and `policy.check`, new actions `view_sessions` and `revoke_sessions`, super admin only):
  - `GET /api/admin/devices` -> `{users: [{user: {id, name, username, role, avatar_url}, sessions: [{id, user_agent, created_at, last_seen_at, ip, country, city, current}]}]}`.
  - `DELETE /api/admin/devices/{id}` ends one session (404 `device_not_found` otherwise). Ending the caller's own current session behaves like logout.
  - `POST /api/admin/users/{user_id}/devices/logout-all` ends all of a person's sessions (including the caller's own when the target is the caller).
  - Audit rows `session_revoked` and `sessions_revoked_all` (actor, target user, no user agent or IP in details).
- Migration `0010`: `sessions` gains `id uuid default gen_random_uuid()` (unique, the public handle; the token hash is never exposed), `last_seen_at timestamptz default now()`, `last_ip text`, `country char(2)`, `city varchar(100)`. `kmk_app` already has table-level rights on `sessions`; add column grants if the table's are column-limited (check in the plan).
- **Recording:** login/session creation sets the same fields. On each authenticated request the guard's session lookup updates last access, IP and location with at most one write per 5 minutes per session (conditional `UPDATE ... WHERE last_seen_at < now() - interval '5 minutes'`), so reads don't become writes.
- **Location** comes only from Cloudflare headers (`Cf-Ipcountry`, always present on tunnel traffic; `Cf-Ipcity` only when the "Add visitor location headers" Managed Transform is on, which the owner turns on in the dashboard; documented in `docs/operations.md`). Caddy passes them as `X-Geo-Country` and `X-Geo-City` (`header_up`), the app sanitizes (2 letters A-Z; city trimmed, control characters removed, 100 chars). IPs and locations never leave the server. Honest limit: if the Managed Transform is off a client could send its own `Cf-Ipcity`, so location is **informational, never used for a security decision**, shown as "approx." and rendered only as text.
- Private or missing IP: "Local network" / no location. Flags are emoji built from the country code (Windows shows letters; accepted).

## Non-goals and anti-goals
No "block this device" (a promise nothing can keep). No access history or per-request log. No external geolocation service. No device naming. No view for admins or for people's own devices in this round.

## Approaches
1. **Cloudflare headers (chosen).** No dependency, nothing sent to third parties; covers tunnel traffic, which is all the traffic here.
2. Local GeoIP database. Monthly updates and attribution for little gain.
3. External lookup API. Rejected: sends employees' IPs to a third party.

## Tests
Backend: only the super admin (admin and user get 403; half-authenticated refused by guard test); list excludes revoked and expired; revoke one, revoke all, own session; unknown id 404; revoked session's cookie stops working; throttled last-seen write; header sanitizing; audit rows have no IP/UA. Frontend: user-agent parser table, relative time, grouping, confirm dialogs, nav hidden for non-super-admins.
