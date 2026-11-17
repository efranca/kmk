#!/usr/bin/env bash
# Install (or remove) the daily backup timer as systemd USER units.
#   install.sh                  install and start the timer (needs the recipient key: run make-backup-key.sh first)
#   install.sh --dry-run        print the rendered units and the commands; change nothing
#   install.sh --render-to DIR  write the rendered units into DIR and stop (used by the tests)
#   install.sh --uninstall      stop and remove the timer and units
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"

UNIT_DIR="${KMK_BACKUP_UNIT_DIR:-$HOME/.config/systemd/user}"
UNITS=(kmk-backup.service kmk-backup.timer kmk-backup-alert.service)
MODE=install; RENDER_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE=dry; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    --render-to) MODE=render; RENDER_DIR="${2:?--render-to needs a directory}"; shift 2 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

render() { sed "s#@REPO@#$REPO_DIR#g" "$SELF_DIR/systemd/$1"; }

case "$MODE" in
  render)
    mkdir -p "$RENDER_DIR"
    for u in "${UNITS[@]}"; do render "$u" >"$RENDER_DIR/$u"; done
    ;;
  dry)
    for u in "${UNITS[@]}"; do echo "### $UNIT_DIR/$u"; render "$u"; echo; done
    echo "### commands"
    echo "systemctl --user daemon-reload"
    echo "systemctl --user enable --now kmk-backup.timer"
    ;;
  uninstall)
    systemctl --user disable --now kmk-backup.timer 2>/dev/null || true
    for u in "${UNITS[@]}"; do rm -f "$UNIT_DIR/$u"; done
    systemctl --user daemon-reload
    echo "Backup timer removed. Existing backups were not touched."
    ;;
  install)
    if [[ ! -r "$KMK_BACKUP_RECIPIENT_FILE" ]]; then
      echo "ERROR: no recipient public key at $KMK_BACKUP_RECIPIENT_FILE. Run make-backup-key.sh first (see docs/operations.md)." >&2
      exit 1
    fi
    mkdir -p "$UNIT_DIR"
    for u in "${UNITS[@]}"; do render "$u" >"$UNIT_DIR/$u"; done
    systemctl --user daemon-reload
    systemctl --user enable --now kmk-backup.timer
    systemctl --user list-timers kmk-backup.timer --no-pager || true
    echo
    echo "Installed. Check the last result any time with: $SELF_DIR/kmk-backup-status.sh"
    echo "Run a backup right now with: systemctl --user start kmk-backup.service"
    ;;
esac
