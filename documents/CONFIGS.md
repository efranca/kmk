# Configuration files: `deploy/.env` and `backend/.env`

Both files are git-ignored. Never commit them, print them, or paste their values into chat.

| | `deploy/.env` | `backend/.env` |
| --- | --- | --- |
| **Used by** | `docker compose` for the real stack (API, Caddy, migrate) | The backend run directly on a developer machine: the tests, `alembic` and the CLI from `backend/.venv` |
| **Contains** | Production settings: `DATABASE_URL`, `SESSION_SECRET`, `EMAIL_BACKEND`, `RESEND_API_KEY`, `MFA_ENCRYPTION_KEY`, `VAPID_*` | Dev and test settings: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_APP_DATABASE_URL`, `SESSION_SECRET` |
| **Database** | The real `kmk` database | The tests use `kmk_test` only. `tests/conftest.py` forces the test URLs, so tests never touch the real database. |
| **Reaches the API?** | Only the variables listed in `api.environment` in `deploy/docker-compose.yml` | Never goes into a container |
| **Template** | `deploy/.env.example` | none |

## Why the compose file passes variables one by one

`deploy/docker-compose.yml` lists each container's environment explicitly, so the API container never receives the database owner's URL (`MIGRATION_DATABASE_URL`). Only the one-shot `migrate` service gets it.

A new API setting has to be added to `api.environment` in the compose file, or the container will not see it.

## Web Push (VAPID) keys

- They belong in `deploy/.env`, because the production API reads them from there. `backend/.env` does not need them.
- Generate them once. The command prints a new pair and reads neither `.env` file, so it can run from the backend virtual environment:

  ```bash
  cd backend && .venv/bin/python -m app.cli vapid-keys >> ../deploy/.env
  ```

  This appends `VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_KEY=...` without showing them on screen. Check with `grep -c '^VAPID' ../deploy/.env` (expect `2`).
- Running it again appends a second pair. Delete the extra pair. Changing the pair after devices have subscribed turns every device's notifications off.
- Back up the private key, as you do the `MFA_ENCRYPTION_KEY`.
- Optional: set `VAPID_SUBJECT=mailto:you@example.com` (default `mailto:admin@kmk-entretien.ca`).
- The keys only take effect once the API is rebuilt and restarted with the current code (`cd deploy && docker compose up -d --build`, with the frontend built first).

See `docs/operations.md` for the full list of environment variables and the quote-request setup steps.
