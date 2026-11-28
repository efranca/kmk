#!/usr/bin/env bash
# Verified backup of the kmk database (plain tar: dump + manifest; deploy/.env is deliberately NOT included).
# See docs/operations.md. Exit code 0 on success, 1 on any failure (message on stderr, failure recorded in the status file).
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

DB="$KMK_BACKUP_DB"
SCRATCH="$KMK_BACKUP_SCRATCH_DB"
WORK=""
SCRATCH_CREATED=0

cleanup() {
  local rc=$?
  # Any failure that was not one of our own explicit checks must still be recorded, or an old "ok" status would stand.
  if [[ $rc -ne 0 && "${KMK_FAIL_RECORDED:-0}" != 1 ]]; then
    write_status failed "unexpected error (exit code $rc); see: journalctl --user -u kmk-backup.service" || true
  fi
  if [[ "$SCRATCH_CREATED" == 1 ]]; then
    pg_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true
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

mkdir -p "$KMK_BACKUP_TMP" || fail "cannot use the temporary directory $KMK_BACKUP_TMP"
umask 077  # everything this script writes (the archive too) is private to the owner

# Free space at the destination (its parent if it does not exist yet).
space_dir="$KMK_BACKUP_DEST"
while [[ ! -d "$space_dir" && "$space_dir" != "/" ]]; do space_dir="$(dirname "$space_dir")"; done
avail_kb="$(df -Pk "$space_dir" | awk 'NR==2 {print $4}')"
(( avail_kb >= 512000 )) || fail "less than 500 MB free at $space_dir"

mkdir -p "$KMK_BACKUP_DEST/daily" || fail "cannot create $KMK_BACKUP_DEST/daily"
chmod 700 "$KMK_BACKUP_DEST" "$KMK_BACKUP_DEST/daily" 2>/dev/null || true  # the dump holds password hashes; ignored on filesystems without modes

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
{
  echo "time: $(now_iso)"
  echo "git_commit: $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "alembic_revision: $(pg_exec "$DB" "select version_num from alembic_version" 2>/dev/null || echo none)"
  echo "db: $DB"
  echo "dump_sha256: $(sha256sum "$WORK/kmk.dump" | cut -d' ' -f1)"
  table_counts "$DB" | sed 's/^/rows./; s/=/: /'
} >"$WORK/MANIFEST.txt"
NAME="kmk-$(date -d "${KMK_BACKUP_NOW:-now}" +%Y-%m-%d_%H%M%S).tar"
FINAL="$KMK_BACKUP_DEST/daily/$NAME"
tar -C "$WORK" -cf "$FINAL.partial" kmk.dump MANIFEST.txt || { rm -f "$FINAL.partial"; fail "cannot write the archive"; }
mv -f "$FINAL.partial" "$FINAL"

# Remember the hash of what we wrote, in the state directory (outside the backup folder): the restore script only
# trusts archives it can find in this list, so an archive someone else drops in the folder is not executed.
mkdir -p "$KMK_BACKUP_STATE_DIR"
printf '%s  %s\n' "$(sha256sum "$FINAL" | cut -d' ' -f1)" "$NAME" >>"$KMK_BACKUP_STATE_DIR/archives.sha256"

# ---- photo snapshot (after the archive is safe, before any pruning: a failed run deletes nothing) ----
# Each snapshot is a complete folder; --link-dest only shares unchanged files with the previous one to save space.
SNAP_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$'
MESSAGE="backup written"
SNAP_NAME="${NAME#kmk-}"; SNAP_NAME="${SNAP_NAME%.tar}"
PHOTOS_DIR="$KMK_BACKUP_DEST/photos"
SNAP_MADE=0
if [[ -z "$KMK_BACKUP_PHOTOS_SRC" ]]; then
  log "photos: no source folder configured, skipping"
elif [[ ! -d "$KMK_BACKUP_PHOTOS_SRC" ]]; then
  log "photos: $KMK_BACKUP_PHOTOS_SRC does not exist, skipping"
elif [[ -z "$(find "$KMK_BACKUP_PHOTOS_SRC" -type f -print -quit 2>/dev/null)" ]]; then
  log "photos: $KMK_BACKUP_PHOTOS_SRC has no files, skipping"
else
  command -v rsync >/dev/null 2>&1 || fail "rsync is not installed: cannot back up the visit photos (install it, e.g. apt install rsync)"
  mkdir -p "$PHOTOS_DIR" || fail "cannot create $PHOTOS_DIR"
  chmod 700 "$PHOTOS_DIR" 2>/dev/null || true
  PHOTOS_ABS="$(cd "$PHOTOS_DIR" && pwd)"
  # Leftovers of an earlier crashed run (only folders named like a snapshot plus .partial).
  for d in "$PHOTOS_ABS"/*.partial; do
    [[ -d "$d" && ! -L "$d" ]] || continue
    [[ "$(basename "$d" .partial)" =~ $SNAP_PATTERN ]] && rm -rf -- "$d"
  done
  PREV="$(ls -1 "$PHOTOS_ABS" | grep -E "$SNAP_PATTERN" | grep -vxF "$SNAP_NAME" | sort -r | head -n 1 || true)"
  link_opt=()
  if [[ -n "$PREV" && -d "$PHOTOS_ABS/$PREV" && ! -L "$PHOTOS_ABS/$PREV" ]]; then link_opt=(--link-dest="$PHOTOS_ABS/$PREV"); fi
  PARTIAL="$PHOTOS_ABS/$SNAP_NAME.partial"
  log "photos: snapshotting $KMK_BACKUP_PHOTOS_SRC ..."
  if ! rsync -a "${link_opt[@]}" "$KMK_BACKUP_PHOTOS_SRC/" "$PARTIAL/" 2>"$WORK/rsync.err"; then
    rm -rf -- "$PARTIAL"
    fail "the photo snapshot failed (rsync): $(head -c 300 "$WORK/rsync.err")"
  fi
  # A snapshot with this very name can exist only if the same second was backed up twice: replace it, like the archive.
  [[ -d "$PHOTOS_ABS/$SNAP_NAME" && ! -L "$PHOTOS_ABS/$SNAP_NAME" ]] && rm -rf -- "$PHOTOS_ABS/$SNAP_NAME"
  mv -- "$PARTIAL" "$PHOTOS_ABS/$SNAP_NAME" || { rm -rf -- "$PARTIAL"; fail "cannot finish the photo snapshot"; }
  photo_count="$(find "$PHOTOS_ABS/$SNAP_NAME" -type f | wc -l | tr -d ' ')"
  MESSAGE="backup written (photos: $photo_count files)"
  SNAP_MADE=1
  log "photos: $photo_count files in $PHOTOS_ABS/$SNAP_NAME"
fi

# ---- retention: only after everything was written ----
# Newest first BY NAME (the name carries the timestamp), never by modification time: a file with a future modification
# time (clock skew, a copied folder) must not push the new backup out.
prune() {
  local dir=$1 keep=$2 keep_file=$3 n
  [[ -d "$dir" ]] || return 0
  ls -1 "$dir" | grep -E '^kmk-.*\.tar$' | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r n; do
    [[ "$dir/$n" == "$keep_file" ]] && continue  # never delete the backup just written
    rm -f -- "$dir/$n"
  done
}
prune "$KMK_BACKUP_DEST/daily" "$KMK_BACKUP_KEEP_DAILY" "$FINAL"
[[ -f "$FINAL" ]] || fail "internal error: the new backup is missing after pruning"

# Snapshots: only names that look like a snapshot are ever considered, never the one just made.
prune_snapshots() {
  local dir=$1 keep=$2 n
  [[ -d "$dir" ]] || return 0
  ls -1 "$dir" | grep -E "$SNAP_PATTERN" | sort -r | tail -n +"$((keep + 1))" | while IFS= read -r n; do
    [[ "$n" == "$SNAP_NAME" ]] && continue
    [[ -d "$dir/$n" && ! -L "$dir/$n" ]] || continue
    rm -rf -- "${dir:?}/$n"
  done
}
if [[ "$SNAP_MADE" == 1 ]]; then prune_snapshots "$PHOTOS_DIR" "$KMK_BACKUP_KEEP_DAILY"; fi

bytes="$(stat -c %s "$FINAL")"
write_status ok "$MESSAGE" "$FINAL" "$bytes"
log "ok: $FINAL ($bytes bytes)"
