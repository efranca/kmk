# Quote requests (design)

Date: 2026-11-25. Status: approved by the owner. Nothing is built yet. Decisions marked "my
call" or "builder-check call" were made while writing, not by the owner.

## Intent and why

**Asked for:** a public quote request form (devis / quote / orçamento), open to anyone with no sign-in, hosted by this
app but looking like the public site (kmk-public). Each request lands in a new internal **Quotes** area, visible only to
admins and the super admin. From there they reply to the customer by email and keep the whole conversation in one
place, so they can quickly find what the customer asked for and what was said.

**Why:** the public site promises a written quote within 24 hours ("Réponse en moins de 24 h", on `/fr/contact/`). Today
the contact form goes through web3forms into an inbox, with nothing to make sure someone picks it up or to show what was
already said. Each new request therefore creates a task (due in 24 hours) and an Agenda item for every admin, and sends
an email and a push notification.

## Goals

### Public form (`https://app.kmk-entretien.ca/devis`)

- **Looks like kmk-public**: the same tokens (colours `--pine`, `--deep`, `--mist`, `--paper`, etc.), the same Inter and
  Montserrat fonts, radii, shadows, buttons and form fields (`.form`, `.field`, `.f2`, `.btn-primary`), plus a simple
  header (logo linking to `https://kmk-entretien.ca/fr/`) and footer in the public site's style. It uses nothing from
  the internal app's design system.
- **Languages:** fr-CA (default) and en-CA, with a switcher (Portuguese was removed from the form and from the sign-in page at the owner's request; people still get Portuguese inside the app). `?lang=fr` / `?lang=en` preselect a language so the
  public site's English page can link straight to the English form.
- **Fields:**
  - Contact (all required): name (1-100), email (valid address), phone (7-30 characters, digits, spaces, `+ ( ) - .`).
  - Type (required): **Airbnb** or **Commercial**.
  - Both types: **city** (required, 1-60 characters: the only place name that tasks, Agenda items, the notice and the push ever show, because everyone can read those) and **address or neighbourhood** (required, up to 200 characters, read only by admins on the quote). Airbnb: kind (house / apartment / condo / other), bedrooms (0-20),
    bathrooms (0-20, halves allowed), approximate area in ft² (optional), frequency (once / per booking / weekly /
    every two weeks / monthly / not sure).
  - Commercial: kind of space (office / clinic / shop / restaurant / industrial / other), approximate
    area in ft² (optional), frequency (same list without "per booking", plus "after construction / one-time big clean").
  - Free text (both types): "Tell us about your place". Optional for Airbnb, required for Commercial ("all the
    information"), at most **2000 words** and at most 20 000 characters. A live word counter shows "N / 2000 words".
  - Photos (both types, optional): up to **10**, each at most **8 MB**, JPEG, PNG, WebP or HEIC, checked by their bytes
    (as Documents does). Shown as thumbnails with a remove button before sending.
  - A hidden honeypot field (as on the public site's form): if filled, the API answers success and stores nothing.
- **Sending:** one request with the fields, then one upload per photo, then a "finish" call (see API). The form shows
  progress, then a thank-you screen: "We received your request. We reply within 24 hours." with the reference number
  (e.g. `D-0042`).
- **Rate limit: 10 requests per hour per IP** (IPv6 counted per /64, as `ratelimit.ip_key` does). Over the limit the
  form shows a polite message: "You've sent several requests in a short time. Please try again later, or call us at
  …" with the phone number. Every **started** request (draft) counts, not only finished ones, so nobody can fill the
  database with photos without ever pressing Send (builder-check call). There is no global limit (owner's decision).
  Serialized with `ratelimit.serialize`, as every counting endpoint is.
- **Unfinished drafts** expire after 2 hours (the submission token's life) and are deleted, photos included, when the
  next request starts. Photo uploads are also refused (`503 {"error":"busy"}`) while unfinished drafts hold more than
  300 MB of photos in total (my call).
- **IP and context recorded** with the request: the client IP (from `X-Real-Client-Ip`, set by Caddy), the country and
  city headers Caddy already passes, the user agent, and the language used.

### Internal Quotes area (`/quotes`, admins and super admin only)

- **Navigation:** "Quotes" entry (with a count of new ones) shown only to admins and the super admin. Regular users
  see no entry, and the API refuses them (403).
- **List:** newest first, with status tabs: **New**, **Replied** (waiting for the customer), **Customer replied**
  (our turn), **Won**, **Lost**, **All**. Each row shows the reference, customer name, type (Airbnb / Commercial), city
  or address, when it arrived, the deadline (red when overdue, shown only while the status is New) and the number of
  messages. The navigation count is New plus Customer replied.
- **Status rules (owner's decision):**
  - Sending the **first** reply moves New to Replied, completes the 24-hour task (if still open; completed by the
    sender) and deletes the Agenda item, because the deadline is met.
  - Sending a later reply moves Customer replied to Replied.
  - Pasting a customer reply moves Replied (or New) to Customer replied. No new deadline, task or Agenda item.
  - Won and Lost are only set by hand, from any status. Messages can still be sent and pasted on a Won or Lost quote;
    they do not change its status.
  - An admin can also set any status by hand. Search by name, email, phone, address and reference,
  ignoring case and accents.
- **Detail page:**
  - The **request** as sent, read-only: contact details (email and phone as links), type and every field, the free
    text, the photos (thumbnails that open in full size), IP, approximate place, language, time received.
  - Status (change with a menu) and an internal note field (only the team sees it).
  - The **conversation**, oldest first. Two kinds of message:
    - **Sent:** written in the app and emailed to the customer (see Email). Stored with the text, who sent it, when,
      and whether the email provider accepted it. A failed send is shown as failed, with "Try again".
    - **Received (pasted):** the customer's reply, pasted by an admin from the Gmail inbox. Stored with the text, the
      date the customer sent it (entered by the admin, defaults to now), and who pasted it.
  - A reply box: subject (prefilled `Re: Your cleaning quote D-0042`, translated into the customer's language),
    body, Send. A second button, "Add customer reply", opens the paste box.
  - Links to the task and the Agenda item that were created for the request.
- **Delete:** the super admin can delete a request (with confirmation). It removes the photos and messages too. The
  task and Agenda item stay (they hold no customer data, see below).

### When a request arrives

All in the same database transaction as the request, except email and push, which go out after the commit and never
fail the request.

Every signed-in user can see every task and event today, so **the task and the Agenda item carry no customer data**
(owner's decision): only the reference, the type and the city. Regular users can see that a quote exists, but the link
gives them a 403.

1. **One shared task** (builder-check call: one task with several people; when one admin completes it, it is done for
   all) "Quote D-0042 · Airbnb · Québec" for **every active admin and the super admin** at that moment, due on the
   company-time-zone date of (now + 24 h). Category "Quotes" (a new starter category added by the migration, with icon
   📋). The description has a link to the quote. It is created by the website (see Constraints).
2. **Agenda item** at (now + 24 h), 30 minutes long, title "Quote deadline D-0042 · Airbnb · Québec", for the same
   people, with one reminder 2 hours before. Its notes link to the quote.
3. **Email** to the notification address from Settings (if one is set): subject "New quote request D-0042", body
   with the type, name, city and a link to the quote. No free text or photos in the email.
4. **Push** to every admin who turned notifications on: title "New quote request", body "D-0042 · Airbnb ·
   Québec", and tapping it opens the quote. No email, phone or free text in the push.

### System settings (new section in Settings, super admin only)

A small set of company-wide settings, stored in the database and edited in the app (no restart):

| Setting | Example | Used for |
| --- | --- | --- |
| Quote notification email | `no-reply@…` / the Gmail | where "new quote" emails go (empty = no email) |
| Quote sender (From) | `KMK Entretien <devis@mail.kmk-entretien.com>` | From of the emails sent to customers |
| Quote Reply-To | `kmk.entretien@gmail.com` | Reply-To of those emails, so customer answers reach a real inbox |
| Public phone number | `(418) …` | shown on the form's "too many requests" message and footer |

The sender's domain must be verified in Resend (an owner step). Sending is refused with a clear message until the
sender is set.

### Push notifications (Web Push)

- Standard Web Push with VAPID keys (`pywebpush` on the API, a small service worker `sw.js` on the frontend).
- Settings > Notifications: "Turn on notifications on this device" / "Turn off", visible to admins and the super admin.
  Each device has its own subscription. A test button sends "Notifications are working".
- Subscriptions the push service reports as gone (HTTP 404/410) are deleted.
- iPhone: works only when the app is added to the Home Screen (iOS 16.4+); the Settings card says so. So **the
  internal app becomes installable** (owner's decision): a web app manifest (`manifest.webmanifest`: name "KMK", start
  URL `/`, `display: standalone`, theme colour from the internal design system) and icons (192, 512, maskable, Apple
  touch icon), linked from `index.html`. The public form page does not link the manifest.
- The VAPID private key is a secret in `deploy/.env` (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`),
  added to `api.environment` in the compose file. The owner generates it with a CLI command (`python -m app.cli
  vapid-keys`) that prints the keys once.

## Non-goals

- **No inbound email.** Customer replies are pasted by hand; no webhook, no mailbox reading.
- **No automatic email to the customer** on submission (an open form that emails any address anyone types becomes a
  spam relay). The thank-you screen shows the reference instead.
- No prices, line items, PDF quotes or e-signature. The quote itself is written in the reply email.
- No captcha service (keeps third parties out; honeypot and IP limit first, revisit if spam appears).
- No changes to the kmk-public repository in this work. The owner (or a later task in that repo) replaces the
  web3forms form on `/fr/contact/` and `/en/contact/` with a button linking to the new form.
- No attachments in replies sent from the app.
- Post-construction is not a third type: it is covered by Commercial's frequency choice.

## Anti-goals

- A customer's data or photos visible to anyone but admins and the super admin.
- A broken form for the customer because the email or push failed: the request is saved first, notifications are
  best effort.
- The public page loading the internal app's code (login, session, admin screens) or any third-party script or font
  host.

## Constraints

- **The form is public**, so the routes under `/api/public/quotes` are added to the public-route list of
  `tests/test_mfa_guard.py`; every internal quote route uses `guard()` plus an admin-or-super-admin check through
  `policy.py`.
- **Origin check:** the public POSTs come from the same origin (`app.kmk-entretien.ca`), so the existing
  `origin_check` middleware still applies. They carry no session and no CSRF token; instead each public request gets a
  random **submission token** returned by the first call, which the photo uploads and "finish" must present (stored
  hashed, valid 1 hour, only for that request).
- **Caddy:** serves `quote.html` at `/devis` (and `/devis/`). Request body limits: the first public call gets its own
  matcher with a 256 KB cap (20 000 characters with accents or emoji can exceed 64 KB); photos get their own matcher
  with a 9 MiB cap (my call; `@docfile` allows 51 MiB, too much here). `/sw.js` and `/manifest.webmanifest` are
  served as files, never the `index.html` fallback.
- **Public config:** `GET /api/public/quotes/config` returns the public phone number (and nothing else), so the form
  can show it (builder-check call).
- **Upload safety:** reuse `documents/uploads.py` (capped read, upload slots) and `documents/files.py` (type by
  bytes). Images are stored as received (no re-encoding), served to admins with `Content-Disposition: inline`, the
  sniffed content type and `X-Content-Type-Options: nosniff`. HEIC is shown as a download link (browsers cannot display
  it).
- **CSP:** the current policy (`script-src 'self'`, `font-src 'self'`, `connect-src 'self'`) stays. The fonts are
  self-hosted woff2 files (Inter and Montserrat are under the OFL), not Google Fonts. The service worker is served from
  `/sw.js` by Caddy; push needs no CSP change.
- **Audit:** `quote_received` (IP, quote id, no personal data), `quote_reply_sent`, `quote_reply_pasted`,
  `quote_status_changed`, `quote_deleted`, `settings_changed`, `push_subscribed`. Plain INSERTs through `audit.log`.
  No email bodies, phone numbers or free text in audit rows or logs.
- **System actor:** tasks and events need `created_by` and `updated_by`. The migration makes all four columns
  nullable (NULL = "the website") and the UI shows "Website" for them. Simpler than a fake user, and it cannot sign in.
  Such a task can then be changed by admins and the people it is for, under the existing `policy.check_task` rules
  (builder-check call).
- **Personal data (Québec Law 25):** the form shows a one-line notice ("We use this information only to prepare your
  quote") and a link to the public site's privacy page if one exists. The data stays until an admin deletes it.
- Every new string in all three internal locale files (prefix `quote`). The public form has its own three small locale
  files (prefix `pq`), tested the same way for matching keys.
- Migrations hand-written, `app/models.py` kept in step, tests first.
- Version: raise the minor in `frontend/package.json` and `backend/pyproject.toml` (user-visible release).

## Approaches considered

**Where the public form lives**

- **A. A second page in the existing Vite build (chosen by the owner).** `frontend/quote.html` plus
  `src/public-quote/` as its own entry point: React, the public site's tokens and form styles copied into a local CSS
  file, its own small i18n. It shares the build, vitest and the deploy, and carries no internal app code. Trade-off: the
  header, footer and tokens are a copy that can drift from kmk-public.
- B. Plain HTML and JS served by Caddy, copied from kmk-public's `layout.html` and `kmk.css`: closest look, but no
  tests, and validation, uploads and the languages written by hand.
- C. A form on kmk-public (Cloudflare) posting cross-origin to the API: ruled out, since the owner wants it hosted here.

**Push**

- **Web Push with VAPID (chosen by the owner):** works with the app closed, no third party sees the content (payloads
  are end-to-end encrypted), but needs a service worker, a new dependency and a subscriptions table.
- ntfy or Pushover: simpler, but data leaves for another service and each admin installs another app.

## Data (new tables, one migration)

- `quotes`: `id`, `reference` (`D-` + zero-padded id, unique), `status`
  (`draft`/`new`/`replied`/`customer_replied`/`won`/`lost`; `draft` until "finish", drafts older than 2 hours are
  deleted when a new request starts), `first_reply_at`, `kind`
  (`airbnb`/`commercial`), `name`, `email`, `phone`, `locale`, `details` (JSON with the type-specific fields), `message`
  (free text), `internal_note`, `ip`, `geo_country`, `geo_city`, `user_agent`, `submission_token_hash`,
  `deadline_at`, `task_id`, `event_id` (both set null if deleted), `created_at`, `submitted_at`, `updated_at`.
- `quote_photos`: `id`, `quote_id` (cascade), `content_type`, `size`, `data` (bytea), `created_at`.
- `quote_messages`: `id`, `quote_id` (cascade), `direction` (`out`/`in`), `subject`, `body`, `author_id`,
  `sent_at` (for `in`: when the customer wrote it), `delivery` (`sent`/`failed`, out only), `created_at`.
- Rate limit: counted from the `quotes` rows themselves (`ip_key` and `created_at` over the last hour, drafts
  included, so an `ip_key` column is stored on `quotes`), which keeps no separate table. Expired drafts deleted by the
  cleanup stop counting, which is acceptable: they are at least 2 hours old.
- `app_settings`: `key` (primary key), `value` (text), `updated_by`, `updated_at`.
- `push_subscriptions`: `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `user_agent`, `created_at`,
  `last_used_at`. Deleted when the user is disabled or deleted.
- `task_categories` gets the starter "Quotes" category; `tasks.created_by` and `events.created_by` become nullable.

## API (sketch)

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/public/quotes` | anyone (rate limited) | fields; returns `{id, token}` and creates a draft |
| `PUT /api/public/quotes/{id}/photos` | holder of the token | one photo as the raw body |
| `POST /api/public/quotes/{id}/submit` | holder of the token | marks it new, counts toward the limit, creates task and event, notifies; returns the reference |
| `GET /api/quotes`, `GET /api/quotes/{id}` | admin, super admin | list and detail |
| `GET /api/quotes/{id}/photos/{photo_id}` | admin, super admin | the image |
| `PATCH /api/quotes/{id}` | admin, super admin | status, internal note |
| `POST /api/quotes/{id}/messages` | admin, super admin | send a reply (`out`) or paste one (`in`) |
| `POST /api/quotes/{id}/messages/{mid}/retry` | admin, super admin | resend a failed reply |
| `DELETE /api/quotes/{id}` | super admin | delete |
| `GET/PATCH /api/settings/system` | super admin | system settings |
| `GET /api/push/key`, `POST/DELETE /api/push/subscriptions`, `POST /api/push/test` | admin, super admin | push |

The rate limit is checked on the first call: refuse with `429 {"error":"rate_limited"}` when the IP already started
10 requests in the last hour. `GET /api/public/quotes/config` (anyone) returns the public phone number.

## Email

- `emails/backends.py` gains optional `from` and `reply_to` per message (falling back to `EMAIL_FROM`), sent to Resend
  as `from` and `reply_to`. The `log` backend prints them.
- Customer replies are plain text with a simple HTML version (line breaks kept), signed with the sender's display name
  and "KMK Entretien Ménager", in the customer's language for the fixed parts.

## Left to the builder

- Exact layout of the public page and the Quotes screens, within the two design systems.
- Exact wording of the strings, in the three languages.
- How the draft and photo cleanup runs (on each new request is enough).
