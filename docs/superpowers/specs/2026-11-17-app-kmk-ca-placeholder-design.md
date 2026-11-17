# app.kmk-entretien.ca: placeholder site behind the existing Cloudflare Tunnel

## Intent
Serve `https://app.kmk-entretien.ca` from this machine, the same way famillai is served, as the first step toward a full
app (backend + frontend + database + logins). For now it is a single page titled "Under Construction".

## Goals
- `https://app.kmk-entretien.ca` shows an "Under Construction" page.
- The `kmk` project is independent of famillai: its own compose project, containers and port.
- The layout leaves room to add an API, a UI build and a database without restructuring.

## Non-goals (for now)
- Backend, database, logins, UI framework. Those come later, each through its own design.
- A second tunnel. The existing `cloudflared` is reused.

## Anti-goals
- Touching or restarting famillai's containers or config.
- Exposing anything beyond loopback on the host (only `cloudflared` may reach Caddy).

## Constraints
- ISP is behind CGNAT: no port forwarding. Access is only through the Cloudflare Tunnel.
- `kmk-entretien.ca` is in the same Cloudflare account as `evandrofranca.com`, so the existing tunnel can serve it.
- Port 8080 is taken by famillai's Caddy.

## Approaches considered
- A. Add `app.kmk-entretien.ca` to famillai's Caddy/compose: least work, but couples unrelated projects. Rejected.
- B. Separate `kmk` compose with its own Caddy, reusing the existing tunnel. **Chosen.**
- C. Separate compose plus its own `cloudflared`/tunnel: only needed if the domain were in another account. Not needed.

## Design
- `kmk/docker-compose.yml`: project `kmk`, one service `caddy` (`caddy:2.10.2`, same as famillai),
  container `kmk-caddy`, `network_mode: host`, `restart: unless-stopped`.
- `kmk/caddy/Caddyfile`: plain-HTTP site `http://app.kmk-entretien.ca:8081`, `bind 127.0.0.1`, serving `/srv/site`;
  the same hardening as famillai (security headers, `-Server`, gzip/zstd, JSON access log, trusted proxy
  127.0.0.1 with `Cf-Connecting-Ip`). Later `handle /api/*` reverse-proxies to the backend.
- `kmk/site/index.html`: the placeholder page, `<title>Under Construction</title>` and an `<h1>` with the same text.
  Self-contained (inline CSS, no external requests). Later replaced by a UI build output.
- Manual step for the user in Cloudflare Zero Trust: on the existing tunnel add public hostname
  `app.kmk-entretien.ca` → `http://localhost:8081` (this creates the DNS record).

## Verification
- `curl -H 'Host: app.kmk-entretien.ca' http://127.0.0.1:8081/` returns the page.
- After the Zero Trust step, `https://app.kmk-entretien.ca` shows it.
- `ss -ltn` shows 8081 bound to 127.0.0.1 only; famillai containers untouched.

## Calls I made (change any you disagree with)
- Port 8081; container/project name `kmk`; page folder `site/`.
- Same Caddy version and security-header set as famillai (minus the CSP's mic/API allowances).
- Later database: a `kmk` database on the shared Postgres (`:5432`), like famillai. Not created now.
- No git repo is created unless you ask.

## Left to the builder
- Exact visual styling of the placeholder (simple, centered, light/dark aware).
