# Infrastructure

Everything KMK needs **around** the application code (`backend/`, `frontend/`), kept in the repo so a new PC can be set up
from it. Nothing here is built into the app; it is operations. Modeled on the `infrastructure/` folder of famillai.

| Folder | What | Docs |
|---|---|---|
| [`deployments/`](deployments/) | Auto-deploy: polls GitHub and deploys a new `origin/main` (frontend build + Docker rebuild + smoke check), with its systemd timer. **Installed on this computer (`kmk-deploy.timer`): pushing `main` deploys to production.** | [deployments/README.md](deployments/README.md) |
| [`utilities/`](utilities/) | Read-only helper scripts, e.g. `list-cron-jobs.sh` (every cron job, systemd timer and `at` job on the machine). | [utilities/README.md](utilities/README.md) |
| backups | **Not here: [`deploy/backup/`](../deploy/backup/).** KMK's backups are encrypted, verified and restore-tested (their tests and the docs point at that path), so they stay where they are. Operations guide: [docs/operations.md](../docs/operations.md#backups). | |

The app's own stack (API + Caddy) is `deploy/docker-compose.yml`.
