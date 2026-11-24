#!/usr/bin/env bash
# List every scheduled job on this machine: user crontabs, /etc/crontab, /etc/cron.d, the cron.hourly/daily/weekly/
# monthly folders, anacron, systemd timers (system and per-user) and pending `at` jobs. Read-only.
# Usage: list-cron-jobs.sh          (run with sudo to also read other users' crontabs and root's)
set -uo pipefail

section() { printf '\n== %s ==\n' "$1"; }
# Print a crontab/cron file without comments and blank lines; "(none)" if there is nothing.
active() { local out; out="$(grep -vE '^\s*(#|$)' "$1" 2>/dev/null)" && [ -n "$out" ] && printf '%s\n' "$out" || echo "(none)"; }

section "System crontab (/etc/crontab)"
[ -r /etc/crontab ] && active /etc/crontab || echo "(not readable or missing)"

section "/etc/cron.d"
if [ -d /etc/cron.d ]; then
  found=0
  for f in /etc/cron.d/*; do
    [ -f "$f" ] || continue
    found=1; printf -- '-- %s\n' "$f"; active "$f"
  done
  [ "$found" = 0 ] && echo "(empty)"
else echo "(missing)"; fi

for p in hourly daily weekly monthly; do
  section "/etc/cron.$p (run-parts scripts)"
  if [ -d "/etc/cron.$p" ]; then
    ls -1 "/etc/cron.$p" 2>/dev/null | grep -v '^\.placeholder$' || echo "(empty)"
  else echo "(missing)"; fi
done

section "anacron (/etc/anacrontab)"
[ -r /etc/anacrontab ] && active /etc/anacrontab || echo "(not installed)"

section "User crontabs"
if [ "$(id -u)" = 0 ]; then
  for u in $(cut -d: -f1 /etc/passwd); do
    out="$(crontab -u "$u" -l 2>/dev/null | grep -vE '^\s*(#|$)')" && [ -n "$out" ] && { printf -- '-- %s\n%s\n' "$u" "$out"; }
  done
  echo "(all users checked)"
else
  printf -- '-- %s\n' "$(id -un)"
  out="$(crontab -l 2>/dev/null | grep -vE '^\s*(#|$)')"; [ -n "$out" ] && printf '%s\n' "$out" || echo "(none)"
  echo "(other users' crontabs need sudo)"
fi

section "systemd timers (system)"
systemctl list-timers --all --no-pager 2>/dev/null || echo "(systemd not available)"

section "systemd timers (user $(id -un))"
systemctl --user list-timers --all --no-pager 2>/dev/null || echo "(no user systemd session)"

section "at jobs"
if command -v atq >/dev/null; then atq 2>/dev/null | grep . || echo "(none)"; else echo "(at not installed)"; fi
