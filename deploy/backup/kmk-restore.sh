#!/usr/bin/env bash
# Rehearse (or extract from) a backup.
#   kmk-restore.sh ARCHIVE [--extract-only DIR] [--keep-scratch] [--accept-unverified]
# Archives must be ones the backup script wrote (its hash is in the state directory); --accept-unverified overrides
# that (for example after a reinstall) and you must then be sure of where the file came from.
# Default: show the manifest, restore the dump into a scratch database (KMK_RESTORE_DB, default kmk_restore_test),
# compare the row counts with the manifest, print RESTORE OK, drop the scratch database. Never touches the live database.
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"
KMK_LIB_RECORD_STATUS=0  # a restore must never overwrite the backup status

ARCHIVE=""; EXTRACT_DIR=""; KEEP=0; ACCEPT_UNVERIFIED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extract-only) EXTRACT_DIR="${2:?--extract-only needs a directory}"; shift 2 ;;
    --keep-scratch) KEEP=1; shift ;;
    --accept-unverified) ACCEPT_UNVERIFIED=1; shift ;;
    -h|--help) sed -n '2,5p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done
[[ -n "$ARCHIVE" ]] || { echo "usage: kmk-restore.sh ARCHIVE [--extract-only DIR] [--keep-scratch] [--accept-unverified]" >&2; exit 2; }

RESTORE_DB="${KMK_RESTORE_DB:-kmk_restore_test}"
WORK=""; SCRATCH_CREATED=0
cleanup() {
  local rc=$?
  if [[ "$SCRATCH_CREATED" == 1 && "$KEEP" == 0 ]]; then
    pg_exec postgres "DROP DATABASE IF EXISTS \"$RESTORE_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  [[ -n "$WORK" ]] && rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

[[ -r "$ARCHIVE" ]] || fail "cannot read the archive $ARCHIVE"
# Archives are plain files, so anyone who can write to the backup folder could add one. Restoring runs SQL as the
# database superuser, so only archives this machine's backup script wrote (hash recorded in the state directory) are trusted.
archive_hash="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
if ! grep -q "^$archive_hash " "$KMK_BACKUP_STATE_DIR/archives.sha256" 2>/dev/null; then
  if [[ "$ACCEPT_UNVERIFIED" == 1 ]]; then
    log "WARNING: this archive is not recognised (its hash is not in $KMK_BACKUP_STATE_DIR/archives.sha256); continuing because of --accept-unverified."
  else
    fail "this archive is not recognised: it was not written by this machine's backup script (or the state directory was lost). Only if you are sure where it came from, repeat with --accept-unverified (ideally restore it into a throwaway database server)"
  fi
fi
check_db_name "$RESTORE_DB"
[[ "$RESTORE_DB" != "$KMK_BACKUP_DB" ]] || fail "refusing to restore over the live database '$KMK_BACKUP_DB'"

mkdir -p "$KMK_BACKUP_TMP"
WORK="$(mktemp -d -p "$KMK_BACKUP_TMP" kmk-restore.XXXXXX)"; chmod 700 "$WORK"
tar -C "$WORK" -xf "$ARCHIVE" 2>/dev/null || fail "the archive content is damaged"
for f in kmk.dump MANIFEST.txt; do [[ -s "$WORK/$f" ]] || fail "the archive is missing $f"; done

log "manifest:"
cat "$WORK/MANIFEST.txt"

if [[ -n "$EXTRACT_DIR" ]]; then
  mkdir -p "$EXTRACT_DIR"
  for f in kmk.dump MANIFEST.txt; do install -m 600 "$WORK/$f" "$EXTRACT_DIR/$f"; done
  echo "Extracted to $EXTRACT_DIR (files are mode 600: the dump holds password hashes; delete them when done)."
  exit 0
fi

pg_exec postgres "DROP DATABASE IF EXISTS \"$RESTORE_DB\" WITH (FORCE)" >/dev/null || fail "cannot reset the scratch database"
pg_exec postgres "CREATE DATABASE \"$RESTORE_DB\" TEMPLATE template0" >/dev/null || fail "cannot create the scratch database"
SCRATCH_CREATED=1
docker exec -i "$KMK_BACKUP_PG_CONTAINER" pg_restore -U "$KMK_BACKUP_PG_USER" -d "$RESTORE_DB" --no-owner --no-privileges --exit-on-error \
  <"$WORK/kmk.dump" >/dev/null 2>"$WORK/restore.err" || fail "the restore failed: $(head -c 300 "$WORK/restore.err")"

expected="$(grep '^rows\.' "$WORK/MANIFEST.txt" | sed 's/^rows\.//; s/: /=/' | sort)"
actual="$(table_counts "$RESTORE_DB" | sort)"
if [[ "$expected" != "$actual" ]]; then
  echo "Row counts do not match the manifest:" >&2
  diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") >&2 || true
  fail "restored data does not match the manifest"
fi
echo "RESTORE OK: $(printf '%s\n' "$actual" | wc -l) tables restored into '$RESTORE_DB' and match the manifest."
[[ "$KEEP" == 0 ]] || echo "Scratch database '$RESTORE_DB' kept (drop it when done)."
