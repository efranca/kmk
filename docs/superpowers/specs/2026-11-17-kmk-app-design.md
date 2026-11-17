# app.kmk-entretien.ca: internal app (login, admin, welcome page)

Source of truth for product behavior: `/home/evandro/projects/kmk/scope.md` (the user's project plan, domain already
corrected to `kmk-entretien.ca`). This document records the decisions made on top of it, where our hosting differs from
what it assumes, and what is left to the builder. Where the two disagree, this document wins.

## Intent
An invite-only web app for about 15 employees of KMK Entretien: login, an admin page for users, and a static welcome
page. It is the base for later customer records and LiteLLM-powered AI features, so security and a clean data layout
matter more than feature count. It replaces the "Under Construction" placeholder already live at
`https://app.kmk-entretien.ca`.

## Goals, non-goals, anti-goals
- Goals: everything under "Scope (v1)" in `scope.md`; the six build phases in `scope.md` §11, in order.
- Non-goals (v1): as listed in `scope.md` §1 (AI, customer records, audit viewer, editable welcome page, dev/staging).
- Anti-goals: touching or restarting famillai's containers or its database; exposing any port beyond loopback; a design
  that makes later customer data or AI access harder to isolate.

## Constraints
- Home ISP is behind CGNAT. All access is through the existing Cloudflare Tunnel (the famillai `cloudflared`, hostname
  `app.kmk-entretien.ca` → `http://localhost:8081`, already configured). No inbound 80/443, no port forwarding.
- Cloudflare always proxies the hostname, and terminates HTTPS. The origin sees plain HTTP on loopback.
- Caddy already runs as `kmk-caddy` (host network, `127.0.0.1:8081`, trusted proxy `127.0.0.1`, `Cf-Connecting-Ip`).
- Port 8080 is famillai's. Port 8081 is kmk's Caddy. The kmk API takes `127.0.0.1:8001` (builder confirms it is free).
- No git repo exists in `kmk/` yet. The builder initializes one at the start of phase 1 (needed for the plan's workflow).

## Approaches considered
Hosting was settled earlier (separate `kmk` compose, own Caddy, reused tunnel). The open choice was Postgres:
- Own Postgres container (scope.md as written): full isolation, easy INSERT-only audit role and backups. Rejected by the user.
- **Shared Postgres container on `127.0.0.1:5432` with a new database `kmk`. Chosen by the user.** Same pattern as famillai.
  Trade-off: kmk shares a server, upgrades and backups with famillai; isolation comes from a separate database and roles.

## Decisions (differences from `scope.md`)
- **Containers:** two kmk containers, not three: `kmk-caddy` (exists) and `kmk-api` (FastAPI, `network_mode: host`, bound to
  `127.0.0.1:8001`, runs as non-root). Postgres is the existing shared one. `scope.md` §3 "three containers" and "Postgres never published
  to the host" are replaced by: Postgres is published on loopback only, as it already is.
- **Routing:** Caddy serves the built React app from a folder and proxies `/api/*` to `127.0.0.1:8001`. One origin, no CORS.
- **Database `kmk`**, created with `/home/evandro/projects/shared/scripts/pg-new-db.sh kmk` (the script famillai used). It creates a role `kmk`
  that owns database `kmk`. That role is the migration owner (no separate `kmk_owner`). A backup script, `pg-backup.sh`, sits next to it;
  the builder checks it covers `kmk`. Roles inside it:
  - `kmk` (created by the script): owns the schema, runs Alembic migrations only.
  - `kmk_app`: what the API connects as. DML on tables, but **INSERT only on `audit_log`** (no UPDATE/DELETE).
  - `kmk_ai_ro` (later, not now): read-only on a future customer schema.
  Connection: `postgresql+psycopg://…@127.0.0.1:5432/kmk`. A `kmk_test` database for the test suite, like `famillai_test`.
- **Security checklist adjustments (`scope.md` §8):** drop "firewall: only 80/443 open" and "Cloudflare SSL Full (strict)"; they
  do not apply to a tunnel. Keep HSTS, CSP, cookie and CSRF rules. Real IP is already handled via `Cf-Connecting-Ip`.
- **Email:** Resend, verify `kmk-entretien.ca`; SPF/DKIM/DMARC records in Cloudflare as DNS only. Verified on a sending subdomain (suggest `mail.kmk-entretien.ca`) so the
  root domain is untouched; the sender is then `no-reply@mail.kmk-entretien.ca`. The root domain has no MX/SPF/DMARC records today (checked).
- **Repo layout:** `backend/`, `frontend/`, `deploy/` as in `scope.md`. The existing `docker-compose.yml`, `caddy/`, and `site/` move
  into `deploy/`; the placeholder in `site/` is replaced by the frontend build.
- **Open items from `scope.md` §14:** "is it proxied?" is answered (yes, always). Still open: who the super admin is, sender
  address, welcome page copy in EN / FR-CA / PT-BR, scheduling the regulation and backup reviews.

## Risks added by the shared database
- Backups of Postgres are owned by the shared setup. They must cover `kmk` before any customer data is stored (already a parked
  risk in `scope.md` §12; it now depends on the shared setup, not on kmk).
- A shared server outage or upgrade affects both apps. Accepted.
- Any local process can reach loopback ports. Accepted, same as famillai; the API still authenticates every request.

## Phases
As in `scope.md` §11. Each phase is brainstormed/planned separately when it starts. Next step: a plan for phase 1 (Foundation:
git init, move placeholder into `deploy/`, `kmk-api` with a health check, Alembic against database `kmk`, React shell served by Caddy).

## Left to the builder
- Library versions, project tooling (uv or pip, npm), folder layout inside `backend/` and `frontend/`.
- Exact CSP, rate-limit numbers, cookie names, and the Alembic baseline.
- Confirming port 8001 is free and that `pg-backup.sh` covers the `kmk` database.
