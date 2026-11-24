# Shell and layout (round 1)

> Update: the sidebar state and theme became per-account preferences (see 2026-11-24-users-avatars-widgets-design.md). `localStorage` only mirrors the theme for the first paint.

## Intent
The signed-in frame wastes space (top bar, narrow centred columns) and the sidebar cannot be collapsed. Model it on FamillAI (`~/projects/famillai/ui/src`: `app/Nav.tsx`, `hooks/useSidebarCollapsed.ts`, `styles/app.css`, `components/UserMenu.tsx`).

## Goals
- No top bar. The account menu (avatar, name, Account, language, Sign out) moves to the bottom of the sidebar; its panel opens upward.
- Sidebar: phone = bottom tab bar (as today, account avatar as the last item); 768-1023px = icon rail (72px); 1024px+ = full side nav (224px) with a toggle that collapses it to the rail. The choice is stored per device in localStorage (`side.collapsed`).
- Content uses the full width beside the sidebar: remove the 960px cap on `.card.page` and the 1400px cap on `.app__main`.
- Page titles (`.page__header h1`, used by Tasks, Schedule, Users, etc.) shrink to about half: `clamp(0.7rem, 2vw, 0.95rem)` on top of the current clamp, i.e. roughly 0.7 to 0.95rem.

## Non-goals
Tasks, Users, avatars, Settings, email: later rounds. No change to routes or auth.

## Approaches
1. Copy FamillAI's pattern (one `<nav>` restyled by CSS per breakpoint, collapse state hook). Recommended: it is what was asked for and is proven.
2. A JS-driven drawer. Rejected: more code, worse on phones.

## Calls made by me
- Collapse toggle only at 1024px+, as in FamillAI.
- Half-size h1 is measured against the current clamp(1.4rem, 4vw, 1.9rem).
- Logo stays at the top of the sidebar (collapsed: a compact version or the image cropped to its mark if one exists, otherwise hidden).

## Tests
Layout/Nav tests updated: no `.topbar`; account menu inside the nav area; toggle persists to localStorage; existing Shell tests keep passing.
