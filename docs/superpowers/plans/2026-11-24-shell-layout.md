# Shell, Layout and Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top bar with a collapsible, responsive sidebar that holds the account menu, use the full page width, halve page titles, and add a Settings page with three themes (KMK, Light, Dark).

**Architecture:** One `<nav class="appnav">` restyled by CSS per breakpoint (phone bar, tablet rail, desktop full/collapsed), as in FamillAI. Themes are `data-theme` on `<html>`, remembered per device in localStorage, switched from a new `/settings` page. Frontend only; no backend change.

**Tech Stack:** React, react-router, vitest + Testing Library, plain CSS, 3 locale JSON files.

**Spec:** `docs/superpowers/specs/2026-11-24-shell-layout-design.md` (themes were added to it afterwards, see Task 1; the settings page here only holds the theme choice, widget toggles come in round 3).

## Global Constraints

- Every new UI string goes into `en.json`, `fr-CA.json` and `pt-BR.json` (a test checks the key sets match).
- Sidebar widths: rail 72px (768px+), full 224px (1024px+, collapsible). Phone (<768px): bottom bar.
- localStorage keys: `kmk.sidebar.collapsed` ("1"/"0"), `kmk.theme` ("kmk" | "light" | "dark"). Storage may throw: always try/catch.
- Theme `kmk` is the current look, unchanged (it still follows the OS light/dark preference). `light` and `dark` force their palette regardless of the OS.
- Page title: half of the current `clamp(1.4rem, 4vw, 1.9rem)`, with a floor so phones stay readable: `clamp(0.85rem, 2vw, 0.95rem)` (my call on the floor, flagged in the hand-over).
- Run tests with `cd frontend && npx vitest run`; do not touch the backend.

## Review Focus

- Storage unavailable or holds garbage (`kmk.theme="purple"`): fall back to `kmk` / expanded, no crash.
- Account menu opens upward and stays inside the viewport at the bottom of rail, sidebar and phone bar.
- Sign-out, language change and Account link still work from the new location (existing Shell/App tests via `openAccountMenu`).
- Plain users (no Users nav item) still get the same nav; the Settings page is reachable by everyone.
- Anonymous visit to `/settings` goes to sign-in, not "not found".

---

### Task 1: Themes (tokens, hook, applied at startup)

**Files:**
- Create: `frontend/src/theme.ts`, `frontend/src/theme.test.ts`
- Modify: `frontend/src/index.css`, `frontend/src/ui/ui.css` (token blocks), `frontend/src/main.tsx`

**Interfaces:**
- Produces: `type Theme = "kmk" | "light" | "dark"`; `THEMES: Theme[]`; `getTheme(): Theme` (reads storage, invalid -> "kmk"); `applyTheme(theme: Theme): void` (sets `document.documentElement.dataset.theme`, stores it); `initTheme(): void` (applies the stored theme; called in `main.tsx` before render).

- [ ] **Step 1: Write failing tests** in `theme.test.ts`: `getTheme()` returns "kmk" with empty storage and with `kmk.theme="purple"`; `applyTheme("dark")` sets `document.documentElement.dataset.theme === "dark"` and `localStorage["kmk.theme"] === "dark"`; `initTheme()` after storing "light" sets the attribute; `getTheme()` returns "kmk" when `localStorage.getItem` throws.
- [ ] **Step 2: Run** `npx vitest run src/theme.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: Implement `theme.ts`** as specified above.
- [ ] **Step 4: Tokens.** In the two CSS files the dark values live in `@media (prefers-color-scheme: dark) { :root {...} }`. Restructure so: default `:root` = light values; the media block applies only to `:root:not([data-theme])`, `:root[data-theme="kmk"]`; add `:root[data-theme="light"]` (the light values; neutral white/gray surfaces, pine accent) and `:root[data-theme="dark"]` (neutral dark gray surfaces `--bg:#121416; --surface:#1c1f22; --surface-2:#262a2e; --text:#e8eaec; --text-muted:#a3a9ae`, accent `--spark`, same `--ev-*`/`--danger` dark values as the existing dark block). `kmk` keeps the existing green-tinted dark values. Because light/dark need `--bg`, `--accent`, `--accent-ink`, `--line`, `--surface*`, `--text*`, `--danger`, `--ev-*`, define each of these in all three themes' selectors (share via a selector list, do not copy-paste values twice).
- [ ] **Step 5: Call `initTheme()`** in `main.tsx` before `createRoot`. Also set `<meta name="theme-color">` is left unchanged.
- [ ] **Step 6: Run** `npx vitest run src/theme.test.ts` (PASS) and `npm run build`.
- [ ] **Step 7: Commit** `feat(theme): KMK, light and dark themes`.

### Task 2: Collapsible sidebar with the account menu inside

**Files:**
- Create: `frontend/src/app/useSidebarCollapsed.ts`, `frontend/src/app/Layout.test.tsx`
- Modify: `frontend/src/app/Layout.tsx`, `Nav.tsx`, `AccountMenu.tsx`, `layout.css`, `frontend/src/testUtils.tsx` (only if `openAccountMenu` needs it), `Shell.test.tsx`/`App.test.tsx` if they assert the top bar

**Interfaces:**
- Produces: `useSidebarCollapsed(): [boolean, () => void]` (key `kmk.sidebar.collapsed`, same shape as FamillAI's hook); `Nav` takes new props `collapsed: boolean`, `onToggle: () => void`, `footer: ReactNode` (rendered at the bottom of the nav, where the account menu goes).
- Consumes: existing `AccountMenu` props (unchanged), plus a Settings link: add `{ href: "/settings" }` item with `Icon name="settings"` and key `navSettings` between Account and the language row.

- [ ] **Step 1: Write failing tests** in `Layout.test.tsx` (render `Layout` inside `Providers`): no element with class `topbar`; `[data-account-menu]` is inside `nav.appnav`; clicking the toggle button (`aria-label` from `sidebarCollapse`/`sidebarExpand`) adds class `app--collapsed` to `.app` and stores `kmk.sidebar.collapsed="1"`; a stored "1" starts collapsed; collapsed links keep an accessible name (`title` = label); account menu opens and offers Account, Settings and Sign out; Settings click calls `onNavigate("/settings")`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `Layout`: drop `<header class="topbar">`, add `app--collapsed` class from the hook, pass the toggle and `<AccountMenu/>` as `footer` to `Nav`. `Nav`: brand at top, toggle button (icon `chev-left`/`chev-right`, hidden below 1024px via CSS) beside it, items, then `footer` pushed to the bottom (`margin-top: auto`). Add `title={label}` on links.
- [ ] **Step 4: CSS in `layout.css`** following FamillAI's `styles/app.css` (lines ~30-95, `.shell`/`.nav`/`.side`): phone = fixed bottom bar with the account button as the last item (name hidden); 768-1023px = 72px rail, labels visually hidden; 1024px+ = 224px sidebar, `.app--collapsed` returns to the 72px rail; `.accountmenu__panel` opens upward (`bottom: calc(100% + 8px)`, `left: 0`; on the phone bar `right: 0`). Remove `.topbar*` rules. Add the visible name next to the avatar in the expanded sidebar.
- [ ] **Step 5: Locale keys** `navSettings`, `sidebarCollapse`, `sidebarExpand` in all three files (fr-CA: "Paramètres", "Réduire le menu", "Agrandir le menu"; pt-BR: "Configurações", "Recolher menu", "Expandir menu"; en: "Settings", "Collapse menu", "Expand menu").
- [ ] **Step 6: Run** the full suite; fix existing tests that referenced the top bar.
- [ ] **Step 7: Commit** `feat(shell): collapsible sidebar with the account menu`.

### Task 3: Full-width pages and smaller titles

**Files:** Modify `frontend/src/app/layout.css`, `frontend/src/schedule/schedule.css`, `frontend/src/index.css` (the global `h1` used by card pages).

- [ ] **Step 1:** Remove `max-width: 960px` from `.app__main > .card.page` and `max-width: 1400px; margin: 0 auto` from `.app__main` (keep padding; content fills the width beside the sidebar).
- [ ] **Step 2:** `.page__header h1` font-size becomes `clamp(0.85rem, 2vw, 0.95rem)`; do the same for `h1` inside `.app` pages (scope with `.app h1` so sign-in card titles are untouched).
- [ ] **Step 3: Verify visually** with `npm run build` then the dev server or the run skill at 1440px, 900px and 390px widths: no horizontal gaps beside content, title is about half size. State what you saw.
- [ ] **Step 4: Commit** `style(shell): use the full width, smaller page titles`.

### Task 4: Settings page with theme choice

**Files:**
- Create: `frontend/src/SettingsPage.tsx`, `frontend/src/Settings.test.tsx`
- Modify: `frontend/src/App.tsx` (add `"settings"` to `Page`, `TITLE_KEYS`, `pageFor` (also in the anonymous allow-list), `shellPage`, render), `frontend/src/Shell.tsx` (`ShellPage` + `PAGE_TO_LAYOUT`: settings -> `"other"`), locale files

**Interfaces:**
- Consumes: `THEMES`, `getTheme`, `applyTheme` from Task 1; `PageHeader` and `Segmented`/`ChoiceChips` from `ui/`.
- Produces: route `/settings` rendering `SettingsPage` (no props; a "Theme" section with three options KMK / Light / Dark, the current one pressed/checked).

- [ ] **Step 1: Failing tests** in `Settings.test.tsx`: renders the three options; the stored theme is the selected one; choosing "Dark" sets `document.documentElement.dataset.theme="dark"` and storage; a route test in `App.test.tsx`-style: signed-in visit to `/settings` shows the page title, anonymous visit shows sign-in.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `SettingsPage` and wire the route/title as above. Page is bare (draws its own surface) like Tasks.
- [ ] **Step 4: Locale keys** `settingsTitle`, `settingsTheme`, `themeKmk` ("KMK"), `themeLight`, `themeDark` in three languages (fr-CA: "Paramètres", "Thème", "Clair", "Sombre"; pt-BR: "Configurações", "Tema", "Claro", "Escuro").
- [ ] **Step 5: Run** full suite + `npm run build` (both PASS).
- [ ] **Step 6: Commit** `feat(settings): settings page with theme choice`.

### Task 5: Docs

**Files:** Modify `docs/README.md` (status), and the roadmap/operations doc that lists frontend pages if one exists (`grep -rn "Dashboard" docs/*.md`).

- [ ] **Step 1:** Document: sidebar behavior and breakpoints, the two localStorage keys, the three themes, the `/settings` page (theme only for now). Remove mention of a top bar if present.
- [ ] **Step 2: Commit** `docs: shell, themes and settings`.
