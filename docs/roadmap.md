# Roadmap and follow-ups

Where the project stands and what to pick up next. Status of the phases is also in the table in [README.md](README.md).

## Done recently: phase 4b, Admin

The admin page, the user lifecycle (disable, enable, delete, restore, role change, edit, reset password and two-step) and one central authority policy are built;
see [security.md](security.md) and the [design](superpowers/specs/2026-11-17-phase4b-admin-design.md).
**Decision recorded:** only the super admin can create, demote, disable or delete admins. This deliberately overrides `scope.md` section 6 (which let admins manage admins).

## Done recently: phase 5, Frontend

The app shell with navigation, the placeholder welcome page, the account page, per-user language switching (stored on the server, with a pre-login picker and language-carrying email links), a not-found page, page titles and responsive polish are built;
see the [design](superpowers/specs/2026-11-17-phase5-frontend-design.md). **Still to do by the owner:** the real welcome content (the page is a placeholder; see how to add blocks in [README.md](README.md)) and a review of the Portuguese text by someone who reads Portuguese.

## Next: phase 6, Hardening and go-live

- A security review (ideally independent of whoever wrote the code), a **restore test** from a backup, final checks of headers, rate limits and the audit log.
- Dependency vulnerability scanning in the build (`npm audit` for production dependencies was clean at the end of phase 4a; the Python side has no scanner yet).
- Consider HSTS preload and tightening the password policy (longer minimum, breached-password check).
- Resend deliverability test (see [operations.md](operations.md)).

## Switches that are built but off

| Switch | Where | What it does |
| --- | --- | --- |
| Force two-step verification | `MFA_REQUIRED_ROLES=admin,superadmin` in `deploy/.env` | forces the listed roles to enroll; they cannot disable it. Original plan (`scope.md`) wanted this for admins; it was relaxed to "encouraged" during phase 4a. **Turn it on before inviting any admin accounts** |
| Real email | `EMAIL_BACKEND=resend` + `RESEND_API_KEY` | invites and resets go out through Resend; today they are only printed in the API log |

## Open items (from `scope.md` §14, with their status)

| Item | Status |
| --- | --- |
| Is the hostname proxied through Cloudflare? | answered: yes, always, through the tunnel |
| Who is the super admin? | created with the server command (see [operations.md](operations.md)) |
| Resend sender address | suggested `no-reply@mail.kmk-entretien.ca`; Resend itself is not set up yet |
| Welcome page copy in EN, FR-CA, PT-BR | open: the page exists with placeholder text; real content to be added by the owner |
| Portuguese review | open: all Portuguese UI and email text was written without a native reviewer |
| Schedule the regulation and backup reviews | open |
| Invite the ~15 employees | waits until the above is ready; the owner chose to do it after everything else |

## Parked risks (from `scope.md` §12)

| Risk | Status | Note |
| --- | --- | --- |
| Privacy regulation (PIPEDA, Quebec Law 25, LGPD) | parked | have a qualified person review before real customer data is stored |
| Backups and encryption | partly done | database dumps exist via `pg-backup.sh` (needs its `.env`); `deploy/.env` and the MFA key must be saved separately; no restore test yet; must be solid before customer records are added |
| Production only (no dev/staging) | accepted | the same compose file can run locally with a different `.env` |
| "Local" hosting | resolved | no inbound ports are needed; access is through the Cloudflare Tunnel |
| Password policy fixed at 8 characters | accepted | revisit in phase 6 |

## Deferred minor items collected from every phase

- The audit log has no viewer and no retention policy; read it with `psql`.
- `login_attempts` rows are pruned opportunistically on each attempt, not by a scheduled job.
- Someone can lock out a colleague's sign-in for 15 minutes by repeating their name (accepted at this size).
- No Python dependency vulnerability scanning; no TOTP key rotation.
- The development email backend prints links to the log; do not leave it on once users exist.
- Reviews of phases 2 to 4a were done by the author, not by an independent reviewer; an independent review is recommended before go-live.
- The shared scripts `pg-new-db.sh` and `pg-backup.sh` need `/home/evandro/projects/shared/.env`, which does not exist on this machine.
- The user list on the admin page has no pagination or sorting options (fine for ~15 people).
- The last-admin safety check cannot trigger through the API today (the super admin always remains); it is tested at the code level only.
- Sessions are 5 days absolute (no idle timeout, no list of active sessions, no "sign out everywhere" button).
- The first-ever login of each invited user needs the email layer to be real (Resend) or the owner to read links from the API log.

## Later (from `scope.md` §10)

AI features and customer records: AI tool calls run as the signed-in user, with a read-only database role and a separate schema for customer data; prompts and tool calls go to the audit log;
know where LiteLLM sends data. None of this is built, and each needs its own design.
