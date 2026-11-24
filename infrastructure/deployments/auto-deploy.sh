#!/usr/bin/env bash
# Auto-deploy: if origin/main has a new commit, update the deploy worktree (infrastructure/deployments/worktree,
# always a copy of main, so whatever branch is checked out in the dev checkout never matters), optionally run the
# tests there (RUN_TESTS=1), build the frontend and restart the Docker stack (deploy/docker-compose.yml) from it.
# Usage: auto-deploy.sh [--force] [--branch NAME] [repo-dir]   (default: the repo this script lives in). Run by kmk-deploy.timer; safe to run by hand.
#
#   --force        deploy even if the commit is already live or was rejected earlier (tests still run if RUN_TESTS=1)
#   --branch NAME  deploy origin/NAME instead of origin/main (the deploy worktree is moved to it). The timer still
#                  follows main, so stop it first or it puts main back within a minute:
#                  systemctl --user stop kmk-deploy.timer
# Optional env (put in ~/.config/kmk-deploy.env):
#   NOTIFY_URL   ntfy.sh-style topic URL; gets a POST on every failure and every successful deploy
#   RUN_TESTS=1  test the commit first (backend pytest on kmk_test + vitest); a failing commit is rejected, not deployed
set -euo pipefail

FORCE=0; BRANCH=main; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --branch) BRANCH="${2:?--branch needs a name}"; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${1:-$HERE/../..}" && pwd)"          # the dev checkout: only used for its .git, its .env files and its Python venv
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/$(basename "$REPO")-deploy"
WORK="$HERE/worktree"                              # git-ignored; detached at the deployed commit
KEEP_DAYS=7
# nvm's node (a systemd timer doesn't load your shell profile)
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"

mkdir -p "$STATE"
BASE="$HERE/logs"   # git-ignored, the only place logs go
CHECKS="$BASE/checks"; DEPLOYS="$BASE/deploys"; mkdir -p "$CHECKS" "$DEPLOYS"
CHECKFILE="$CHECKS/$(date +%F).log"
# One line per run in the daily check file; runs that deploy point to their own full log.
check() { echo "$(date +%T) $*" >>"$CHECKFILE"; }
log() { echo "$(date '+%F %T') $*"; }
notify() { [ -n "${NOTIFY_URL:-}" ] && curl -fsS -d "$1" "$NOTIFY_URL" >/dev/null || true; }
# keep the last $KEEP_DAYS days of logs, nothing older
find "$CHECKS" "$DEPLOYS" -type f -name '*.log' -mtime "+$((KEEP_DAYS - 1))" -delete 2>/dev/null || true

# Whatever happens, leave a line behind (a script error must never be silent).
SHORT="-"; SUBJECT=""; REF=""; DONE=0
trap '[ "$DONE" = 1 ] || check "ABORTED $SHORT (script error at line $LINENO, see ${REF:-the systemd journal})"' EXIT

exec 9>"$STATE/lock"
flock -n 9 || { DONE=1; check "skipped: previous run still in progress"; exit 0; }

cd "$REPO"
ERR="$(git fetch -q origin "$BRANCH" 2>&1)" || { DONE=1; check "ERROR git fetch failed: ${ERR//$'\n'/ }"; exit 1; }
NEW="$(git rev-parse "origin/$BRANCH")"
SHORT="${NEW:0:7}"

# --- the deploy worktree: a copy of main that nobody edits ---
git worktree prune
if [ ! -e "$WORK/.git" ]; then
  rm -rf "$WORK"
  git worktree add -q --detach "$WORK" "$NEW" || { DONE=1; check "ERROR can't create the deploy worktree $WORK"; exit 1; }
fi
# Secrets live in the dev checkout's git-ignored .env files; the worktree only links to them.
[ -e "$WORK/deploy/.env" ] || ln -s "$REPO/deploy/.env" "$WORK/deploy/.env"
{ [ ! -e "$REPO/backend/.env" ] || [ -e "$WORK/backend/.env" ]; } || ln -s "$REPO/backend/.env" "$WORK/backend/.env"

DEPLOYED="$(cat "$STATE/deployed" 2>/dev/null || git -C "$WORK" rev-parse HEAD)"
FAILED="$(cat "$STATE/failed" 2>/dev/null || true)"
[ "$FORCE" = 0 ] && [ "$NEW" = "$DEPLOYED" ] && { DONE=1; check "no change ($SHORT)"; exit 0; }
[ "$FORCE" = 0 ] && [ "$NEW" = "$FAILED" ] && { DONE=1; check "no change ($SHORT rejected earlier, waiting for a new commit)"; exit 0; }

# --- from here on this run has its own full log ---
SUBJECT="$(git log -1 --format=%s "$NEW")"
DLOG="$DEPLOYS/$(date +%F_%H%M%S)_$SHORT.log"
REF="deploys/$(basename "$DLOG")"
exec >>"$DLOG" 2>&1
log "new commit $SHORT on $BRANCH: $SUBJECT (force=$FORCE)"
finish() { DONE=1; check "$1 $SHORT \"$SUBJECT\" (${SECONDS}s) -> $REF"; log "$1 (${SECONDS}s)"; }
fail() {
  echo "$NEW" >"$STATE/failed"; log "FAILED at: $1"; finish "FAILED($1)"; notify "kmk $SHORT rejected: $1 (see $DLOG)"
  git -C "$WORK" checkout -q --detach "$DEPLOYED" 2>/dev/null || true   # the worktree goes back to what is live
  exit 1
}

# --- move the deploy worktree to the new commit (it is never edited, so this can't conflict) ---
git -C "$WORK" reset -q --hard
OLD_CADDYFILE="$(sha256sum "$WORK/deploy/caddy/Caddyfile" | cut -d' ' -f1)"
git -C "$WORK" checkout -q --detach "$NEW" || fail "can't move the deploy worktree to $SHORT"

# --- optional gate: test the new commit before it goes live ---
if [ "${RUN_TESTS:-0}" = 1 ]; then
  # The venv lives in the dev checkout; PYTHONPATH makes it import the worktree's code, and we check that it does.
  PY="$REPO/backend/.venv/bin/python"
  (cd "$WORK/backend" && PYTHONPATH="$WORK/backend" "$PY" -c "import app,sys; sys.exit(0 if app.__file__.startswith('$WORK/') else 1)") \
    || fail "backend tests (venv does not import the worktree's code)"
  (cd "$WORK/backend" && PYTHONPATH="$WORK/backend" "$PY" -m pytest -q) || fail "backend tests"
  (cd "$WORK/frontend" && npm ci --silent && npx vitest run) || fail "frontend tests"
fi

# --- deploy, from the worktree (compose's project name is pinned to "kmk", so it is the same stack) ---
log "deploying $SHORT from $WORK"
(cd "$WORK/frontend" && npm ci --silent && npm run build --silent) || fail "frontend build"
cd "$WORK/deploy"
docker compose up -d --build || fail "docker compose"   # builds, runs the migrate one-shot first, then recreates what changed
# Caddy's admin API is off, so it never reloads by itself: restart it when the Caddyfile changed.
[ "$OLD_CADDYFILE" = "$(sha256sum caddy/Caddyfile | cut -d' ' -f1)" ] || { log "Caddyfile changed: restarting caddy"; docker compose restart caddy || fail "caddy restart"; }

# --- smoke check: Caddy serves the page and the API answers through it ---
HOST="app.kmk-entretien.ca"; BASEURL="http://127.0.0.1:8081"
for _ in $(seq 1 30); do
  page="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$BASEURL/" || true)"
  api="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$BASEURL/api/health" || true)"
  [ "$page" = 200 ] && [ "$api" = 200 ] && { echo "$NEW" >"$STATE/deployed"; rm -f "$STATE/failed"; finish DEPLOYED; notify "kmk $SHORT deployed"; exit 0; }
  sleep 2
done
log "deployed $SHORT but the site isn't answering (page $page, api $api)"
echo "$NEW" >"$STATE/deployed"   # code is live; don't redeploy the same commit in a loop
finish "DEPLOYED-UNHEALTHY(page $page, api $api)"
notify "kmk $SHORT deployed but site check failed (page $page, api $api)"
exit 1
