# Phase 5 (Frontend): app shell, welcome page, language switching, polish

Builds on `scope.md` (§1 scope, §7 internationalization, §14 open items), `docs/roadmap.md`, and the phase 2-4b frontends. Where this differs from `scope.md`, this document wins.

## Intent
Make the app feel like one coherent place for the team. After signing in, people land on a **welcome page** (a placeholder for now: the owner will add real company content later) inside a small **app shell** with navigation,
and everyone can **choose their language**, which is remembered per person and used for their emails. People who are not signed in yet (login, forgot password, an invitation link) can pick a language too,
so an invited Portuguese speaker no longer lands on a French page.

## Goals
- An app shell for signed-in pages: logo, navigation (Welcome, Account, Users for admins and the super admin), a language switcher, and sign out.
- Pages: `/` Welcome (signed in) or the sign-in form (not signed in); `/account` (what is today's signed-in page: two-step verification, change password, recovery-code notice, the encouragement banner); `/admin` (existing, now inside the shell); a friendly "page not found" for any other path.
- The welcome page: a static page in three languages whose content is easy to extend later (typed list of content blocks, empty for now) with placeholder text.
- Language switcher for signed-in users, stored on the server (`users.locale`), so it follows the person across devices and sets the language of future emails.
- Pre-login language picker (French, English, Portuguese) remembered in the browser; invitation and reset links carry the recipient's language so the set-password page opens in it.
- Polish: consistent spacing and typography, a proper page title per page, `lang` on the document, active-link marking, keyboard focus, responsive layout on phones, dark mode checked; small email polish (link language, a brand footer line).
- Documentation updated.

## Non-goals
Editable welcome page or any content management, the real company content (to come later from the owner), profile editing (username, email), a dark-mode toggle (it follows the system), a hamburger menu or other navigation scripting,
translating server messages (the frontend already maps error codes to its own strings), notifications, search.

## Anti-goals
The language stored only in the browser (it must be per user on the server); the language parameter turning an emailed link into something that leaks the token or changes what the link does; the page flashing the wrong language
on load; a Portuguese-speaking user stuck with French pages; navigation entries shown to people who cannot use them.

## Constraints
- Phase 2-4b conventions: every protected route behind `guard`, Origin + CSRF on mutating requests, strings in all three locale files (a test checks key parity), no external assets (the CSP is unchanged), tests first.
- The Portuguese text is new (the public site has none) and should be reviewed by someone who reads Portuguese; this is recorded as an open item, not a blocker.
- The welcome placeholder wording is a stand-in (see below); the owner's real content replaces it later.

## Approaches considered (my calls unless noted)
- **Language storage:** browser only vs on the server per user. **Pick: the server** (`scope.md` says the language is per user, and emails need it); the browser keeps only the pre-login preference.
- **Navigation:** a top bar vs a sidebar vs one long page. **Pick: a top bar** (three or four entries, works on phones by wrapping, no scripting). **User accepted my recommendation.**
- **Routing:** adopt a router library vs extend the existing small path router. **Pick: extend the hand-rolled router** (five routes).
- **Welcome content:** build rich content now vs a structured placeholder. **User: nothing important for now, to be built up later. Pick: a placeholder whose content blocks live in one typed list, so adding content is adding entries and strings.**
- **Language in emailed links:** a query string vs the URL fragment vs nothing. **Pick: the fragment** (`#token=...&lang=pt-BR`): it never reaches the server or logs and the language is not secret. The set-password page also applies it for that visit.

## Decisions
**Backend (small):**
- `POST /api/auth/locale` `{locale: "fr-CA"|"en"|"pt-BR"}`: for the signed-in user, fully verified session, CSRF and Origin required; updates `users.locale` and `updated_at`; returns `200 {"user": {...}}`; invalid value `422`; audit `locale_changed` with `{"from", "to"}` (not sensitive). Allowed in the normal `ok` state only.
- Invite and reset emails: the link gains `&lang=<the recipient's locale>` after the token (`.../set-password#token=...&lang=pt-BR`). Nothing else in the message changes except a one-line brand footer ("KMK Entretien Ménager, Québec") in the text and HTML versions.
- No schema change.

**Frontend:**
- Shell and routes: `Shell` wraps every signed-in page. Navigation entries: Welcome `/`, Account `/account`, Users `/admin` (only for `admin` and `superadmin`); the active entry is marked (`aria-current="page"`). Sign-in, forgot-password and set-password keep the centered card.
- Welcome page: greeting with the user's name, the placeholder text below, then the list of content blocks (empty). Placeholder wording (FR-CA / EN / PT-BR): "Bienvenue chez KMK Entretien Ménager. Cet espace est réservé à l'équipe. Les informations de l'entreprise (contacts, procédures, ressources) y seront ajoutées bientôt." / "Welcome to KMK Entretien Ménager. This space is for the team. Company information (contacts, procedures, resources) will be added here soon." / "Bem-vindo à KMK Entretien Ménager. Este espaço é para a equipe. As informações da empresa (contatos, procedimentos, recursos) serão adicionadas aqui em breve."
- The encouragement banner (two-step verification) shows on Welcome and Account.
- Language: signed-in switcher (a select in the header) calls `/api/auth/locale`, then switches the interface; on failure it keeps the old language and shows an error. Before sign-in a small picker (FR, EN, PT) sets the language and saves it in `localStorage` (`kmk.lang`, every access in try/catch); the app starts in that language (default French). On sign-in the user's stored language wins and is saved to `kmk.lang`, so the next visit to the login page is already in their language.
- The set-password page applies `lang` from the link's fragment (when it is one of the three) for that visit, and removes the whole fragment from the address bar as today.
- Unknown paths show a friendly not-found page with a link home (signed in or not).
- Document title per page ("KMK Entretien Ménager" plus the page name) and `<html lang>` follow the language.

## Documentation deliverable
Update `docs/README.md` (pages and routes, the new endpoint, status), `docs/roadmap.md` (phase 5 done; the real welcome content and the Portuguese review remain open items), `docs/operations.md` only if anything operational changes, and the counts in `README.md`. Verify every statement against the running system.

## Verification the plan must cover
- Backend: the locale endpoint updates only the caller's language, rejects invalid values, is blocked for an unverified two-step session (the existing route test covers it automatically), writes the audit row, and the next reset email is in the new language; invite and reset links end with `&lang=<locale>` and still start with `#token=`.
- Frontend: shell navigation by role (Users only for admins, active entry marked); Welcome, Account and not-found pages; the language switcher updates the server and the UI and reverts with a message on failure; the pre-login picker persists and is used on the next render, and signing in applies the user's language; the set-password page honors `lang` and still removes the fragment; the encouragement banner on Welcome and Account; document title and `lang`; admin page inside the shell; locale key parity for every new string.
- Live: the new endpoint answers 401 anonymously; `/account` and `/admin` deep links load; no change to security headers.

## Left to the builder
Visual details of the shell (spacing, how the header wraps on phones), the content-block type for the welcome page, final wording within the points above, how the pre-login picker looks.
