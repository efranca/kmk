# kmk Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Under Construction" placeholder at `https://app.kmk-entretien.ca` with the real foundation: a git repo, a FastAPI service with a health check on the shared Postgres (database `kmk`, Alembic baseline), and a React/Vite shell, all served by the existing Caddy.

**Architecture:** `deploy/` holds the compose project `kmk` (Caddy + `kmk-api`, both `network_mode: host`, loopback only). Caddy serves `frontend/dist` and proxies `/api/*` to FastAPI on `127.0.0.1:8001`. FastAPI talks to the shared Postgres container on `127.0.0.1:5432`. The existing famillai `cloudflared` tunnel keeps forwarding the hostname to `localhost:8081`.

**Tech Stack:** Python 3.13 (image `python:3.13-slim`), FastAPI, SQLAlchemy 2, psycopg 3, Alembic, pydantic-settings, pytest + httpx; React + Vite + TypeScript, react-i18next, Vitest + Testing Library; Caddy 2.10.2; Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-17-kmk-app-design.md` (product behavior: `scope.md`, section 11 phase 1)

## Global Constraints

- Hostname `app.kmk-entretien.ca`; Caddy `127.0.0.1:8081` (exists); API `127.0.0.1:8001`; nothing bound to `0.0.0.0`.
- Compose project name `kmk`; containers `kmk-caddy` (image `caddy:2.10.2`) and `kmk-api`; `restart: unless-stopped`; `network_mode: host`; named volume `kmk_caddy_data` is kept.
- `kmk-api` runs as a non-root user. Secrets only in `deploy/.env` (git-ignored); `deploy/.env.example` is committed.
- Database: `/home/evandro/projects/shared/scripts/pg-new-db.sh kmk` and `... kmk_test` (role = database name). The API connects with `postgresql+psycopg://kmk:<pw>@127.0.0.1:5432/kmk`. The separate INSERT-only `kmk_app` role is phase 2, not now.
- Do not modify or restart famillai containers/files, or the shared Postgres setup (other than creating the two new roles/databases with the script).
- Repo layout: `backend/`, `frontend/`, `deploy/`; `scope.md` and `docs/` stay at the root.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Look and feel follows the public site (`/home/evandro/projects/kmk-public/src/css/critical.css`, read-only source): palette tokens `--pine #007A78`, `--pine-dk #006260`, `--deep #16242C`, `--teal #10938E`, `--spark #00E5D9`, `--mist #CCE4E4`, `--paper #F4FAFA`, `--ink #1C2D37`, `--slate #49575F`, radii/shadows as there; Montserrat headings and Inter body, self-hosted through `@fontsource` packages (no Google Fonts); logo copied from `kmk-public/public/assets/` (`logo-horizontal.png`, `favicon.svg`). Never edit `kmk-public`.
- UI default language is `fr-CA`; locales `fr-CA`, `en`, `pt-BR`.
- Security headers stay as in the current Caddyfile; the CSP is tightened for a script-bearing SPA (Task 4), never `unsafe-inline`/`unsafe-eval` for scripts.
- Interruption: the live site is briefly down while compose moves to `deploy/` (Task 1) and again when Caddy is reconfigured (Task 4). Acceptable.

## Review Focus

- Database down or wrong password: `GET /api/health` returns `503` with a generic body; no DSN, password, or exception text (Task 2 test).
- FastAPI docs (`/api/docs`, `/api/openapi.json`, `/api/redoc`) are not served publicly (Task 2 test).
- Unknown `/api/*` path returns a JSON 404 from the API, never the SPA `index.html` (Task 4 check).
- A browser deep link (`/anything`) serves the SPA, but a missing `/assets/x.js` returns 404, not HTML (Task 4 check).
- `kmk-api` is reachable only on loopback and runs as non-root; Postgres password never appears in logs or the image (Task 2/4 checks).

---

### Task 1: Git repo and `deploy/` layout

**Files:**
- Create: `.gitignore`, `deploy/.env.example`
- Move: `docker-compose.yml`, `caddy/`, `site/` → `deploy/docker-compose.yml`, `deploy/caddy/`, `deploy/site/`

**Interfaces:**
- Produces: git repo on branch `main`; compose project `kmk` runnable with `docker compose -f deploy/docker-compose.yml up -d` (or from `deploy/`); same service `caddy`, mounts `./caddy/Caddyfile` and `./site` (relative to `deploy/`).

- [ ] **Step 1: Baseline check (passes now)**

Run: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/`
Expected: `200`

- [ ] **Step 2: `git init -b main`; write `.gitignore`**

Ignore: `.env`, `node_modules/`, `dist/`, `__pycache__/`, `.venv/`, `.pytest_cache/`, `.superpowers/`, `*.pyc`.

- [ ] **Step 3: Move the files with `git mv`/`mv`; create `deploy/.env.example`**

`deploy/.env.example` documents `DATABASE_URL=postgresql+psycopg://kmk:change-me@127.0.0.1:5432/kmk`, `API_HOST=127.0.0.1`, `API_PORT=8001`, `COOKIE_SECURE=true`, and a commented `# RESEND_API_KEY=` (phase 3). No real secrets.

- [ ] **Step 4: Recreate the stack from the new location**

Run: `docker compose -f /home/evandro/projects/kmk/docker-compose.yml down` (old location, before the move completes, or `docker rm -f kmk-caddy`), then `cd deploy && docker compose up -d`.
Expected: `kmk-caddy` running; volume `kmk_caddy_data` still exists (`docker volume ls`).

- [ ] **Step 5: Verify**

Run the Step 1 curl, then `curl -s https://app.kmk-entretien.ca | grep -c 'Under Construction'`
Expected: `200`; `2`.

- [ ] **Step 6: Commit** the repo (`scope.md`, `docs/`, `deploy/`, `.gitignore`) with message `chore: initial repo, move placeholder into deploy/`.

---

### Task 2: Backend API, database, Alembic baseline

**Files:**
- Create: `backend/pyproject.toml`, `backend/Dockerfile`, `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/0001_baseline.py`
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/main.py`
- Test: `backend/tests/test_health.py`, `backend/tests/conftest.py`
- Modify: `deploy/docker-compose.yml` (add service `api`), `deploy/.env` (real values, untracked)

**Interfaces:**
- Consumes: `deploy/.env.example` variable names from Task 1.
- Produces:
  - `app.config.Settings` (pydantic-settings): `database_url: str`, `api_host: str = "127.0.0.1"`, `api_port: int = 8001`; `get_settings() -> Settings` (cached).
  - `app.db.make_engine(url: str) -> sqlalchemy.Engine`.
  - `app.main.create_app(database_url: str | None = None) -> FastAPI` (defaults to settings); `docs_url=None, redoc_url=None, openapi_url=None`; router prefix `/api`.
  - `GET /api/health` → `200 {"status": "ok"}` when `SELECT 1` succeeds; `503 {"status": "error"}` otherwise (log the exception server-side, never in the body).
  - Databases `kmk`, `kmk_test`; Alembic revision `0001` (baseline, creates nothing) applied on `kmk`.
  - Image/service `kmk-api` listening `127.0.0.1:8001`.

- [ ] **Step 1: Create the databases (outside the repo)**

Run `/home/evandro/projects/shared/scripts/pg-new-db.sh kmk` and `... kmk_test`. Put the printed (host) URLs into `deploy/.env` (`DATABASE_URL`) and `backend/.env` (`DATABASE_URL`, `TEST_DATABASE_URL`). Do not echo passwords into the ledger or commits.
Expected: "Created role + database" twice.

- [ ] **Step 2: Write `backend/tests/test_health.py` (tests first)**

`conftest.py` reads `TEST_DATABASE_URL` from `backend/.env` or the environment. Tests:
- `test_health_ok`: `create_app(TEST_DATABASE_URL)` → `GET /api/health` is `200`, JSON `{"status": "ok"}`.
- `test_health_db_down`: `create_app("postgresql+psycopg://kmk:wrongpass@127.0.0.1:1/kmk")` → `503`, JSON exactly `{"status": "error"}`, and the response text contains none of `wrongpass`, `psycopg`, `127.0.0.1`, `Traceback`.
- `test_docs_not_exposed`: `GET /api/docs`, `/api/redoc`, `/api/openapi.json`, `/docs`, `/openapi.json` are all `404`.

- [ ] **Step 3: Run to watch it fail**

Run (after `python3 -m venv backend/.venv && backend/.venv/bin/pip install -e 'backend[dev]'` with the deps listed in Tech Stack in `pyproject.toml`): `cd backend && .venv/bin/pytest -v`
Expected: FAIL (`app.main` missing). If psycopg wheels are unavailable for the host Python 3.14, rule it in the ledger and run pytest in a `python:3.13-slim` container instead.

- [ ] **Step 4: Implement `config.py`, `db.py`, `main.py`** to the Interfaces above. The health query runs `SELECT 1` with a short connect timeout (`connect_args={"connect_timeout": 3}`); catch `Exception`, `logging.exception`, return the 503 body.

- [ ] **Step 5: Run to watch it pass**

Run: `cd backend && .venv/bin/pytest -v`
Expected: 3 passed.

- [ ] **Step 6: Alembic baseline**

`alembic.ini`/`env.py` take the URL from `Settings.database_url` (never hard-coded); `0001_baseline.py` has empty `upgrade`/`downgrade`.
Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic current`
Expected: `0001 (head)`.

- [ ] **Step 7: `backend/Dockerfile` and compose service**

`python:3.13-slim`, installs the package, creates and switches to a non-root user, `CMD` runs `alembic upgrade head` then `uvicorn app.main:app --host $API_HOST --port $API_PORT` (an exec-form shell wrapper is fine). Compose service `api` in `deploy/docker-compose.yml`: `build: ../backend`, `pull_policy: build`, `container_name: kmk-api`, `restart: unless-stopped`, `network_mode: host`, `env_file: .env`. Caddy `depends_on: [api]`.

- [ ] **Step 8: Build, start, verify**

```bash
cd deploy && docker compose up -d --build api
curl -s -w '\n%{http_code}\n' http://127.0.0.1:8001/api/health      # {"status":"ok"} 200
docker exec kmk-api id -u                                            # not 0
ss -ltn | grep 8001                                                  # only 127.0.0.1:8001
docker logs kmk-api 2>&1 | grep -c "$(grep -oP '(?<=kmk:)[^@]+' .env | head -1)"   # 0 (password not logged)
```

- [ ] **Step 9: Commit** `feat(api): FastAPI health check, Alembic baseline, kmk-api container`.

---

### Task 3: Frontend shell (React, Vite, i18n)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/i18n.ts`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces:
  - `i18n.ts` exports the initialized i18next instance `i18n` (default and fallback language `fr-CA`; resources for `fr-CA`, `en`, `pt-BR`; no browser auto-detection yet).
  - Locale keys (same in all three files): `title`, `apiOk`, `apiDown`. Values: `title` = "En construction" / "Under Construction" / "Em construção".
  - `<App />` renders `<h1>{t('title')}</h1>` and a status line that `fetch('/api/health')`s on mount and shows `t('apiOk')` when `response.ok`, otherwise `t('apiDown')`; sets `document.title` to `t('title')`.
  - `npm run build` outputs `frontend/dist/` (hashed assets under `/assets/`).

- [ ] **Step 1: Write `App.test.tsx` (tests first)** with Vitest + Testing Library, mocking `fetch`:
- `renders the French title by default`: heading text `En construction`.
- `renders English after i18n.changeLanguage('en')`: heading `Under Construction`; same for `pt-BR` → `Em construção`.
- `shows apiOk when /api/health is ok` (mock `{ok: true}`) and `shows apiDown when fetch rejects`.
- `all locale files define the same keys`.

- [ ] **Step 2: Run to watch it fail**

Run: `cd frontend && npm install && npx vitest run`
Expected: FAIL (components missing).

- [ ] **Step 3: Implement** the files above (TypeScript, strict). No external requests: fonts via `@fontsource/montserrat` and `@fontsource/inter` (latin weights 400/600/700 only), logo and favicon copied into `frontend/public/`. Plain CSS in `src/index.css` using the public-site tokens above (light: `--paper` background, `--ink` text, `--pine` accents; dark mode via `prefers-color-scheme` on `--deep` with `--spark` accent), the logo above the heading, centered card, readable at phone width.

- [ ] **Step 4: Run to watch it pass, then build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests pass; `frontend/dist/index.html` and `frontend/dist/assets/*.js|css` exist.

- [ ] **Step 5: Commit** `feat(frontend): React + Vite shell with react-i18next`.

---

### Task 4: Wire Caddy to API and frontend; go live

**Files:**
- Modify: `deploy/caddy/Caddyfile`, `deploy/docker-compose.yml`
- Delete: `deploy/site/`

**Interfaces:**
- Consumes: `frontend/dist/` (Task 3), `127.0.0.1:8001` `/api/health` (Task 2), compose service `api` (Task 2).
- Produces: public `https://app.kmk-entretien.ca/` (SPA) and `/api/*` (API).

- [ ] **Step 1: Checks first (fail now)**

Run: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/api/health`
Expected: not `200` JSON (currently a 404/empty page from the static server).

- [ ] **Step 2: Update the Caddyfile** (keep the global block and headers; same site address and `bind 127.0.0.1`):
- Order inside the site: `handle /api/* { reverse_proxy 127.0.0.1:8001 }`, then `handle /assets/* { root * /srv/site; file_server }`, then `handle { root * /srv/site; try_files {path} /index.html; file_server }`.
- CSP becomes `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
- Validate with `caddy validate` as before.

- [ ] **Step 3: Update compose:** Caddy mount `../frontend/dist:/srv/site:ro` replaces `./site:/srv/site:ro`; remove `deploy/site/` (`git rm -r`).

- [ ] **Step 4: Apply and verify**

```bash
cd deploy && docker compose up -d
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081
curl -s -H "$H" $B/api/health                                   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H "$H" $B/api/nope      # 404 application/json
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H "$H" $B/some/deep/link  # 200 text/html (SPA)
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" $B/assets/missing.js              # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" $B/api/docs                       # 404
curl -sI -H "$H" $B/ | grep -iE '^(server|x-content-type-options|content-security-policy)'   # no Server; nosniff; new CSP
ss -ltn | grep -E ':(8081|8001)\b'                               # only 127.0.0.1
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'   # all still running
/home/evandro/projects/shared/scripts/pg-backup.sh kmk            # a dump for kmk is written
curl -s https://app.kmk-entretien.ca/api/health                  # {"status":"ok"} through Cloudflare
```

- [ ] **Step 5: Browser check** (user or Chrome tool): open `https://app.kmk-entretien.ca`; the heading reads "En construction" with the API status line shown, no CSP errors in the console, readable at phone width and in dark mode.

- [ ] **Step 6: Commit** `feat(deploy): serve frontend and proxy /api through Caddy`.
