# About: version, commit and build time

## Intent
Anyone (and the owner above all) can tell exactly which build is running: a version that rises with every release, the commit it came from and when it was built. Modeled on FamillAI (`ui/scripts/appVersion.ts`, `AboutDetails.tsx`).

## Goals
- Settings gets an **About** section (every signed-in person) listing, for the **app (UI)** and the **server (API)**: Version, Commit (short hash), Built (date and time in the person's language).
- **Version = `<major>.<minor>.<commit count>`.** Major and minor come from `frontend/package.json` and `backend/pyproject.toml` by hand (minor goes up when a release has user-visible changes; CLAUDE.md gets this rule). The third number is `git rev-list --count HEAD`, so every build from a newer commit has a higher version. Without usable git history (no git, shallow clone) the plain package version is shown.
- The UI values are fixed at build time (Vite `define`: `__APP_VERSION__`, `__BUILD_TIME__`, `__BUILD_COMMIT__`).
- The API reports its own in `GET /api/version` (guarded, any verified session): `{version, commit, built_at}`. They are baked into the image as `ENV APP_COMMIT`, `APP_COMMIT_COUNT`, `APP_BUILT_AT` from compose build args, so no `api.environment` entry is needed. Missing values give `commit: ""`, `built_at: null` and the package version.
- When the UI and API commits differ, About says so ("The app and the server are from different builds; reload"), since that is the signature of a half-finished deploy or a stale tab.
- `infrastructure/deployments/auto-deploy.sh` exports the three values before `docker compose up -d --build`; `deploy/docker-compose.yml` passes them as `build.args` for `api`. Manual builds without them show "unknown".

## Non-goals
Release notes or a changelog screen; update prompts; automatic bumping of major/minor; showing the database migration revision.

## Approaches
1. **Commit count as the third number (chosen).** Same as FamillAI, automatic, monotonic on one branch. Needs full history in the build (the deploy worktree has it; the code falls back safely otherwise).
2. A hand-bumped version in both files each release. Rejected: easy to forget, which is exactly what the owner wants to avoid.
3. A CI-generated tag. Rejected: no CI release step exists here.

## Calls made by me
- Reads "increase the minor version in every release" as: the visible version rises on every deploy (commit count), while major/minor mark meaningful releases by hand, as FamillAI does.
- `/api/version` is guarded (not public) so a stranger cannot fingerprint the build.
- Start at `0.2.x` for both packages (this release adds features).

## Tests
Frontend: `appVersion()` unit tests (count, null count, shallow), About renders both rows, shows the mismatch note. Backend: `/api/version` shape, guarded (the half-authenticated-session test covers it), fallback without env.
