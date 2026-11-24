# Decision log

The decisions that shaped this project, why they were made, what was rejected, and what would make us revisit them.
The original plan is [scope.md](../scope.md) (its §13 is the early log); where a decision here differs, **this file wins**.
Details of how things work are in [security.md](security.md) and [operations.md](operations.md); the design documents per phase are in [superpowers/specs/](superpowers/specs/).

**How to use it:** to change a decision, add a new entry that says which one it replaces and mark the old one "superseded"; do not delete history.
All entries below were decided on 2026-11-17 during the build (phase noted).

---

## Security and privacy

### D1. Passwords are sent as typed, over HTTPS; seeing one in the browser's Network tab is normal (phase 2, asked again in phase 6)
- **Decision:** the login form posts the password as the user typed it. It is encrypted by HTTPS between the browser and Cloudflare and through the tunnel; the server hashes it with Argon2id at once and never stores or logs it.
- **Why the Network tab shows it:** developer tools show the request *before* it is encrypted, in the user's own browser. Nobody on the network path sees it. Only someone at the computer (or a browser extension with page access) can.
- **The real caution:** an exported network log (a HAR file) or a screenshot of that tab contains the password in clear text. Never share one without removing it.
- **Rejected: encrypting the password in the browser before posting.** HTTPS already does the job. The key would have to be shipped in the page (readable by anyone and served by the same party it is meant to guard against), an encrypted blob that is captured can be replayed as if it were the password, hand-written browser cryptography is more likely to introduce a hole than to close one, and it would still be visible in the developer tools and to a malicious script.
- **Rejected: hashing in the browser.** The hash simply becomes the password.
- **Rejected for now: OPAQUE** (a protocol where the password never leaves the browser in any form): the right tool for a different threat model, heavy for 15 people.
- **Accepted trust:** Cloudflare, like any proxy CDN, can see traffic in clear text.
- **Revisit when:** passkeys are built (D2), or the trust in a proxy is no longer acceptable.

### D2. Passkeys are the preferred long-term answer to passwords; not built yet (future)
- **Decision:** if "password visible / password typed" ever becomes a real pain, add passkeys (WebAuthn: fingerprint or device unlock) rather than inventing browser-side password cryptography. Until then, two-step verification (D3) limits the damage of a stolen password.
- **Status:** on the [roadmap](roadmap.md); needs its own design.

### D3. Two-step verification (TOTP) is encouraged, not forced; enforcement is a switch (phase 4a)
- **Decision:** anyone can enable TOTP with recovery codes; a banner encourages it (permanent for admins). The setting `MFA_REQUIRED_ROLES` (empty = nobody forced) can force it for roles later with no code change. `scope.md` wanted it mandatory for admins; the owner relaxed that during the build.
- **Recovery:** the server command `reset-mfa`, and an admin can reset someone else's; deliberately **no email-based reset** (it would make TOTP only as strong as the mailbox).
- **Advice recorded:** turn enforcement on **before inviting any admin account**.
- **Revisit when:** the first admins are invited, or after any account incident.

### D4. Sessions are server-side, not tokens in the browser; Argon2id for passwords (phase 2)
- **Decision:** a random session token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (only its hash is stored), lasting 5 days; CSRF protected by the cookie, an Origin check and a per-session token. Rejected: JWTs (cannot be revoked at once when someone is disabled or loses a role).

### D5. Password policy stays at 8 characters with letters, digits and a special character for v1 (phase 2, kept in phase 6)
- **Why:** accepted in the original plan. Not done: a longer minimum and a breached-password check.
- **Revisit when:** after go-live, if the team grows or an account is compromised.

### D6. HSTS stays at one year, with no `includeSubDomains` and no preload (phase 6)
- **Why:** preload would pin every subdomain of `kmk-entretien.ca`, including the public site, to HTTPS-only and is hard to undo.

### D7. The independent review is part of go-live; minor findings are recorded, not all fixed (phase 6)
- **Decision:** a fresh reviewer read the code read-only; every Important finding was fixed test-first and the Minor ones are listed in [security-review.md](security-review.md) and the roadmap for the owner to decide.
- **Standing advice:** fix the recovery-code hashing (F22) **before** anyone enrolls in two-step verification, because changing it later invalidates their codes.

### D8. Defence in depth that was added after the review (phase 6)
- The running API does not receive the database owner's credentials (a separate one-shot container migrates). At most 4 password hashes run at once. Rate-limit attempts are serialized with locks and counted per IPv6 /64. API bodies are limited to 64 KB. Containers drop capabilities and have memory and process limits.
- **Not done (owner's call):** a Cloudflare rate-limit or WAF rule in front of `/api/auth/*`; changes to other services on this computer.

---

## Access and authority

### D9. Only the super admin can create, demote, disable or delete admins; admins manage plain users (phase 4b)
- **Why:** two-step verification is optional, so one stolen admin password must not be able to remove every other admin. This overrides `scope.md` §6.
- **How:** one policy module decides who may do what; the server enforces it and tells the admin page which buttons to show; nobody can disable, delete or re-role themselves; the super admin account cannot be touched by anyone else (apart from a password reset by itself).
- **Related:** deleting is soft (the username and email stay reserved; a deleted person can be restored); admins and the super admin may reset their own password from the admin page or with "forgot password"; a disabled account can be reset without being re-enabled (the incident playbook relies on it).

### D10. Accounts are created only by invitation; nobody is invited until everything is ready (phases 2-3, go-live)
- **Decision:** no sign-up. Invitation and reset links go by email, are single use, expire (48 hours and 30 minutes), and carry the token in the URL fragment so it never reaches a server log. The owner will invite the ~15 employees only after the go-live checklist is done ([golive.md](golive.md)).

---

## Hosting, data and operations

### D11. Served through the existing Cloudflare Tunnel, as its own compose project (phase 0-1)
- **Why:** the home connection has no public address (CGNAT), so nothing can be exposed directly; the domain is in the same Cloudflare account as the existing tunnel. A separate project keeps kmk independent of famillai.
- **Rejected:** adding the site to famillai's server (couples unrelated projects); a second tunnel (not needed).

### D12. The shared PostgreSQL server with its own database `kmk` and a restricted runtime role (phases 1-2)
- **Decision:** database `kmk` on the shared server; the application connects as `kmk_app`, which may only INSERT into the audit log; an owner role runs migrations. Rejected by the owner: a dedicated Postgres container.
- **Consequence:** kmk shares the server's availability, connection limit and superuser with other projects; tests therefore use non-pooled connections.

### D13. Email goes through a small layer: Resend when configured, a log-only backend until then (phase 3)
- **Status:** Resend is **not set up yet**; invitation and reset links currently appear only in the API log. Switching is a settings change ([operations.md](operations.md)); it is a go-live step.

### D14. Backups: encrypted with a public key, written to `/mnt/shared/BACKUPS/kmk`, verified daily (phase 6)
- **Owner's choices:** that destination, and encryption.
- **How the key works:** the unattended job holds only the public key; the private key and its passphrase live in the owner's password manager, never on this computer. Without them backups cannot be restored.
- **Known limit, accepted for now:** that partition is on the same SSD as the system and readable from Windows, so it protects against mistakes, a reinstall and filesystem damage but not against the SSD failing or being stolen. An off-site copy is a future step.
- **Safety choices:** the job refuses to run unless the partition is mounted; a restore only trusts archives whose hash the backup recorded.

### D15. Default language French (Canada); the language is stored per user on the server (phases 2, 5)
- **Decision:** `fr-CA` by default, `en` and `pt-BR` available; a signed-in person's choice is saved on the server (so it follows them and sets their email language); before signing in a small picker is remembered in the browser; invitation links carry the language.
- **Open:** the Portuguese text has had no native review; the welcome page is a placeholder until the owner supplies the real content.

### D16. The documentation in `docs/` describes what is built; `scope.md` is the original plan (phase 4a)
- **Decision:** `docs/` is kept accurate when behavior changes and is verified against the running system before each phase is called done; every phase has a design document and a plan under `docs/superpowers/`.

---

## Schedule

### D18. The schedule is a port of FamillAI's, with new Python code and two new front-end libraries (phase 7)
- **Decision:** copy FamillAI's schedule screens (restyled with KMK's colors), write the API in Python, and keep its repeat-rule JSON. Repeating dates come from `python-dateutil`'s `rrule` (the standard implementation of the calendar repeat rules), checked against FamillAI's own test cases; the front end gained `react-router` and `@tanstack/react-query` (FamillAI's code uses both), at the versions FamillAI pins.
- **Rejected:** translating FamillAI's Java repeat engine line by line (it would be a hand-kept engine; it stays the fallback if `rrule` ever disagrees with the parity tests), and a ready-made calendar component (it would not look or behave like FamillAI).
- **Who sees and edits events:** everyone sees everything; creator, listed people and admins edit (see [security.md](security.md)).
- **Revisit when:** KMK needs private events or client data in events (then add per-event visibility), or an `rrule` upgrade changes a date.

## People

### D17. Every person has one display name; admins and the super admin fix it, people cannot change their own (user name feature)
- **Decision:** one `name` field ("Marie Tremblay"), shown wherever a person is identified (greeting, account page, admin list, emails, command-line tools); the username stays the sign-in handle and is shown next to the name where two people could share one. It is required on invitation, with a fallback to the username for accounts without one (the first super admin predates the feature).
- **Who can edit it:** an admin for plain users; the **super admin for everyone, including their own account** (the owner's requirement: this is the one exception to "nobody edits the super admin"; the self rules still forbid the super admin from disabling, deleting or re-roling themselves). People cannot change their own name for now, because the name is how admins identify people.
- **Rejected:** separate first and last names (more fields, and splitting names such as double names or "de la" is error-prone; the greeting uses the whole name instead).
- **Privacy:** a name is personal information: visible only to the person and to admins, never in audit details, error messages or normal logs; emails carry it in the body only, escaped. Deletion is soft, so a name stays in the database and the encrypted backups; a real erasure feature is not built (a known limit for the privacy review).
- **Revisit when:** people should edit their own name, or the privacy review asks for erasure.
