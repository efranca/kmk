# Quotes widgets and Quotes empty state (design)

Approved by the owner on 2026-11-25. Small change: short design.

## Intent
Admins and super admins see the state of the quote requests on the Dashboard without opening the Quotes area, and the Quotes screen has a friendly empty state like Tasks.

## Goals
- **Quotes summary** card: Needs reply (New + Customer replied, same number as the nav badge), Waiting on customer (Replied), Overdue (New and past the 24 h deadline; red only when above 0). Each number opens the Quotes list on its tab. Won and Lost are not shown.
- **Latest requests** card: the 5 most recent (reference, name, city, status pill, "time ago", overdue tag). A row opens the quote; the card title opens Quotes.
- Two new Settings switches (`quotes_summary`, `quotes_latest`), default on, visible only to admins and super admins. The server validates dashboard preferences (`preferences.py`), so it learns both keys.
- The quote counts returned by the API gain `replied`.
- Empty states with a new illustration (`quotes`, an empty mailbox) and a light message: full size on the Quotes screen, compact in both cards; summary with nothing to answer shows an "Inbox zero" message. An empty filtered tab or an empty search keeps a plain message.
- All strings in en, fr-CA and pt-BR.

## Non-goals
Replying from the card, charts, Won/Lost counts, new endpoints.

## Approaches
One sensible way: two DashCards built like the My tasks card on the existing quotes hooks. A combined card or a chart does not fit the request (two widgets).

## Constraints
Regular users have no quotes access (the server refuses); the cards and switches must not render or fetch for them. Tests first.
