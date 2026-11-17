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
| Audit log is append-only for the app | live: `has_table_privilege('kmk_app','audit_log', ...)` | `SELECT` false, `INSERT` true, `UPDATE` false, `DELETE` false |
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
| Backups | see [operations.md](operations.md) and [golive.md](golive.md) | encrypted backups are built and tested; the timer is enabled after the owner's key ceremony |

### Owner to confirm (not verifiable from this computer)
- Cloudflare: the tunnel's published route for `app.kmk-entretien.ca` points to `http://localhost:8081` (the public URL working is the evidence), and "Always Use HTTPS" is on (the `301` above is the evidence). Nothing else in the Cloudflare dashboard is required by the application.
- Resend: domain verification, SPF, DKIM and DMARC records (see [operations.md](operations.md)), done when email is switched on.

## 2. Independent review

*To be completed in this phase: who reviewed, scope, findings with their grade and outcome.*
