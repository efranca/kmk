#!/usr/bin/env bash
# Show the result of the last backup and how long ago it was. Exit 0 only if the last run succeeded and is recent enough.
#   kmk-backup-status.sh [--max-age-hours N]      (default 36)
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

max_hours=36
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-age-hours) max_hours="${2:?--max-age-hours needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,4p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$max_hours" =~ ^[0-9]+$ ]] || { echo "--max-age-hours must be a whole number" >&2; exit 2; }

status_file="$KMK_BACKUP_STATE_DIR/status"
if [[ ! -r "$status_file" ]]; then
  echo "No backup status found at $status_file: no backup has run yet." >&2
  exit 1
fi
get() { grep -m1 "^$1=" "$status_file" | cut -d= -f2- || true; }
result="$(get result)"; when="$(get time)"; epoch="$(get epoch)"; file="$(get file)"; bytes="$(get bytes)"; message="$(get message)"

age_s=$(( $(date +%s) - ${epoch:-0} ))
age_h=$(( age_s / 3600 ))
echo "Last backup: $result"
echo "  when:    $when (${age_h} h ago)"
[[ -z "$file" ]] || echo "  file:    $file (${bytes:-?} bytes)"
echo "  message: $message"

if [[ "$result" != "ok" ]]; then
  echo "The last backup FAILED." >&2
  exit 1
fi
if (( age_s > max_hours * 3600 )); then
  echo "The last good backup is too old (more than $max_hours hours)." >&2
  exit 1
fi
echo "Status: OK (newer than $max_hours hours)."
