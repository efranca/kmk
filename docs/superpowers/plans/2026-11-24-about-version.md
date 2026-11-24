# About (version, commit, build time) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Settings > About shows the app (UI) and server (API) version, commit and build time; the version rises on every deploy.

**Architecture:** Frontend values are fixed by Vite `define` at build time. The API bakes `APP_COMMIT`, `APP_COMMIT_COUNT`, `APP_BUILT_AT` into its image (compose build args) and serves them at guarded `GET /api/version`. Version = `<major>.<minor>.<commit count>`.

**Tech Stack:** FastAPI, React 19, Vite `define`, vitest, pytest, docker compose.

**Spec:** `docs/superpowers/specs/2026-11-24-about-version-design.md`

## Global Constraints
- Version rule: package version's first two numbers + `git rev-list --count HEAD`; plain package version when git is missing or the clone is shallow.
- `GET /api/version` uses `guard(csrf=False)` (the reader guard); no new `api.environment` entry in compose (values are baked into the image as ENV).
- Both packages start at `0.2.0`. All new UI strings in all three locale files (`about*` keys, identical sets).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
- No git / shallow history: version falls back to the package version, never `0.2.NaN`.
- API started without the build args: `commit` is `""`, `built_at` is `null`, no crash.
- Commit mismatch note must not appear when either side's commit is unknown.
- `/api/version` must not answer an unauthenticated or half-authenticated session.
- A garbage `APP_COMMIT_COUNT` env value (non-integer) falls back to the package version.

---

### Task 1: Backend version module and route

**Files:**
- Create: `backend/app/version.py`, `backend/tests/test_version.py`
- Modify: `backend/app/main.py` (include router), `backend/pyproject.toml` (`version = "0.2.0"`), `backend/Dockerfile`

**Interfaces:**
- Produces: `compute_version(package_version: str, commit_count: str | None) -> str`; `build_info() -> dict` = `{"version": str, "commit": str, "built_at": str | None}`; `router` with `GET /api/version`.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_version.py`: `compute_version("0.2.0","57") == "0.2.57"`; `compute_version("0.2.0", None) == "0.2.0"`; `compute_version("0.2.0","abc") == "0.2.0"`; `compute_version("0.2.0","0") == "0.2.0"`; `build_info()` with `monkeypatch.setenv` of the three vars returns `{"version":"0.2.57","commit":"abc1234","built_at":"2026-11-24T10:00:00Z"}`; with none set returns `commit == ""`, `built_at is None`, version equal to the installed package version; route: `client.get("/api/version")` is 401 without a session and 200 with `login(c,"alice")` session (use `session()` pattern from `test_preferences_api.py`), body keys exactly `version, commit, built_at`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_version.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `app/version.py`: package version via `importlib.metadata.version("kmk-api")` (fallback `"0.0.0"` on `PackageNotFoundError`); `compute_version` keeps `major.minor` and appends the count only when it is a positive integer string; `build_info()` reads the env at call time; `router = APIRouter()` with `@router.get("/api/version")` using `Depends(guard(csrf=False))`. Include the router in `main.py`. Bump `pyproject.toml` to `0.2.0`. In `Dockerfile` add, before `RUN pip install`: `ARG APP_COMMIT=""`, `ARG APP_COMMIT_COUNT=""`, `ARG APP_BUILT_AT=""` and `ENV APP_COMMIT=$APP_COMMIT APP_COMMIT_COUNT=$APP_COMMIT_COUNT APP_BUILT_AT=$APP_BUILT_AT` (after the pip install line so the pip layer stays cached).
- [ ] **Step 4: Run** `.venv/bin/pytest tests/test_version.py tests/test_mfa_guard.py -q`. Expected: PASS (the guard test must still pass; it enumerates routes).
- [ ] **Step 5: Commit** `feat(version): API version endpoint`.

### Task 2: Frontend version helpers and build-time constants

**Files:**
- Create: `frontend/scripts/appVersion.ts`, `frontend/src/appVersion.test.ts`
- Modify: `frontend/vite.config.ts`, `frontend/src/vite-env.d.ts`, `frontend/tsconfig.json` (include `scripts`), `frontend/package.json` (`"version": "0.2.0"`)

**Interfaces:**
- Produces: `appVersion(packageVersion: string, commits: number | null): string`, `commitCount(): number | null` (null when git is missing, repo shallow, or count invalid), `shortCommit(): string`; globals `__APP_VERSION__`, `__BUILD_TIME__`, `__BUILD_COMMIT__` (strings).

- [ ] **Step 1: Write failing tests** (`appVersion.test.ts`): `appVersion("0.2.0", 57) === "0.2.57"`; `appVersion("0.2.0", null) === "0.2.0"`; `appVersion("1", 9) === "1.0.9"`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/appVersion.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by porting `~/projects/famillai/ui/scripts/appVersion.ts` (read it; same three functions, `execSync` of `git`). Add the `define` block to `vite.config.ts` as in FamillAI's (`JSON.stringify` of `appVersion(pkg.version, commitCount())`, `new Date().toISOString()`, `shortCommit()`), reading `package.json` with `readFileSync`. Declare the three `const` globals in `vite-env.d.ts`. Add `"scripts"` to tsconfig `include`.
- [ ] **Step 4: Run** the test, then `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(version): build-time version for the app`.

### Task 3: About section in Settings

**Files:**
- Create: `frontend/src/AboutSection.tsx`, `frontend/src/About.test.tsx`
- Modify: `frontend/src/api.ts` (`fetchVersion`), `frontend/src/SettingsPage.tsx`, `frontend/src/locales/{en,fr-CA,pt-BR}.json`, `frontend/src/index.css` or `ui/ui.css` (small `.about` definition list style using theme tokens)

**Interfaces:**
- Produces: `fetchVersion(): Promise<{ version: string; commit: string; builtAt: string | null } | null>` (null on any failure); `<AboutSection />` (no props).
- Locale keys: `settingsAbout`, `aboutApp`, `aboutServer`, `aboutVersion`, `aboutCommit`, `aboutBuilt`, `aboutUnknown`, `aboutMismatch`.

- [ ] **Step 1: Write failing tests** (`About.test.tsx`, render inside `Providers`, stub `fetch` for `/api/version`): shows the app row with the `__APP_VERSION__` value; shows the server version/commit/built date when the call succeeds; shows `aboutUnknown` for the server when it fails; shows `aboutMismatch` only when both commits are non-empty and differ (use `vi.stubGlobal("__BUILD_COMMIT__", "aaaaaaa")` and a server commit `bbbbbbb`); no note when the server commit is empty. Also a Settings test: the About heading renders on the Settings page.
- [ ] **Step 2: Run** `npx vitest run src/About.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `fetchVersion` (GET `/api/version`, `credentials: same-origin`), `AboutSection` (TanStack `useQuery`, `<dl class="about">`, dates through `toLocaleString(i18n.language, {dateStyle:"long", timeStyle:"short"})`, invalid date -> `aboutUnknown`), mount it as the last section of `SettingsPage`, and add the keys to all three locales (translate fr-CA and pt-BR).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: all pass (locale key-set test included).
- [ ] **Step 5: Commit** `feat(version): About section in Settings`.

### Task 4: Deploy plumbing and docs

**Files:**
- Modify: `deploy/docker-compose.yml` (`api.build` becomes `context: ../backend` with `args` `APP_COMMIT`, `APP_COMMIT_COUNT`, `APP_BUILT_AT` taken from the shell, empty default), `infrastructure/deployments/auto-deploy.sh` (export the three before `docker compose up -d --build`, computed in the worktree: `git rev-parse --short HEAD`, `git rev-list --count HEAD`, `date -u +%Y-%m-%dT%H:%M:%SZ`), `CLAUDE.md` (versioning rule), `docs/README.md`, `docs/operations.md`
- Test: `backend/tests/test_deploy_config.py` (one new assertion)

- [ ] **Step 1: Add a failing assertion** to `test_deploy_config.py` that the `api` service's `build.args` has the three keys and that `api.environment` does not (the values are baked, not passed at runtime).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_deploy_config.py -q`. Expected: FAIL (or skipped without docker/.env: then say so in the ledger).
- [ ] **Step 3: Edit** compose, the deploy script (read it first; place the exports right before the `docker compose up` line), CLAUDE.md ("raise the minor in `frontend/package.json` and `backend/pyproject.toml` for a release with user-visible changes; the third number is automatic") and the docs (About section, how the version is built, that manual builds show "unknown").
- [ ] **Step 4: Run** `bash -n infrastructure/deployments/auto-deploy.sh` and the deploy-config test. Expected: syntax OK, PASS.
- [ ] **Step 5: Commit** `feat(version): deploy passes the build info; docs`.
