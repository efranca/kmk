# Utilities

Small read-only helper scripts for the machine KMK runs on.

| Script | What |
|---|---|
| [`list-cron-jobs.sh`](list-cron-jobs.sh) | Lists every scheduled job on the system: `/etc/crontab`, `/etc/cron.d`, the `cron.hourly/daily/weekly/monthly` folders, anacron, user crontabs, systemd timers (system and your user: this includes the KMK backup and auto-deploy timers) and pending `at` jobs. |

```
infrastructure/utilities/list-cron-jobs.sh          # your own crontab, plus everything else that is world-readable
sudo infrastructure/utilities/list-cron-jobs.sh     # also every other user's crontab, including root's
```

It changes nothing; comments and blank lines in crontabs are hidden.
