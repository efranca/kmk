# Auto-deploy

Polls GitHub; when `origin/main` has a new commit, deploys it. Tests are optional (`RUN_TESTS=1`), off by default.
No inbound ports, no GitHub secrets, no runner: the box only makes outbound `git fetch` calls.

```
systemd timer (every minute) -> auto-deploy.sh <repo>
  1. git fetch; exit if origin/main == last deployed (or == last rejected) commit
  2. flock: only one run at a time
  3. the deploy worktree (infrastructure/deployments/worktree, never edited; deploy/.env and backend/.env symlinked in)
     moves to the new commit; your dev checkout can be on any branch, with any local changes
  4. [RUN_TESTS=1] pytest on kmk_test (dev checkout's venv, worktree's code), npm ci + vitest
       any failure: remember the SHA as rejected, notify, stop (live site unchanged)
  5. in the worktree: npm run build (frontend/dist); cd deploy && docker compose up -d --build
       (the one-shot migrate service runs first); restart caddy if the Caddyfile changed
  6. smoke check: http://127.0.0.1:8081/ and /api/health (Host app.kmk-entretien.ca) both answer 200 (up to 60 s)
       ok: record SHA as deployed, notify
```

The first run after install records the current `origin/main` as already deployed and does nothing; it deploys only commits that arrive later.

## Files

| | |
|---|---|
| `auto-deploy.sh [repo-dir]` | the whole process (default: the repo it lives in) |
| `logs/` | `checks/` (daily one-liners) and `deploys/` (full log per deploy); git-ignored, last 7 days kept |
| `systemd/kmk-deploy.service` | one-shot unit that runs the script (assumes the repo is at `~/projects/kmk`) |
| `systemd/kmk-deploy.timer` | fires it every minute |

## Install (not done yet)

```
mkdir -p ~/.config/systemd/user
cp ~/projects/kmk/infrastructure/deployments/systemd/kmk-deploy.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kmk-deploy.timer
```

User lingering must be on (`loginctl show-user $USER | grep Linger=yes`) so it runs while logged out.

## Requirements

Docker, Node (nvm) and SSH access to GitHub always. With `RUN_TESTS=1` also `backend/.venv` in the dev checkout (see CLAUDE.md) and the `kmk_test` database.

## Optional settings

`~/.config/kmk-deploy.env` (read by the service):

```
NOTIFY_URL=https://ntfy.sh/<topic>   # POSTed on every rejection and deploy
RUN_TESTS=1                          # gate deploys on pytest + vitest
```

## Trigger a deploy manually

```
cd ~/projects/kmk/infrastructure/deployments
./auto-deploy.sh                    # deploy origin/main if it is new (else logs "no change")
./auto-deploy.sh --force            # redeploy origin/main even if it is already live or was rejected
./auto-deploy.sh --branch my-branch # deploy origin/my-branch (push it first)
```

Output goes to `logs/deploys/` and one line to `logs/checks/`. `--branch`: the timer keeps following main and would put it
back within a minute, so `systemctl --user stop kmk-deploy.timer` first and start it again afterwards.

## Operating it

```
systemctl --user list-timers kmk-deploy.timer        # next run
systemctl --user start kmk-deploy.service            # run now
tail -f ~/projects/kmk/infrastructure/deployments/logs/checks/$(date +%F).log
```

State is in `~/.local/state/kmk-deploy/`: `deployed` (last live SHA), `failed` (last rejected SHA).

- **Pause:** `systemctl --user stop kmk-deploy.timer`. Do this before changing compose hardening (capabilities, limits): CLAUDE.md asks for one service at a time with health checks, which an automatic full rebuild does not give.
- **Roll back:** `git revert` on main and push.
- **Rejected commit (RUN_TESTS=1):** push a new commit; to force a retest delete `failed`.
- **"can't move the deploy worktree":** delete it (`git worktree remove --force infrastructure/deployments/worktree`); the next run recreates it.
- **Migration or `docker compose` failure:** the commit is marked rejected, but `frontend/dist` in the worktree already holds the new build while the old API still runs. Fix forward with a new commit, or `--force` after fixing.
- **Tests and dev share `kmk_test`:** don't run pytest by hand while a deploy is testing.
- **A new API setting** must be in `api.environment` of `deploy/docker-compose.yml` (CLAUDE.md), and `deploy/.env` in the dev checkout must have its value.
