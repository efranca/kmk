# kmk Phase 5 (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An app shell with navigation, a placeholder welcome page, an account page, per-user language switching stored on the server, a pre-login language picker, language-carrying email links, a not-found page, and polish.

**Architecture:** One small backend addition (`POST /api/auth/locale`, plus the recipient's language in invite/reset links). On the frontend, `App` routes by path to a card layout (sign-in, forgot/set password, two-step screens, not found) or to the new `Shell` (header with navigation, language switcher and sign-out) wrapping the Welcome, Account and Admin pages. Language utilities (`lang.ts`) keep the pre-login preference in `localStorage`.

**Tech Stack:** as phases 1-4b; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-phase5-frontend-design.md` (also `docs/roadmap.md`, `scope.md` §7)

## Global Constraints

- All earlier Global Constraints hold (guard on every protected route, Origin + CSRF on mutating requests, tests first and watched failing, tests only on `kmk_test` with `NullPool` apps, strings in all three locale files with the parity test, no external assets so the CSP is unchanged, commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, secrets never printed).
- Languages: `fr-CA` (default), `en`, `pt-BR`. Switcher labels: `FR`, `EN`, `PT`. The browser keeps only the pre-login preference, in `localStorage` key `kmk.lang`; every storage access is wrapped in try/catch and the app works without storage.
- Email links: `{public_base_url}/set-password#token={token}&lang={locale}`. The token stays first in the fragment. `build_link(settings, raw_token, locale=None)` with no locale returns the old link unchanged.
- Routes: `/` (Welcome when signed in, sign-in form otherwise), `/account`, `/admin`, `/forgot-password`, `/set-password`; anything else is "not found". Anonymous visitors of `/account` or `/admin` see the sign-in form and, after signing in, the requested page. Signed-in non-admins visiting `/admin` see the Welcome page (as in phase 4b). A signed-in user whose two-step state is `verify` or `setup` sees those screens on every path.
- Page titles: `{page name} · KMK Entretien Ménager`, from the nav keys (`navWelcome`, `navAccount`, `adminTitle`, `signInTitle`, `forgotTitle`, `setPasswordTitle`, `notFoundTitle`, `mfaCodeTitle` for the verify screen, `mfaSetupTitle` for setup); `<html lang>` follows the language.
- New locale keys (identical in all three files): `navWelcome`, `navAccount`, `navUsers`, `language`, `langError`, `welcomeTitle`, `welcomeIntro`, `notFoundTitle`, `notFoundText`, `notFoundHome`, `skipToContent`. The existing `welcome` key ("Bonjour, {{name}}") stays the Welcome page heading. Placeholder wording for `welcomeTitle` / `welcomeIntro`: FR "Bienvenue chez KMK Entretien Ménager" / "Cet espace est réservé à l'équipe. Les informations de l'entreprise (contacts, procédures, ressources) y seront ajoutées bientôt."; EN "Welcome to KMK Entretien Ménager" / "This space is for the team. Company information (contacts, procedures, resources) will be added here soon."; PT "Bem-vindo à KMK Entretien Ménager" / "Este espaço é para a equipe. As informações da empresa (contatos, procedimentos, recursos) serão adicionadas aqui em breve." The Portuguese text needs review by a Portuguese reader (recorded as an open item).
- **Rulings at plan time:** (1) `SignedIn.tsx` becomes `AccountPage.tsx` (git mv); its content (two-step section, change password, recovery-code notice, banner, enrollment) moves to `/account`; existing frontend tests that looked for those on `/` are updated to visit `/account`, and the admin-link test uses the nav link `navUsers`, with no assertion weakened; (2) the welcome page content blocks live in `welcomeContent.ts` as a typed, empty list; (3) a "skip to content" link is added for keyboard users; (4) the audit event for a language change is `locale_changed` with `{"from", "to"}`; (5) a language change by someone whose two-step state is not `ok` is refused by the existing guard.
- Phase 1-4b tests (231 backend, 45 frontend) must stay green apart from the deliberate test updates in ruling (1).

## Review Focus

- The language is stored per user on the server; a failed switch keeps the old language and tells the user; signing in applies the user's language and saves it as the pre-login preference; the app starts in the saved language without flashing French (Tasks 1, 2).
- The emailed link still works exactly as before (token first, fragment removed from the address bar) and the `lang` value is validated: an unknown value is ignored (Tasks 1, 2).
- Navigation shows Users only to admins and the super admin; unknown paths show not-found; `/admin` for a plain user shows Welcome; anonymous visitors of `/account` or `/admin` are asked to sign in first (Task 3).
- The locale endpoint is guarded (an unverified two-step session gets `403 mfa_required`), validates the value, audits the change, and the next reset email uses the new language (Task 1).
- Nothing from the old signed-in page was lost (two-step section, change password, banner, recovery notice), and the documentation matches the system (Tasks 3, 4).

---

### Task 1: Backend: locale endpoint and language in email links

**Files:**
- Modify: `backend/app/auth/account.py`, `backend/app/emails/templates.py`
- Test: `backend/tests/test_account.py` (extend), `backend/tests/test_emails.py` (extend)

**Interfaces:**
- Consumes: phase 3/4a guard, `service.user_payload`, `audit.log`, `queue_email`.
- Produces:
  - `POST /api/auth/locale` `{"locale": "fr-CA"|"en"|"pt-BR"}` (`guard()` default, so CSRF and a fully verified session): sets the caller's `users.locale` and `updated_at`, writes audit `locale_changed` `{"from", "to"}` only when the value changed, returns `200 {"user": <user_payload>}`; other values `422`.
  - `templates.build_link(settings: Settings, raw_token: str, locale: str | None = None) -> str`: `.../set-password#token={raw_token}` plus `&lang={locale}` when a locale is given. `account.queue_email` passes the recipient's `user.locale`.
  - Rendered messages (text and HTML) end with the brand line `KMK Entretien Ménager, Québec`.

- [ ] **Step 1: Write the tests first**
  - `test_account.py`: `test_locale_change` (a signed-in user posts `en` → `200`, the response and the database show `en`, `/me` shows `en`; other users unchanged; audit row `locale_changed` with `from`/`to`; posting the same value writes no second audit row); `test_locale_validation` (`de` and an empty body → `422`); `test_locale_needs_csrf_and_login` (anonymous `401`, missing CSRF token `403`); `test_next_email_uses_the_new_language` (after switching to `en`, `forgot-password` queues a message whose subject equals `render("reset", "en", ...).subject` and whose link ends with `&lang=en`).
  - `test_emails.py`: `build_link(settings, "tok", "pt-BR")` equals `https://x.example/set-password#token=tok&lang=pt-BR`; `build_link(settings, "tok")` is unchanged; every rendered message (all kinds and locales) contains `KMK Entretien Ménager, Québec` in text and HTML; the invite email's link for a user created by an admin carries `&lang=<their locale>`.
  - The existing route-classification test (`test_mfa_guard.py`) covers the new route automatically.
- [ ] **Step 2: Run to watch them fail** — `cd backend && .venv/bin/pytest tests/test_account.py tests/test_emails.py -q` → new tests FAIL.
- [ ] **Step 3: Implement** the endpoint, `build_link` and the footer line.
- [ ] **Step 4: Run the whole suite** — `cd backend && .venv/bin/pytest -q` → all pass (about a minute).
- [ ] **Step 5: Commit** `feat(i18n): per-user language endpoint and language in email links`.

---

### Task 2: Frontend language foundations

**Files:**
- Create: `frontend/src/lang.ts`, `frontend/src/LanguagePicker.tsx`, `frontend/src/LanguageSwitcher.tsx`
- Modify: `frontend/src/i18n.ts`, `frontend/src/api.ts`, `frontend/src/route.ts`, `frontend/src/SetPassword.tsx`, `frontend/src/setup.ts`, `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`
- Test: `frontend/src/Language.test.tsx` (new)

**Interfaces:**
- Produces:
  - `lang.ts`: `type Lang = "fr-CA" | "en" | "pt-BR"`; `LANGS: {code: Lang; label: string}[]` (`FR`, `EN`, `PT`); `isLang(x: unknown): x is Lang`; `savedLanguage(): Lang | null` and `rememberLanguage(code: Lang): void` (the `kmk.lang` key, try/catch); `initialLanguage(): Lang` (saved or `fr-CA`).
  - `i18n.ts` initializes with `lng: initialLanguage()`.
  - `api.ts`: `setLocale(csrfToken: string, locale: Lang): Promise<{ok: true; user: User} | {ok: false}>` posting to `/api/auth/locale`.
  - `route.ts`: `consumeToken()` also captures `lang` from the same fragment (`#token=...&lang=...`) before the fragment is removed; new `linkLanguage(): Lang | null` returns the remembered valid value; `forgetToken()` clears both.
  - `LanguagePicker` (pre-login): three buttons `FR`/`EN`/`PT` (the current one has `aria-pressed="true"`); a click calls `i18n.changeLanguage` and `rememberLanguage`; label `aria-label={t("language")}`.
  - `LanguageSwitcher` (signed in): a `<select aria-label={t("language")}>` with the three languages; on change it calls `setLocale`; on success it switches the interface, saves the preference and reports the new user through `onChanged(user)`; on failure it keeps the previous language and shows `langError`.
  - `SetPassword` applies `linkLanguage()` (changes the interface language for that visit, no saving).
  - `setup.ts` clears `localStorage` after each test.
  - New locale keys from Global Constraints used here: `language`, `langError`.

- [ ] **Step 1: Write `Language.test.tsx` first:**
  - `lang.ts`: `isLang` accepts the three codes only; `initialLanguage()` is `fr-CA` with an empty store, the saved value when valid, `fr-CA` for an invalid saved value, and does not throw when `localStorage` access throws.
  - picker: clicking `EN` switches the interface to English and stores `en`; the pressed state follows the language.
  - switcher (mocked `fetch`): choosing `pt-BR` posts `{"locale": "pt-BR"}` with the CSRF header and then switches the UI and stores `pt-BR`; a rejected request or a `4xx` keeps the previous language and shows `langError`.
  - `consumeToken()`/`linkLanguage()`: with `#token=abc&lang=pt-BR` the token is `abc`, the language is `pt-BR`, and the fragment is removed; `lang=de` or a missing `lang` gives `null`; `forgetToken()` clears both.
  - set-password page: opened with `#token=abc&lang=pt-BR` it renders in Portuguese and still posts the token `abc`; with `lang=de` it stays in the current language.
- [ ] **Step 2: Run to watch them fail** — `cd frontend && npx vitest run src/Language.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the files above; add the two locale keys in all three files (`language`: "Langue" / "Language" / "Idioma"; `langError`: "Impossible de changer la langue." / "Could not change the language." / "Não foi possível alterar o idioma.").
- [ ] **Step 4: Run all frontend tests and build** — `cd frontend && npx vitest run && npm run build` → all pass.
- [ ] **Step 5: Commit** `feat(i18n): language utilities, picker, switcher and link language`.

---

### Task 3: App shell, pages and polish

**Files:**
- Create: `frontend/src/Shell.tsx`, `frontend/src/WelcomePage.tsx`, `frontend/src/welcomeContent.ts`, `frontend/src/NotFound.tsx`
- Rename: `frontend/src/SignedIn.tsx` → `frontend/src/AccountPage.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/AdminPage.tsx` (no heading logo, runs inside the shell), `frontend/src/LoginForm.tsx`, `frontend/src/ForgotPassword.tsx`, `frontend/src/SetPassword.tsx` (show `LanguagePicker`), `frontend/src/locales/{fr-CA,en,pt-BR}.json`, `frontend/src/index.css`, `frontend/index.html`
- Test: `frontend/src/Shell.test.tsx` (new); update `App.test.tsx`, `Account.test.tsx`, `Mfa.test.tsx`, `Admin.test.tsx` per ruling (1)

**Interfaces:**
- Consumes: Task 2 (`LanguagePicker`, `LanguageSwitcher`, `lang.ts`), phase 2-4b components.
- Produces:
  - `welcomeContent.ts`: `export type WelcomeBlock = {titleKey: string; bodyKey: string}; export const welcomeBlocks: WelcomeBlock[] = [];`
  - `Shell({user, active, onNavigate, onLanguageChanged, onSignOut, children})`: a skip link (`skipToContent`, target `#main`), the logo (a link to `/`), navigation links `navWelcome` (`/`), `navAccount` (`/account`) and `navUsers` (`/admin`, only for `admin`/`superadmin`) with `aria-current="page"` on the active one, `LanguageSwitcher`, and the sign-out button; `children` render inside `<main id="main">`. Links use `href` and are handled in-page through `onNavigate(path)`.
  - `WelcomePage({user, mfaEnabled, recoveryCodesLeft})`: `<h1>` with `welcome` and the user name, the `welcomeTitle` and `welcomeIntro` texts, the content blocks from `welcomeBlocks` (`h2` from `titleKey`, `p` from `bodyKey`), the recovery-code notice and, when two-step is off, `MfaBanner`.
  - `AccountPage` (the old signed-in content): role line, notice, banner, `SecuritySection`, `ChangePassword`, enrollment; no sign-out button and no admin link (the shell has them).
  - `NotFound({onHome})`: `notFoundTitle`, `notFoundText`, a link `notFoundHome` to `/`.
  - `App`: routing per Global Constraints; the card layout for sign-in, forgot/set password, two-step screens, not-found and "checking"; `Shell` for signed-in `ok` pages; sets `document.title` and `<html lang>`; applies the user's language and saves it (`rememberLanguage`) when a session starts (sign-in or `me`).
  - New locale keys: `navWelcome` ("Accueil"/"Home"/"Início"), `navAccount` ("Mon compte"/"My account"/"Minha conta"), `navUsers` ("Utilisateurs"/"Users"/"Usuários"), `welcomeTitle`, `welcomeIntro` (as in Global Constraints), `notFoundTitle` ("Page introuvable"/"Page not found"/"Página não encontrada"), `notFoundText` ("Cette page n'existe pas."/"This page does not exist."/"Esta página não existe."), `notFoundHome` ("Retour à l'accueil"/"Back to home"/"Voltar ao início"), `skipToContent` ("Aller au contenu"/"Skip to content"/"Ir para o conteúdo").

- [ ] **Step 1: Write `Shell.test.tsx` first** (mock `fetch`; set the URL with `window.history.pushState` before rendering; reset in `afterEach`):
  - signed-in `/` shows the Welcome page (greeting, placeholder text, no content blocks) inside the shell with the logo, nav, language switcher and sign-out; `/account` shows the two-step section and change-password form; the nav marks the active entry with `aria-current="page"`; clicking a nav link changes the page without a reload.
  - navigation by role: a `user` sees Welcome and Account only; an `admin` and a `superadmin` also see Users; a plain user visiting `/admin` sees the Welcome page and no admin request is made.
  - anonymous visitors: `/` shows the sign-in form; `/account` and `/admin` show the sign-in form and, after signing in (mocked), the requested page; unknown paths (`/nope`) show the not-found page with a link home, for anonymous and signed-in visitors alike.
  - two-step states: a `verify` or `setup` session shows those screens on every path (including `/account`).
  - titles and language: `document.title` is `{page} · KMK Entretien Ménager` for `/`, `/account`, `/admin`, sign-in, and not-found; `<html lang>` follows the language; signing in applies the user's language and stores it in `kmk.lang`.
  - the pre-login picker is visible on the sign-in, forgot-password and set-password pages but not inside the shell; the shell shows the switcher instead.
  - the banner appears on Welcome and on Account when two-step is off, with the phase 4a behavior (permanent for admins, dismissible for users); the recovery-code notice appears on Welcome after a recovery-code sign-in.
  - the skip link targets `#main`.
  - adding an entry to `welcomeBlocks` renders its title and body (test with `vi.mock` of `welcomeContent`).
  - locale key parity for the new keys in all three files.
- [ ] **Step 2: Update the existing tests** per ruling (1) so they still assert the same behavior: tests that looked for the two-step section, change-password form or admin link on `/` now visit `/account` or click the nav link `navUsers`; do not delete or weaken assertions. Run them to see the expected failures before implementing.
- [ ] **Step 3: Run to watch them fail** — `cd frontend && npx vitest run` → FAIL.
- [ ] **Step 4: Implement** the files above in the KMK look (existing CSS tokens): a header that wraps on phones without scripting, the content in a white card up to about 960 px wide, visible focus states, dark mode checked (page background `--deep`, cards stay white), logo and nav readable on both backgrounds. Add a favicon `<link>` if missing and a sensible `<meta name="theme-color">` in `frontend/index.html`.
- [ ] **Step 5: Run tests and build** — `cd frontend && npx vitest run && npm run build && npm audit --omit=dev` → all pass, nothing new reported.
- [ ] **Step 6: Commit** `feat(frontend): app shell, welcome and account pages, not found, polish`.

---

### Task 4: Documentation

**Files:**
- Modify: `docs/README.md`, `docs/roadmap.md`, `docs/security.md` (a short note), `README.md`, `CLAUDE.md` (if layout notes change)

**Interfaces:**
- Consumes: the finished code and the running system.
- Produces: documentation that matches the system after phase 5.

- [ ] **Step 1: Gather facts:** the route list (`app.openapi()`), the frontend routes and files, test counts (`pytest -q`, `vitest run`), the locale keys count, the email link format.
- [ ] **Step 2: Update the documents:** `docs/README.md` (status table: phase 5 done and linked; the frontend pages list: `/`, `/account`, `/admin`, `/forgot-password`, `/set-password`, not found; the API table gains `POST /api/auth/locale`; a short description of the shell and where the welcome content lives, `frontend/src/welcomeContent.ts`, and how to add a block); `docs/roadmap.md` (phase 5 done; remaining open items: the real welcome content and the Portuguese review; next is phase 6); `docs/security.md` (the locale endpoint is guarded like any account change; the invitation link now carries `&lang=` after the token in the fragment and why that is safe; the `locale_changed` audit event); `README.md` (updated test counts); `CLAUDE.md` (the shell and routes in the layout section, one line).
- [ ] **Step 3: Verify the documents against the system:** every route, file path and count mentioned exists or matches; all links and anchors resolve; no secrets.
- [ ] **Step 4: Commit** `docs: phase 5`.

---

### Task 5: Deploy and verify live

**Files:** none new (rebuild only).

**Interfaces:**
- Consumes: everything above.
- Produces: the shell, welcome page and language switching live; a handoff for the user.

- [ ] **Step 1: Deploy:** `cd frontend && npm run build`; `cd deploy && docker compose up -d --build`. Expected: `kmk-api` starts, revision stays `0004`, no errors in `docker logs kmk-api`.
- [ ] **Step 2: Verify through Caddy** (do not touch real accounts):

```bash
H='Host: app.kmk-entretien.ca'; B=http://127.0.0.1:8081; O='Origin: https://app.kmk-entretien.ca'; J='Content-Type: application/json'
curl -s -H "$H" $B/api/health                                                         # {"status":"ok"}
curl -s -o /dev/null -w 'locale %{http_code}\n' -H "$H" -H "$O" -H "$J" -d '{"locale":"en"}' $B/api/auth/locale   # 401 (anonymous)
for p in / /account /admin /nope; do curl -s -o /dev/null -w "$p %{http_code}\n" -H "$H" $B$p; done              # 200 each (single-page app; not-found is rendered by the app)
curl -sI -H "$H" $B/ | grep -iE '^(server|x-content-type-options|content-security-policy)'                    # unchanged headers, no Server
docker exec postgres psql -U postgres -d kmk -Atc "select version_num from alembic_version"   # 0004
docker exec postgres psql -U postgres -d kmk -Atc "select username, role, locale from users"  # unchanged
docker exec kmk-api id -u                                                              # not 0
docker ps --format '{{.Names}}' | grep -E 'famillai|^postgres$'                        # all running
curl -s -o /dev/null -w 'public %{http_code}\n' https://app.kmk-entretien.ca/account  # 200
```

- [ ] **Step 3: Hand off to the user** (their browser; no passwords through the assistant): sign in and check the new top bar and Welcome page; switch the language and reload (it should stick, also on another device); open `/account` (two-step and change password are there); try the language picker on the sign-in page; invite a throwaway account in Portuguese (read the link with `docker logs kmk-api 2>&1 | grep -A8 'DEV EMAIL' | tail -12` if Resend is not set up) and open the link: the set-password page should be in Portuguese; look at a phone-width window and dark mode. Mention the two open items: the real welcome content and a Portuguese reviewer.
- [ ] **Step 4: Commit** only if tracked files changed (for example the docs); otherwise nothing to commit.
