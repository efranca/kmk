#!/usr/bin/env bash
# Shared helpers for the kmk backup scripts. Source this file; do not run it.
#
# Every setting can be overridden with an environment variable (the tests rely on that).

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$LIB_DIR/../.." && pwd)"

# Backups live inside the project folder (git-ignored). Plain tar files, NOT encrypted: they hold password hashes and the
# encrypted TOTP secrets, so the folder must stay private (the script creates it mode 700). deploy/.env is never copied.
: "${KMK_BACKUP_DEST:=$REPO_DIR/infrastructure/backups}"
# Optional: a directory that must be a real mount for the destination to be trusted (empty = no check).
: "${KMK_BACKUP_REQUIRE_MOUNT=}"
: "${KMK_BACKUP_DB:=kmk}"
: "${KMK_BACKUP_SCRATCH_DB:=kmk_backup_verify}"
: "${KMK_BACKUP_STATE_DIR:=$HOME/.local/state/kmk-backup}"
: "${KMK_BACKUP_PG_CONTAINER:=postgres}"
: "${KMK_BACKUP_PG_USER:=postgres}"
: "${KMK_BACKUP_KEEP_DAILY:=14}"  # two weeks
# Visit photos (a folder of files): snapshotted next to the database archives. Empty or missing = skipped, not a failure.
: "${KMK_BACKUP_PHOTOS_SRC=$REPO_DIR/deploy/data/visit-photos}"
: "${KMK_BACKUP_TMP:=${XDG_RUNTIME_DIR:-/dev/shm}}"  # working files go to tmpfs and are removed at the end

log() { printf '%s\n' "$*" >&2; }

now_epoch() { if [[ -n "${KMK_BACKUP_NOW:-}" ]]; then date -d "$KMK_BACKUP_NOW" +%s; else date +%s; fi; }
now_iso() { if [[ -n "${KMK_BACKUP_NOW:-}" ]]; then date -d "$KMK_BACKUP_NOW" --iso-8601=seconds; else date --iso-8601=seconds; fi; }

# True when it is safe to write into the destination: the folder exists and, if a mount is required, it is mounted.
dest_reachable() {
  [[ -d "$KMK_BACKUP_DEST" ]] || return 1
  [[ -z "$KMK_BACKUP_REQUIRE_MOUNT" ]] || mountpoint -q "$KMK_BACKUP_REQUIRE_MOUNT"
}

# write_status RESULT MESSAGE [FILE BYTES]
write_status() {
  mkdir -p "$KMK_BACKUP_STATE_DIR" || return 0
  local tmp="$KMK_BACKUP_STATE_DIR/status.tmp"
  {
    echo "result=$1"
    echo "time=$(now_iso)"
    echo "epoch=$(now_epoch)"
    echo "file=${3:-}"
    echo "bytes=${4:-}"
    echo "message=$2"
  } >"$tmp" && mv -f "$tmp" "$KMK_BACKUP_STATE_DIR/status"
  if dest_reachable; then cp -f "$KMK_BACKUP_STATE_DIR/status" "$KMK_BACKUP_DEST/STATUS" 2>/dev/null || true; fi
}

# fail MESSAGE: report, record a failed backup status (unless KMK_LIB_RECORD_STATUS=0, as the restore script sets), stop.
fail() {
  log "ERROR: $*"
  KMK_FAIL_RECORDED=1
  if [[ "${KMK_LIB_RECORD_STATUS:-1}" == 1 ]]; then write_status failed "$*" || true; fi
  exit 1
}

# pg_exec DB SQL: run one SQL statement in the shared postgres container as the superuser, unaligned and tuples only.
pg_exec() {
  docker exec -i "$KMK_BACKUP_PG_CONTAINER" psql -U "$KMK_BACKUP_PG_USER" -d "$1" -v ON_ERROR_STOP=1 -Atqc "$2" </dev/null
}

# Database names end up inside SQL: accept only plain identifiers.
check_db_name() {
  [[ "$1" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "invalid database name: $1"
}

# table_counts DB: `table=count` for every base table in schema public, sorted.
table_counts() {
  local q
  q=$(pg_exec "$1" "select coalesce(string_agg(format('select %L || ''='' || count(*) from public.%I', table_name, table_name), ' union all ' order by table_name), '') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'") || return 1
  [[ -n "$q" ]] || return 0
  pg_exec "$1" "select * from ($q) x(l) order by l"
}

# compare_counts DB_A DB_B: 0 when the row counts of every table are identical, else print the differences and return 1.
compare_counts() {
  local a b diff_out
  a=$(table_counts "$1") || return 1
  b=$(table_counts "$2") || return 1
  if [[ "$a" == "$b" ]]; then return 0; fi
  diff_out=$(diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") || true)
  printf '%s\n' "$diff_out"
  return 1
}
