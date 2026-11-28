#!/usr/bin/env bash
# Run by systemd when a kmk service fails: show a desktop notification (best effort). Always exits 0.
#   notify-failure.sh          the backup failed (kmk-backup-alert.service): the message comes from the backup status file
#   notify-failure.sh purge    the photo purge failed (kmk-visit-photos-purge-alert.service): a fixed message
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

if [[ "${1:-}" == "purge" ]]; then
  app="KMK photo clean-up"
  title="KMK photo clean-up FAILED"
  body="The photo clean-up (purge) failed: photos older than 6 months may still be on disk; see: journalctl --user -u kmk-visit-photos-purge.service"
else
  status_file="$KMK_BACKUP_STATE_DIR/status"
  message="the last run left no status"
  if [[ -r "$status_file" ]]; then
    message="$(grep -m1 '^message=' "$status_file" | cut -d= -f2- || true)"
    message="${message:-unknown reason}"
  fi
  app="KMK backup"
  title="KMK backup FAILED"
  body="$message. Details: journalctl --user -u kmk-backup.service"
fi
log "$title: $body"

export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
notifier="${KMK_NOTIFY_BIN:-notify-send}"
if command -v "$notifier" >/dev/null 2>&1; then
  "$notifier" -u critical -a "$app" "$title" "$body" || log "(the desktop notification could not be shown)"
else
  log "(no desktop notifier available; the failure is in the journal)"
fi
exit 0
