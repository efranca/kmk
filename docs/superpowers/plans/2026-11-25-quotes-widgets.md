# Quotes widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two Dashboard cards for admins (Quotes summary, Latest requests) with Settings switches, plus a fun empty state on the Quotes screen.

**Architecture:** Both cards read one cached query, `useQuotes("all")` (newest first, with `counts`). Counts gain `replied` on the server. Preferences gain two widget keys validated by the server. A fourth illustration (`quotes`) joins `EmptyArt`.

**Tech Stack:** FastAPI/pytest (backend), React/TanStack Query/react-i18next/vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-11-25-quotes-widgets-design.md`

## Global Constraints

- Every new string goes into `frontend/src/locales/{en,fr-CA,pt-BR}.json` (flat keys, same key set; a test checks it).
- Tests first; watch each fail. Never run backend DB tests concurrently (shared `kmk_test`).
- Regular users (`role === "user"`) never see, fetch or switch the quote cards (the API refuses them).
- `.empty-art` CSS rules stay `> svg` scoped (see `emptyArtCss.test.ts`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Admin with zero quotes: both cards show the friendly empty state, no zeros row, no crash.
- Regular user: no `/api/quotes` request is made from the Dashboard and no quote switches appear in Settings.
- All three widgets hidden for a regular user (quote prefs true): the "all hidden" notice still follows only the widgets that user can see.
- Old stored preferences without the new keys: defaults merge in as true (backend `_merge`).
- `/quotes?tab=bogus`: falls back to the New tab.

---

### Task 1: Backend, `replied` count and the two preference keys

**Files:**
- Modify: `backend/app/quotes/service.py:51-54`, `backend/app/preferences.py:23-32`
- Test: `backend/tests/test_quotes_api.py` (lines 61, 122 assert `counts`), `backend/tests/test_preferences_api.py` (find the existing dashboard_widgets test with `grep -n my_tasks backend/tests/*.py`)

**Interfaces:**
- Produces: `GET /api/quotes` `counts` = `{"new": int, "customer_replied": int, "replied": int}`; preferences `dashboard_widgets` = `{my_events, all_events, my_tasks, quotes_summary, quotes_latest}` all bool, default True, patchable individually.

- [ ] **Step 1: Failing tests.** Update the two `counts ==` assertions to include `"replied": 0`; add `test_counts_include_replied` (send a reply to a New quote, then `counts["replied"] == 1`, `counts["new"] == 0`). In the preferences test file add: default prefs contain `quotes_summary` and `quotes_latest` True; `PATCH {"dashboard_widgets": {"quotes_latest": False}}` stores False and keeps the others; an unknown widget key is still refused (422).
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest -q tests/test_quotes_api.py tests/test_preferences_api.py` → the new/changed tests FAIL.
- [ ] **Step 3: Implement.** In `service.py` count statuses `("new","customer_replied","replied")` and return all three keys. In `preferences.py` add the two keys to the default dict (True) and to `WidgetsIn` (`bool | None = None`).
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(quotes): replied count and quote widget preferences`.

### Task 2: Frontend preferences and Settings switches

**Files:**
- Modify: `frontend/src/preferences.tsx:16,30`, `frontend/src/SettingsPage.tsx:15-19,54`, three locale files
- Test: `frontend/src/Settings.test.tsx`, `frontend/src/preferences.test.tsx`

**Interfaces:**
- Produces: `Preferences["dashboard_widgets"]` gains `quotes_summary: boolean; quotes_latest: boolean`, both true in `DEFAULT_PREFERENCES`. Locale keys `settingsWidgetQuotesSummary` ("Quotes summary"), `settingsWidgetQuotesLatest` ("Latest quotes").

- [ ] **Step 1: Failing tests.** In `Settings.test.tsx`: an admin sees switches "Quotes summary" and "Latest quotes" and toggling one sends `PATCH /api/me/preferences` with `{dashboard_widgets: {quotes_latest: false}}` (mirror the existing widget-switch test); a `testUser` with role `user` does not see them. Update `preferences.test.tsx` defaults expectation.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/Settings.test.tsx src/preferences.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Extend the type and defaults; add the two entries to `WIDGETS` with an `adminOnly: true` flag on them and filter the list by `user.role !== "user"` when rendering (get `user` from `useSession()`); add the locale strings (fr-CA "Résumé des soumissions", "Dernières soumissions"; pt-BR "Resumo dos orçamentos", "Últimos orçamentos").
- [ ] **Step 4: Run** the same command plus `npx vitest run src/locales` → PASS.
- [ ] **Step 5: Commit** `feat(settings): switches for the quote widgets`.

### Task 3: Quotes illustration, Quotes screen empty state, `?tab=`

**Files:**
- Modify: `frontend/src/ui/EmptyArt.tsx:3` and the `Art` function (add the `quotes` drawing, 160x120 viewBox, same `ea-*` classes and style as the others: an open mailbox with a floating envelope), `frontend/src/quotes/QuotesPage.tsx`, `frontend/src/quotes/types.ts:48`, locales
- Test: `frontend/src/ui/EmptyArt.test.tsx:21`, `frontend/src/quotes/QuotesPage.test.tsx` (find with `ls frontend/src/quotes`)

**Interfaces:**
- Produces: `ArtName` includes `"quotes"`; `QuoteCounts = { new: number; customer_replied: number; replied: number }`; locale keys `quoteEmptyTitle` ("No quote requests yet."), `quoteEmptyFun` ("The mailbox is quiet. Enjoy the calm!"), keeping `quoteEmpty` ("No quotes here yet.") for a non-"new" empty tab and `quoteNoResults` for search.

- [ ] **Step 1: Failing tests.** `EmptyArt.test.tsx`: add `"quotes"` to the art list loop. `QuotesPage.test.tsx`: with an empty list on the default tab, `findByText("No quote requests yet.")` and the fun line, and an `svg[data-art='quotes']`; with an empty "Replied" tab (click it) the plain `quoteEmpty` text shows without a picture; a search with no match shows `quoteNoResults`; mounting at `/quotes?tab=replied` selects the Replied tab, `?tab=bogus` selects New (render with `initialEntries`, as other route tests do).
- [ ] **Step 2: Run** `npx vitest run src/ui/EmptyArt.test.tsx src/quotes/QuotesPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Add the drawing and type. In `QuotesPage`, read `search` from `useRoute()`, initial tab = `?tab=` value if it is in `TABS`, else `"new"`. Empty and not searching and tab `"new"` (or `"all"`) → `<EmptyArt art="quotes" title={t("quoteEmptyTitle")} hint={t("quoteEmptyFun")} />`; other empty cases keep `EmptyState`. Locales in all three languages (fr-CA "Aucune demande de soumission pour l'instant." / "La boîte aux lettres est calme. Profitez-en!"; pt-BR "Nenhum pedido de orçamento ainda." / "A caixa de correio está quieta. Aproveite a calma!").
- [ ] **Step 4: Run** the same command, plus `npx vitest run src/ui` → PASS.
- [ ] **Step 5: Commit** `feat(quotes): a friendly empty Quotes screen, tab from the address`.

### Task 4: The two Dashboard cards

**Files:**
- Create: `frontend/src/dashboard/QuotesSummaryCard.tsx`, `frontend/src/dashboard/QuotesLatestCard.tsx`
- Modify: `frontend/src/dashboard/DashboardPage.tsx`, `frontend/src/dashboard/dashboard.css`, three locale files
- Test: `frontend/src/dashboard/QuotesCards.test.tsx`, `frontend/src/dashboard/DashboardWidgets.test.tsx`

**Interfaces:**
- Consumes: `useQuotes("all")` (`{quotes: QuoteSummary[], counts}`), `DashCard` props (`title`, `href`, `onOpen`, `state`, `empty`, `emptyText`, `art`, `emptyHint`), `STATUS_KEYS`, `KIND_KEYS` from `quotes/labels`.
- Produces: `QuotesSummaryCard({ onOpenQuotes: (tab?: QuoteFilter) => void })` and `QuotesLatestCard({ onOpenQuote: (id: number) => void; onOpenQuotes: () => void; locale: string })`. Locale keys: `dashQuotesSummary` ("Quotes"), `dashQuotesNeedReply` ("Needs reply"), `dashQuotesWaiting` ("Waiting on customer"), `dashQuotesOverdue` ("Overdue"), `dashQuotesInboxZero` ("Inbox zero!"), `dashQuotesInboxZeroFun` ("Nobody is waiting on you. Go grab a coffee."), `dashQuotesLatest` ("Latest quotes"), `dashQuotesLatestEmpty` ("No quote requests yet."), `dashQuotesLatestFun` ("The next customer is on the way."); fr-CA and pt-BR equivalents.

- [ ] **Step 1: Failing tests** in `QuotesCards.test.tsx` (mock `GET /api/quotes` via `mockApi`, render with `renderWithProviders`): summary shows 3 numbers from `counts` (needs reply = `new + customer_replied`; waiting = `replied`; overdue = number of rows with `overdue`), overdue number has class `dash__stat--late` only when > 0, clicking "Needs reply" calls `onOpenQuotes("new")`, "Waiting on customer" → `"replied"`, "Overdue" → `"new"`; with `new+customer_replied === 0` and `replied === 0` it shows "Inbox zero!" and the `quotes` svg; latest card lists at most 5 rows (send 7) in API order with reference, name, city, status pill label and the "overdue" tag (reuse key `quoteOverdue`), clicking a row calls `onOpenQuote(id)`, and an empty list shows `dashQuotesLatestEmpty` with the `quotes` svg. In `DashboardWidgets.test.tsx`: admin sees regions "Quotes" and "Latest quotes" by default and hiding via prefs removes them; a user-role dashboard renders neither and makes no `/api/quotes` request (assert the mock handler was not called); the all-hidden notice appears for a user with the three classic widgets off even though quote prefs are true.
- [ ] **Step 2: Run** `npx vitest run src/dashboard` → FAIL.
- [ ] **Step 3: Implement** both cards on `DashCard` (`href="/quotes"`); the summary's three stats are `<button type="button" className="dash__stat">` with the number and label; the latest rows are `<a>` links with `onClick` preventDefault. In `DashboardPage`: `const isAdmin = user.role !== "user"`, `showSummary = isAdmin && widgets.quotes_summary`, `showLatest = isAdmin && widgets.quotes_latest`; open callbacks `navigate("/quotes?tab=" + tab)`, `navigate("/quotes/" + id)`, `navigate("/quotes")`; the all-hidden condition includes `!showSummary && !showLatest`. Style `.dash__stat` (big number, muted label, touch target ≥ 44px, `--late` uses `var(--danger)`) in `dashboard.css`, following the file's variables.
- [ ] **Step 4: Run** `npx vitest run src/dashboard src/locales` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): quotes summary and latest requests cards`.

### Task 5: Docs and full verification

**Files:**
- Modify: `docs/README.md` (dashboard widgets line), `docs/roadmap.md` (status), `CLAUDE.md` layout (`dashboard/` now lists five widgets)

- [ ] **Step 1:** Update the three docs lines to mention the Quotes summary and Latest quotes widgets (admins only).
- [ ] **Step 2: Run** `cd frontend && npx vitest run && npx tsc --noEmit -p . && npm run build` → all pass, and `cd backend && .venv/bin/pytest -q tests/test_quotes_api.py tests/test_preferences_api.py` → pass.
- [ ] **Step 3: Commit** `docs: quotes widgets`.
