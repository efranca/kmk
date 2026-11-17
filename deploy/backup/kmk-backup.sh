#!/usr/bin/env bash
# Encrypted, verified backup of the kmk database and deploy/.env.
# See docs/operations.md. Exit code 0 on success, 1 on any failure (message on stderr, failure recorded in the status file).
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

DB="$KMK_BACKUP_DB"
SCRATCH="$KMK_BACKUP_SCRATCH_DB"
WORK=""
KEYRING=""
SCRATCH_CREATED=0

cleanup() {
  local rc=$?
  if [[ "$SCRATCH_CREATED" == 1 ]]; then
    pg_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  if [[ -n "$KEYRING" ]]; then
    GNUPGHOME="$KEYRING" gpgconf --kill all >/dev/null 2>&1 || true
    rm -rf "$KEYRING"
  fi
  [[ -n "$WORK" ]] && rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

# ---- preflight: every check fails loudly and writes nothing to the destination ----
check_db_name "$DB"
check_db_name "$SCRATCH"

if [[ -n "$KMK_BACKUP_REQUIRE_MOUNT" ]] && ! mountpoint -q "$KMK_BACKUP_REQUIRE_MOUNT"; then
  fail "$KMK_BACKUP_REQUIRE_MOUNT is not a mounted filesystem: refusing to write the backup (it would land on the system disk)"
fi
[[ "$(docker inspect -f '{{.State.Running}}' "$KMK_BACKUP_PG_CONTAINER" 2>/dev/null || true)" == "true" ]] \
  || fail "the database container '$KMK_BACKUP_PG_CONTAINER' is not running"
[[ "$(pg_exec postgres "select count(*) from pg_database where datname = '$DB'" 2>/dev/null || true)" == "1" ]] \
  || fail "database '$DB' not found"
[[ -r "$KMK_BACKUP_ENV_FILE" ]] || fail "cannot read the env file $KMK_BACKUP_ENV_FILE"
[[ -r "$KMK_BACKUP_RECIPIENT_FILE" ]] || fail "recipient public key not found: $KMK_BACKUP_RECIPIENT_FILE (run make-backup-key.sh first)"

mkdir -p "$KMK_BACKUP_TMP" || fail "cannot use the temporary directory $KMK_BACKUP_TMP"
KEYRING="$(mktemp -d -p "$KMK_BACKUP_TMP" kmk-keyring.XXXXXX)"
chmod 700 "$KEYRING"
export GNUPGHOME="$KEYRING"
gpg --batch --quiet --import "$KMK_BACKUP_RECIPIENT_FILE" >/dev/null 2>&1 || fail "the recipient file contains no usable public key"
[[ "$(gpg --batch --with-colons --list-keys | grep -c '^pub:')" == "1" ]] || fail "the recipient file must contain exactly one public key"
FPR="$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ {print $10; exit}')"
[[ -n "$FPR" ]] || fail "cannot read the recipient key fingerprint"

# Free space at the destination (its parent if it does not exist yet).
space_dir="$KMK_BACKUP_DEST"
while [[ ! -d "$space_dir" && "$space_dir" != "/" ]]; do space_dir="$(dirname "$space_dir")"; done
avail_kb="$(df -Pk "$space_dir" | awk 'NR==2 {print $4}')"
(( avail_kb >= 512000 )) || fail "less than 500 MB free at $space_dir"

mkdir -p "$KMK_BACKUP_DEST/daily" || fail "cannot create $KMK_BACKUP_DEST/daily"

# ---- dump (into tmpfs) ----
WORK="$(mktemp -d -p "$KMK_BACKUP_TMP" kmk-backup.XXXXXX)"
chmod 700 "$WORK"
log "dumping $DB ..."
docker exec "$KMK_BACKUP_PG_CONTAINER" pg_dump -U "$KMK_BACKUP_PG_USER" -d "$DB" -Fc >"$WORK/kmk.dump" 2>"$WORK/dump.err" \
  || fail "pg_dump failed: $(head -c 300 "$WORK/dump.err")"
[[ -s "$WORK/kmk.dump" ]] || fail "pg_dump produced an empty file"
if [[ -n "${KMK_BACKUP_TEST_TRUNCATE_DUMP:-}" ]]; then truncate -s 100 "$WORK/kmk.dump"; fi  # test hook only

# ---- verify: the dump must restore into a scratch database with identical row counts ----
log "verifying the dump ..."
docker exec -i "$KMK_BACKUP_PG_CONTAINER" pg_restore --list <"$WORK/kmk.dump" >/dev/null 2>"$WORK/list.err" \
  || fail "the dump is damaged (pg_restore --list failed)"
pg_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null || fail "cannot reset the scratch database"
pg_exec postgres "CREATE DATABASE \"$SCRATCH\" TEMPLATE template0" >/dev/null || fail "cannot create the scratch database"
SCRATCH_CREATED=1
docker exec -i "$KMK_BACKUP_PG_CONTAINER" pg_restore -U "$KMK_BACKUP_PG_USER" -d "$SCRATCH" --no-owner --no-privileges --exit-on-error \
  <"$WORK/kmk.dump" >/dev/null 2>"$WORK/restore.err" || fail "the verification restore failed: $(head -c 300 "$WORK/restore.err")"
mismatch="$(compare_counts "$DB" "$SCRATCH" || true)"
[[ -z "$mismatch" ]] || fail "row counts differ between the source and the verification restore: $mismatch"
pg_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null
SCRATCH_CREATED=0

# ---- manifest and archive ----
cp "$KMK_BACKUP_ENV_FILE" "$WORK/deploy.env"
chmod 600 "$WORK/deploy.env"
{
  echo "time: $(now_iso)"
  echo "git_commit: $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "alembic_revision: $(pg_exec "$DB" "select version_num from alembic_version" 2>/dev/null || echo none)"
  echo "db: $DB"
  echo "dump_sha256: $(sha256sum "$WORK/kmk.dump" | cut -d' ' -f1)"
  table_counts "$DB" | sed 's/^/rows./; s/=/: /'
} >"$WORK/MANIFEST.txt"
tar -C "$WORK" -cf "$WORK/archive.tar" kmk.dump deploy.env MANIFEST.txt

NAME="kmk-$(date -d "${KMK_BACKUP_NOW:-now}" +%Y-%m-%d_%H%M%S).tar.gpg"
FINAL="$KMK_BACKUP_DEST/daily/$NAME"
gpg --batch --yes --quiet --trust-model always --encrypt --recipient "$FPR" --output "$FINAL.partial" "$WORK/archive.tar" \
  || { rm -f "$FINAL.partial"; fail "encryption failed"; }
mv -f "$FINAL.partial" "$FINAL"

# Sunday: also keep a weekly copy.
if [[ "$(date -d "${KMK_BACKUP_NOW:-now}" +%u)" == "7" ]]; then
  mkdir -p "$KMK_BACKUP_DEST/weekly"
  cp "$FINAL" "$KMK_BACKUP_DEST/weekly/$NAME.partial" && mv -f "$KMK_BACKUP_DEST/weekly/$NAME.partial" "$KMK_BACKUP_DEST/weekly/$NAME"
fi

# ---- retention: only after a successful write ----
prune() {
  local dir=$1 keep=$2 f
  [[ -d "$dir" ]] || return 0
  # shellcheck disable=SC2012  # file names are ours and contain no newlines; sorted newest first by modification time
  ls -1t "$dir"/kmk-*.tar.gpg 2>/dev/null | tail -n +"$((keep + 1))" | while IFS= read -r f; do rm -f -- "$f"; done
}
prune "$KMK_BACKUP_DEST/daily" "$KMK_BACKUP_KEEP_DAILY"
prune "$KMK_BACKUP_DEST/weekly" "$KMK_BACKUP_KEEP_WEEKLY"

bytes="$(stat -c %s "$FINAL")"
write_status ok "backup written" "$FINAL" "$bytes"
log "ok: $FINAL ($bytes bytes)"
