# app.kmk-entretien.ca Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an "Under Construction" page at `https://app.kmk-entretien.ca` through the existing Cloudflare Tunnel.

**Architecture:** A standalone `kmk` compose project runs one Caddy container on host networking, listening on `127.0.0.1:8081` (plain HTTP) and serving a static folder. The existing famillai `cloudflared` forwards the public hostname to it.

**Tech Stack:** Docker Compose, Caddy 2.10.2 (same as famillai).

**Spec:** `docs/superpowers/specs/2026-11-17-app-kmk-ca-placeholder-design.md`

## Global Constraints

- Hostname: `app.kmk-entretien.ca`; port `8081`, bound to `127.0.0.1` only.
- Compose project `kmk`; container `kmk-caddy`; image `caddy:2.10.2`; `network_mode: host`; `restart: unless-stopped`.
- Page: `<title>Under Construction</title>` and an `<h1>` with the same text; self-contained (inline CSS, no external requests).
- Do not touch or restart famillai containers or files.
- No git repo is created (per spec).

## Review Focus

- Request with another Host header (e.g. `curl http://127.0.0.1:8081/` with Host `127.0.0.1`): must not serve the page as a wildcard leak; acceptable to return an empty 200/404, but must not error.
- Unknown path (`/nope`): returns the placeholder or a clean 404, never a Caddy error page with internals.
- Port reachable only on loopback: `ss -ltn` must not show 8081 on `0.0.0.0` or the LAN address.
- Response headers: `Server` header absent; `X-Content-Type-Options: nosniff` present.
- Dark-mode / phone viewport: page readable without horizontal scroll.

---

### Task 1: Placeholder site served by Caddy

**Files:**
- Create: `site/index.html`
- Create: `caddy/Caddyfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Produces: HTTP on `127.0.0.1:8081` answering Host `app.kmk-entretien.ca`; the Zero Trust route targets `http://localhost:8081`.

- [ ] **Step 1: Define the checks first (they fail now, nothing is running)**

Run each; all must fail or return nothing before the build:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/
```
Expected: `000` (connection refused).

- [ ] **Step 2: Create `site/index.html`**

Single file: `<meta charset>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>Under Construction</title>`, inline CSS using `prefers-color-scheme` for light/dark with an explicit body background, centered `<h1>Under Construction</h1>`. No external fonts, scripts or images.

- [ ] **Step 3: Create `caddy/Caddyfile`**

Mirror famillai's `caddy/Caddyfile` structure, with these values:
- Global block: `admin off`, `auto_https disable_redirects`, and `servers 127.0.0.1:8081` with `trusted_proxies static 127.0.0.1/32 ::1/128` and `client_ip_headers Cf-Connecting-Ip`.
- Site `http://app.kmk-entretien.ca:8081` with `bind 127.0.0.1`.
- Inside: `encode zstd gzip`, `log`, header block (`Strict-Transport-Security "max-age=31536000"`, `X-Content-Type-Options "nosniff"`, `X-Frame-Options "DENY"`, `Referrer-Policy "same-origin"`, `Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"`, `-Server`), then `root * /srv/site` and `file_server`.

- [ ] **Step 4: Create `docker-compose.yml`**

`name: kmk`; one service `caddy` with image `caddy:2.10.2`, `container_name: kmk-caddy`, `restart: unless-stopped`, `network_mode: host`, volumes `./caddy/Caddyfile:/etc/caddy/Caddyfile:ro` and `./site:/srv/site:ro`, and a named volume `kmk_caddy_data` mounted at `/data`.

- [ ] **Step 5: Validate and start**

Run: `docker run --rm -v "$PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile` then `docker compose up -d`
Expected: "Valid configuration"; container `kmk-caddy` running.

- [ ] **Step 6: Verify**

```bash
curl -s -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/ | grep -c 'Under Construction'   # expect 2 (title + h1)
curl -sI -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/ | grep -iE '^(server|x-content-type-options)'   # nosniff only, no Server
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/nope   # expect 200 or 404, no error body
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/   # wrong Host: must not be a 5xx
ss -ltn | grep 8081   # expect only 127.0.0.1:8081
docker ps --format '{{.Names}}' | grep famillai   # famillai-api, -caddy, -cloudflared still running
```

### Task 2: Public route (manual, user)

- [ ] **Step 1:** In Cloudflare Zero Trust → Networking → Tunnels → the existing tunnel → Published application routes, add `app` / `kmk-entretien.ca` → `http://localhost:8081` (already done by the user per the conversation; confirm it saved).
- [ ] **Step 2:** Verify: `curl -s https://app.kmk-entretien.ca | grep 'Under Construction'` returns the page; open it in a browser and check title and phone-width layout.
