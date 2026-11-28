# Security review record

Two parts: the **checklist** (what was checked, how, and the result) and the **independent review** (findings and what was done about them).
Checked on **2026-11-17** against the running system and the code at that date. Mechanisms are described in [security.md](security.md).

## 1. Checklist with evidence

"Live" means a command run against the running system on that date. "Test" names an automated test in `backend/tests/` that proves the behavior (the suite passes: 285 backend, 83 frontend tests at the time).

### Transport and headers
| Item | How it was checked | Result |
| --- | --- | --- |
| HTTPS only | live: `curl -sI http://app.kmk-entretien.ca/` | `301` redirecting to `https://app.kmk-entretien.ca/` (Cloudflare "Always Use HTTPS") |
| HSTS | live: header at the origin and through Cloudflare | `Strict-Transport-Security: max-age=31536000` on both. **Decision: no preload and no `includeSubDomains`** (it would pin every subdomain, including the public site, to HTTPS-only and is hard to undo) |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` | live: origin and Cloudflare | `nosniff`, `DENY`, `same-origin` on both |
| Content-Security-Policy | live: origin and Cloudflare | present on both: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| No server banner | live: origin | no `Server` header from Caddy. Cloudflare adds `server: cloudflare` at its edge (accepted) |
| API documentation not exposed | live: `/api/docs`, `/api/redoc`, `/api/openapi.json` | `404` JSON. (`/docs` and `/openapi.json` outside `/api` return the single-page app, not API docs) |

### Cookies and CSRF
| Item | How it was checked | Result |
| --- | --- | --- |
| Cookie flags (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`, 5-day `Max-Age`) | test: `test_cookie_attributes_when_secure` (`test_auth.py`) | pass. Live inspection in a browser's developer tools after a sign-in is an optional owner check |
| CSRF: Origin check | live: login POST without `Origin` and with a foreign `Origin` | `403` and `403`; test: `test_mutating_requests_need_origin_and_csrf` |
| CSRF: per-session token | tests: `test_mutating_requests_need_origin_and_csrf`, `test_change_password`, the admin tests | pass |

### Real client addresses
| Item | How it was checked | Result |
| --- | --- | --- |
| The recorded address is the visitor's, not spoofable | live: login probe through Caddy with `Cf-Connecting-Ip: 203.0.113.77` and a forged `X-Real-Client-Ip: 9.9.9.9` | the audit rows for the probe carry `203.0.113.77` only. Tests: `test_client_ip_header_trusted_only_from_loopback`, `test_client_ip` |

### Application
| Item | How it was checked | Result |
| --- | --- | --- |
| Generic login and reset answers | live: unknown user login, unknown identifier forgot-password; tests `test_failures_are_indistinguishable`, `test_forgot_password_identical_for_every_state`, `test_unknown_user_still_runs_a_verify` | `{"error":"invalid_credentials"}` `401`; `202 {"status":"ok"}`; tests pass (same status and body for every account state; a verification is always run) |
| Rate limiting | live: six bad logins for a made-up name | `401` x5 then `429`; tests for each kind (`test_rate_limit_*`, `test_set_password_token_rate_limit`, `test_wrong_codes_are_rate_limited_and_audited`) |
| Passwords hashed with Argon2id | live: prefix of the stored hash | `$argon2id$` |
| Tokens hashed, single use, expiring; link in the fragment | tests: `test_concurrent_redeem_has_exactly_one_winner`, `test_bad_tokens_are_generic`, `test_templates_in_every_language` | pass |
| Sessions server-side, revoked on the events listed in security.md | tests: `test_session_expired_revoked_or_user_disabled_rejected`, `test_reset_flow_revokes_all_sessions`, `test_change_password`, lifecycle tests | pass |
| Every protected route is behind the guard | test: `test_verify_state_blocks_every_protected_route` (calls every route in the API description) | pass |
| Authority rules | tests: `test_authority_matrix` (full table), `test_listed_actions_match_what_the_endpoints_allow` | pass |
| TOTP secrets encrypted at rest | test: `test_enrollment` (the stored value is a Fernet token, not the secret). Live: no account has enrolled yet | pass (test); live check pending the owner's enrollment |
| No secrets in audit rows or logs | tests: `test_secrets_never_reach_audit_or_logs`, `test_audit_and_logs_never_hold_secrets` | pass |
| Audit log is append-only for the app | live: `has_table_privilege('kmk_app','audit_log', ...)`; and (after review F9) the API process no longer holds the owner credentials: `docker exec kmk-api printenv` has no `MIGRATION_DATABASE_URL` | `SELECT` false, `INSERT` true, `UPDATE` false, `DELETE` false; owner URL absent from the API environment |
| Input validation on every endpoint (Pydantic) | code and tests: length limits, enums, `422` tests (`test_oversized_input`, `test_locale_validation`, admin validation tests) | pass |

### Secrets and hosts
| Item | How it was checked | Result |
| --- | --- | --- |
| Secrets only in git-ignored `.env`, never in git | live: `git ls-files` finds no `.env`; the real database password, `SESSION_SECRET` and `MFA_ENCRYPTION_KEY` values were searched in the whole git history (values not printed) | 0 tracked `.env` files; 0 occurrences of each secret |
| `.env` files protected | live: `stat` | mode `600` on `deploy/.env` and `backend/.env` |
| No secrets baked into the container image | live: environment of the image | only `PATH`, `LANG`, `GPG_KEY` (the public signing key id of the Python release team, in the base image), `PYTHON_VERSION`, `PYTHON_SHA256`, `PYTHONUNBUFFERED`, `PIP_NO_CACHE_DIR` |
| API container runs as a non-root user | live: `docker exec kmk-api id -u` | `10001` |
| Nothing exposed beyond loopback | live: `ss -ltn` | `127.0.0.1:8081` (Caddy), `127.0.0.1:8001` (API), `127.0.0.1:5432` (Postgres) |
| Firewall: "only 80/443 open" (from `scope.md`) | not applicable: access is through the Cloudflare Tunnel, no inbound ports are needed | n/a. **Heads-up, outside this project:** other services on this computer listen on all interfaces (for example Portainer, LiteLLM, the remote desktop). They are reachable from the home network only (no inbound access from the internet), but they share this computer |
| Automatic OS security updates | live: `apt-daily-upgrade.timer` and `unattended-upgrades` enabled and active; allowed origins include the distribution | pass |
| Containers start at boot and restart | live: `docker` service enabled; restart policy | `enabled`; `unless-stopped` for both containers |
| Time synchronized (TOTP depends on it) | live: `timedatectl` | `NTPSynchronized=yes` |
| Dependency vulnerabilities | `scripts/audit-deps.sh` (pip-audit and npm audit) | first run: one finding, `pip` 26.1.2 in the development virtualenv (a build tool, not part of the deployed app; fixed in 26.2); upgraded to 26.3; the container image has `pip` 26.2.2 (not affected). After that: Python clean, JavaScript (production, high or worse) clean |
| Bounded logs, health checks | live: `docker inspect` | log options `max-size 10m`, `max-file 5` on both; both containers `healthy` |
| Backups | see [operations.md](operations.md) and [golive.md](golive.md) | backups are built and tested; since 2026-11-28 they are plain (unencrypted) files without `deploy/.env`, a choice recorded in decisions D14; the timer is enabled by the owner |

### Owner to confirm (not verifiable from this computer)
- Cloudflare: the tunnel's published route for `app.kmk-entretien.ca` points to `http://localhost:8081` (the public URL working is the evidence), and "Always Use HTTPS" is on (the `301` above is the evidence). Nothing else in the Cloudflare dashboard is required by the application.
- Resend: domain verification, SPF, DKIM and DMARC records (see [operations.md](operations.md)), done when email is switched on.

## 2. Independent review

**Who and how.** A fresh reviewer (a separate AI agent with no memory of building the system, on the most capable available model) read the whole code base **read-only**: `backend/app/`, the four migrations, `frontend/src/`,
`deploy/` (Caddyfile, compose, Dockerfile, the backup scripts and systemd units) and the documentation, against the design documents and `docs/security.md`. It ran nothing, changed nothing, sent no requests to the running system and was told not to open any `.env` file.
Date: 2026-11-17. The owner approved launching it. Before acting on its report I checked each important claim against the code myself.

**Result:** no Critical findings, 9 Important, 15 Minor. Grades below are the *effect-based* grades after my re-grading (one finding was raised from Minor to Important).

### Important findings: all fixed, each with a test written first

| ID | Finding | Fix | Test (written first, watched failing) |
| --- | --- | --- | --- |
| F1 | Correcting an invited user's email left the first invite link (sent to the mistyped address) valid: whoever owned that address could take the account | changing the email now cancels the user's unused invite and reset links; the admin presses "Resend invitation" for the corrected address | `test_changing_the_email_cancels_the_old_invite_link`, `test_correcting_an_invited_email_kills_the_first_invite_link` |
| F2 | The incident playbook for a stolen account could not be followed: "reset password" was refused for a disabled account, and enabling first re-opened the account to the attacker | an admin may reset the password of a **disabled** account; the link sets the password but does **not** re-enable it; only an admin enabling the account lets the person in. Runbook updated | `test_takeover_playbook_disable_reset_password_then_enable` (plus updated `test_admin_reset`, `test_state_allows`, `test_bad_tokens_are_generic`) |
| F3 | The rate limiter was check-then-act: about 40 parallel requests all passed the check before any failure was recorded, giving many times the allowed password and TOTP guesses | attempts for the same address and the same identifier now take turns (transaction advisory locks) on login, forgot-password, set-password, change-password and every two-step endpoint | `test_parallel_password_guesses_cannot_exceed_the_limit`, `test_parallel_guesses_from_one_address_cannot_exceed_the_address_limit`, `test_parallel_wrong_codes_cannot_exceed_the_limit` (stable over repeated runs) |
| F4 | Every rate-limited request wrote an audit row (append-only, the app cannot delete): an unauthenticated flood could fill the disk | no audit row per limited request; one `login_rate_limited` row when a limit is first reached | `test_a_flood_of_limited_requests_writes_one_lockout_row`, `test_a_flood_from_one_address_writes_one_lockout_row` |
| F5 | Cheap denial of service: Argon2 uses 64 MiB per call with no concurrency cap, IPv6 limits keyed on the exact address (a /64 is 2^64 addresses), unbounded request bodies, no container memory limits | at most 4 Argon2 calls at once; IPv6 counted per /64; Caddy refuses API bodies over 64 KB (`413`, verified live); api memory 1 GB / caddy 512 MB, 256 processes, all capabilities dropped (Caddy keeps only `NET_BIND_SERVICE`), `no-new-privileges` | `test_ip_key_*`, `test_addresses_in_one_ipv6_prefix_share_the_address_limit`, `test_argon2_work_is_capped_in_parallel`, `test_the_proxy_limits_request_bodies_for_the_api`, `test_containers_are_hardened` |
| F6 | Backup retention sorted by file modification time on an NTFS share: files with future times (Windows, clock skew) could make it delete the backup just written | retention goes by the timestamp in the file name, never deletes the new file, and verifies it still exists | `test_retention_goes_by_the_name_not_the_modification_time` |
| F7 | Backup archives were not authenticated: anyone who could write to the share could add an archive encrypted to the public key, and a restore rehearsal would run its SQL as the database superuser | the backup records each archive's hash on the Linux disk; `kmk-restore.sh` refuses archives not in that list unless the owner passes `--accept-unverified` | `test_restore_refuses_an_archive_the_backup_did_not_write`, `test_backup_records_the_hash_of_every_archive_it_writes` |
| F8 | An unexpected error in the backup script left the previous "ok" status, so the status check reported OK | any non-zero exit now records a failed status | `test_an_unexpected_error_still_records_a_failed_status` |
| F9 | The long-running API process held the database **owner** credentials (it migrated at start), so "append-only audit log" did not hold against an application compromise | migrations moved to a one-shot `migrate` service; the API's environment lists its variables explicitly and does not contain the owner URL (verified live) | `test_the_api_never_receives_the_database_owner_credentials`, `test_migrations_run_in_their_own_one_shot_service` |
| F11 | *(reported Minor, re-graded Important)* The raw typed login name was stored forever in the append-only audit log, and people paste passwords there; this also contradicted `security.md` | the typed name is stored only when it names a real account (otherwise `{"known": false}`) | `test_audit_never_stores_what_was_typed_for_an_unknown_account` |

An incident during the fix pass is recorded honestly: the first deploy of the container hardening dropped every capability from the Caddy container, which prevented it from starting (its binary carries a file capability), and the site was down for about five minutes until I added `NET_BIND_SERVICE`. The tests checked the configuration, not that the container starts; the lesson (deploy hardening one service at a time and watch its health) is noted in the runbook.

### Minor findings: not fixed in this phase (recorded, owner decides)

| ID | Finding | Note |
| --- | --- | --- |
| F10 | Each account has two rate-limit identifiers (username and email), so the per-account limit is effectively doubled | `security.md` now says so |
| F12 | A TOTP code written with non-ASCII digits gives a 500 error (no bypass, but the attempt is not counted) | one-line fix when convenient |
| F13 | The client address actually reaches the application through uvicorn's own `X-Forwarded-For` handling, not only the documented `X-Real-Client-Ip` path | works today (verified live); starting uvicorn with `--no-proxy-headers` would make the documented path the only one |
| F14 | Disabling an account does not void its unused links; re-enabling brings them back | |
| F15 | `forgot-password` timing still differs by a few milliseconds for an existing active account | `security.md` softened |
| F16 | The backup compares the restored dump with the **live** database after the dump: a busy moment can give a false failure | only if a run happens during traffic (the overnight run normally does not) |
| F17 | The scratch and restore database names are not restricted to a safe pattern | needs an operator mistake |
| F18 | A failed weekly copy is silent and leaves `.partial` files | |
| F19 | The session cookie has no `__Host-` prefix (a sibling subdomain could set a same-named cookie) | |
| F20 | No idle timeout or cleanup of expired sessions; unverified two-step sessions live five days | |
| F21 | Admin email actions (invite, resend, reset) have no rate limit | needs a stolen admin session |
| F22 | Recovery codes are unsalted SHA-256 of about 49.5-bit values | cheaper to change before anyone enrolls |
| F23 | Settings are not validated at startup (default `SESSION_SECRET`, an invalid Fernet key gives a 500) | |
| F24 | Remaining container hardening: read-only filesystem, base image pinned by digest, a hash-locked dependency file | |

### Claims in `docs/security.md` that the review found untrue or unproven

Corrected in the documentation in this phase: the append-only claim (now true after F9), "details never contain passwords" (now true after F11), "5 per identifier" (username and email count separately), the timing claim (softened), the client-address mechanism (both paths described), "guard before request validation" (the body is size-limited at the proxy), "issuing a new link cancels older ones" (now also when the email changes), the recovery-code strength (about 50 bits, unsalted), the "not covered yet" list (a restore script and a manual dependency scan now exist), and "plaintext never touches a disk" (it lives in memory-backed storage, which can be swapped; the restore's extract option writes files).

### Declined to judge (by the reviewer) and my ruling
- *Cloudflare dashboard settings (WAF, rate-limit rules, Bot Fight):* not visible from here. A rate-limit rule on `/api/auth/*` would add a layer in front of F3 to F5; the owner decides whether to add one.
- *HSTS without `includeSubDomains`/preload:* a documented decision (section 1); noted that it leaves F19 more open.
- *Compression side channels, spoofing by local processes, `frontend/dist` matching the source, tar extraction safety:* no practical attack found or accepted risk; the tar point only matters after F7, which is now closed.
- *Already accepted risks* (password policy, 15-minute lockout, optional two-step, same-disk backups, dev email backend, other host services, shared database, no audit viewer, no key rotation): unchanged.

### Areas the reviewer examined and found sound
CSRF coverage (every mutating route), login enumeration and the single Argon2 verification, session handling and revocation, token generation and atomic redemption, the two-step state machine and replay protection, the authority policy and lifecycle (traced by hand, including the last-admin check), parameterized SQL everywhere (no injection found), generic error bodies, the email layer (address validation, HTML escaping, no key leakage), the migrations and grants, the CLI, the frontend (no `dangerouslySetInnerHTML`, token removed from the address bar, language whitelist, CSRF token in memory only), the Caddyfile, and the backup scripts' quoting, temporary files, key handling, mount guard and refusal to delete on failure.
