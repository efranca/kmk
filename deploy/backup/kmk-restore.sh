#!/usr/bin/env bash
# Rehearse (or extract from) a backup. Needs the private key, which only the owner has.
#   kmk-restore.sh ARCHIVE --private-key FILE [--extract-only DIR] [--keep-scratch]
# Default: decrypt, show the manifest, restore the dump into a scratch database (KMK_RESTORE_DB, default kmk_restore_test),
# compare the row counts with the manifest, print RESTORE OK, drop the scratch database. Never touches the live database.
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"
KMK_LIB_RECORD_STATUS=0  # a restore must never overwrite the backup status

ARCHIVE=""; PRIVATE_KEY=""; EXTRACT_DIR=""; KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --private-key) PRIVATE_KEY="${2:?--private-key needs a file}"; shift 2 ;;
    --extract-only) EXTRACT_DIR="${2:?--extract-only needs a directory}"; shift 2 ;;
    --keep-scratch) KEEP=1; shift ;;
    -h|--help) sed -n '2,5p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done
[[ -n "$ARCHIVE" && -n "$PRIVATE_KEY" ]] || { echo "usage: kmk-restore.sh ARCHIVE --private-key FILE [--extract-only DIR] [--keep-scratch]" >&2; exit 2; }

RESTORE_DB="${KMK_RESTORE_DB:-kmk_restore_test}"
WORK=""; KEYRING=""; SCRATCH_CREATED=0
cleanup() {
  local rc=$?
  if [[ "$SCRATCH_CREATED" == 1 && "$KEEP" == 0 ]]; then
    pg_exec postgres "DROP DATABASE IF EXISTS \"$RESTORE_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  if [[ -n "$KEYRING" ]]; then
    GNUPGHOME="$KEYRING" gpgconf --kill all >/dev/null 2>&1 || true
    rm -rf "$KEYRING"
  fi
  [[ -n "$WORK" ]] && rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

[[ -r "$ARCHIVE" ]] || fail "cannot read the archive $ARCHIVE"
[[ -r "$PRIVATE_KEY" ]] || fail "cannot read the private key file $PRIVATE_KEY"
check_db_name "$RESTORE_DB"
[[ "$RESTORE_DB" != "$KMK_BACKUP_DB" ]] || fail "refusing to restore over the live database '$KMK_BACKUP_DB'"

mkdir -p "$KMK_BACKUP_TMP"
KEYRING="$(mktemp -d -p "$KMK_BACKUP_TMP" kmk-keyring.XXXXXX)"; chmod 700 "$KEYRING"
WORK="$(mktemp -d -p "$KMK_BACKUP_TMP" kmk-restore.XXXXXX)"; chmod 700 "$WORK"
export GNUPGHOME="$KEYRING"
if [[ -t 0 ]]; then GPG_TTY="$(tty)"; export GPG_TTY; fi

gpg --batch --quiet --import "$PRIVATE_KEY" >/dev/null 2>&1 || fail "the private key file could not be imported"
gpg --batch --yes --quiet --decrypt --output "$WORK/archive.tar" "$ARCHIVE" 2>"$WORK/gpg.err" \
  || fail "cannot decrypt the archive (wrong key, wrong passphrase, or a damaged file)"
tar -C "$WORK" -xf "$WORK/archive.tar" 2>/dev/null || fail "the archive content is damaged"
for f in kmk.dump deploy.env MANIFEST.txt; do [[ -s "$WORK/$f" ]] || fail "the archive is missing $f"; done

log "manifest:"
cat "$WORK/MANIFEST.txt"

if [[ -n "$EXTRACT_DIR" ]]; then
  mkdir -p "$EXTRACT_DIR"
  for f in kmk.dump deploy.env MANIFEST.txt; do install -m 600 "$WORK/$f" "$EXTRACT_DIR/$f"; done
  echo "Extracted to $EXTRACT_DIR (files are mode 600: they hold secrets; delete them when done)."
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
