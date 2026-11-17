#!/usr/bin/env bash
# Run by systemd when the backup service fails: show a desktop notification (best effort). Always exits 0.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

status_file="$KMK_BACKUP_STATE_DIR/status"
message="the last run left no status"
if [[ -r "$status_file" ]]; then
  message="$(grep -m1 '^message=' "$status_file" | cut -d= -f2- || true)"
  message="${message:-unknown reason}"
fi
title="KMK backup FAILED"
body="$message. Details: journalctl --user -u kmk-backup.service"
log "$title: $body"

export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
notifier="${KMK_NOTIFY_BIN:-notify-send}"
if command -v "$notifier" >/dev/null 2>&1; then
  "$notifier" -u critical -a "KMK backup" "$title" "$body" || log "(the desktop notification could not be shown)"
else
  log "(no desktop notifier available; the failure is in the journal)"
fi
exit 0
