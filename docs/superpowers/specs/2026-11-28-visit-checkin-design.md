# Visit check-in and check-out (registro de visitas) - design

Status: approved by the owner (2026-11-28). Conversation in Portuguese; this document records what the owner
decided and, marked **(builder's call, proposed)**, what the assistant filled in.

## 1. Intent and why

KMK pays its cleaners **per visit (a fixed package)**, not per hour. The owner wants two things from this module:

1. **To pay**: know which visits each person did in a period, and export it.
2. **To be able to prove it later**: a trustworthy record that a visit was done, by whom, with photos of the property.

So this is **not a time clock**. People do not type hours and hours are not paid. A cleaner **checks in** when the visit
starts and **checks out** when it is finished; check-out is the confirmation that the work was done. At check-out the
cleaner can upload photos of the property, filed by room.

## 2. Goals

- Check-in and check-out on a visit (an occurrence of an Agenda item for a property), from a phone.
- **Hybrid check-in**: the first person to arrive checks in themselves and the colleagues with them (chosen from the people
  listed on the visit); someone who was not checked in and arrives later checks in themselves.
- **One check-out** per visit: it closes the visit for everyone checked in.
- **Photos by room**: each property has a list of rooms; each photo is filed under a room or under "Other" with a free name.
- **"Photos required" per property** (a checkbox on the property, off by default). When on, check-out needs **at least
  one photo per room on the list**; a room can be **skipped with a reason** ("locked", "not in the package").
  When off, photos are optional, but closing with none shows a strong recommendation (the cleaner can still close).
- **Corrections (amend)** without losing the original.
- **Report for paying**: visits done per person in a period, with a detail list and a **CSV export**.
- **Invoice hint**: the list of visits to bill shows a warning on visits that have no check-out (they stay billable).

## 3. Non-goals (decided)

- No GPS or location of any kind.
- No hours: nothing is computed or shown as hours worked; nothing is used for pay amounts.
- No pay amounts or payroll: the app counts visits; the owner pays outside it (spreadsheet or payroll).
- **No self check-in for substitutes**: a person not listed on a visit cannot check in to it. The admin adds the
  substitute to the visit in the Agenda first (this keeps today's rule that Staff only see visits that list them, so no
  one can reach another client's address or door code by checking in).
- No approval workflow for corrections.
- Not shown to clients (no photo sharing with clients).
- **No offline mode** (decided 2026-11-28): client homes usually have mobile signal. Check-in, check-out and photos need the
  internet at that moment; without signal the cleaner does it later through a correction (section 10), within the window.
- **No videos** in this version (decided 2026-11-28). Even short 720p clips would be 10-15 GB per 6 months at 10 visits a
  day, more than the free disk; phone videos also embed GPS, and removing it needs server-side conversion (`ffmpeg`) on a
  shared machine. A future step once there is more disk, or with the cloud option (approach C).

## 4. Anti-goals (would make it a failure even if it works)

- A cleaner can silently rewrite what happened (every change must stay visible, with who, when and why).
- A Staff member can see visits, addresses or access notes they cannot see today.
- The photos fill the system disk (6.3 GB free on 2026-11-28, 91 % used) or multiply in the backups.
- Photos carry location (the owner chose "no GPS"; phone photos usually embed it).

## 5. Constraints

- Disk: 70 GB system disk, 6.3 GB free. Photos must be compressed on the phone and kept a limited time.
- Backups: 14 daily plain archives of the database in `infrastructure/backups/` (decision D14). Anything in the database
  is copied 14 times.
- Visibility today (`policy.can_see_item`): admins and the super admin see every Agenda item; Staff see the ones that list
  them and the ones they created. Clients and properties: Staff see the ones they are scheduled for.
- Project conventions apply (CLAUDE.md): every route behind the guard; authority rules in `policy.py`; audit rows with
  `audit.log(...)`; migrations as hand-written SQL (next is `0024`); four locale files; test first; docs kept accurate.

## 6. Approaches (where the photos live)

| | Approach | Trade-off |
|---|---|---|
| A | Photos inside the database (like documents and quote photos) | One place, existing patterns, backup covers it, but each of the 14 backups copies every photo: about 1.7 GB of photos would become about 25 GB of backups. Does not fit. |
| **B (picked)** | **Photos as files on disk; the database keeps one row per photo (visit, room, size, hash)** | Daily backup stays small; photos get their own backup that only copies new files (about 1x their size). New pattern: keep files and rows in step, a writable folder for the API container, a restore step. |
| C | Photos in the cloud (for example Cloudflare R2) | Not on this disk and already off-site, but client homes' photos sit with an outside service, needs an account and keys set up by the owner, and showing photos needs the internet. Possible later if the disk gets tight. |

The owner picked **B**: it fits the disk, keeps the photos on this machine, and needs no outside service.

## 7. What a visit is

- A **visit** is one occurrence of an Agenda item that has a **property** (`events.property_id` set), identified the same
  way invoice lines are: `(event_id, occurrence_date)` where `occurrence_date` is the series' original date.
  **(builder's call, proposed)**: items without a property (meetings, internal tasks) get no check-in.
- Who may check in: the people **listed on that occurrence** (`event_people`), whatever their role.
- When: on the occurrence's actual date in the company time zone (`America/Toronto`), from 00:00 to 23:59.
  **(builder's call, proposed)**: not before that day; after it, only through a correction (section 10).
  A cancelled occurrence cannot be checked in.
- **(builder's call, proposed)**: the record of a visit is proof, so it must outlive changes to the Agenda. Each visit keeps
  a copy of its date, client name and property name; its links to the Agenda item, client and property become empty (not
  deleted) if those are deleted later. Moving an occurrence that already has a check-in to another day keeps the visit on
  its original key and shows the visit under its actual date.

## 8. Check-in and check-out

**Check-in.** On a visit, a listed person taps Check-in and picks who is with them among the listed people not yet
checked in (themselves pre-selected). One row per person is recorded with the server's time, and **who recorded it**
(themselves, or the colleague who marked them). Later arrivals check in themselves. The screen shows, for example,
"Ana (herself, 08:02), Bruno (marked by Ana, 08:02), Carla (herself, 09:15)".
The server's clock is the only clock (the phone's time is never used).

**Check-out.** Any person checked in can close the visit; it closes for everyone. The people checked in at that moment are
the ones the visit counts for (pay report). After the close, no new check-in except by correction.
- Property with **photos required**: the check-out is refused until every room on the property's list has at least one
  photo or a skip with a reason (both recorded).
- Otherwise: closing with no photos shows "No photos on this visit. Photos are highly recommended: they prove the work
  was done." with *Take photos* and *Close without photos*. A visit closed with no photos is flagged **"closed without
  photos"** for admins **(builder's call, proposed)**.
- Times of check-in and check-out are stored for proof only; they are never shown as hours or summed.

**Photos** can be added by any checked-in person between check-in and check-out (not only at the end), and removed by the
person who added them until the visit is closed.

## 9. Rooms and the photos-required switch

- Each property gets an ordered list of rooms (a name each), edited by admins on the property's page, next to a new
  checkbox **"Photos required"** (off by default).
- **(builder's call, proposed)**: when the list is empty, the editor offers a starter list by property kind (house,
  Airbnb, office...), in the admin's language, which the admin can change before saving.
- At photo time the cleaner picks a room from the list or **Other** with a free name (for example "Balcony").
- **(builder's call, proposed)**: each photo keeps a copy of its room's name, so renaming or deleting a room later never
  changes or loses old photos.

## 10. Corrections (amend)

Decided: the cleaner corrects their own visit **until the end of the next day** (company time zone), with a **required
reason**; after that only an admin can correct; **the original is never erased** and the correction is shown next to it
("corrected by Ana on 28/11, reason: forgot to check out").

Corrections cover **(builder's call, proposed)**:
- close a visit that was left open (forgot to check out); the close time recorded is the time of the correction;
- withdraw a check-in made by mistake (wrong visit or a colleague marked by mistake); to fix a wrong visit, withdraw it
  and check in on the right one;
- add a late check-in for a listed person after the close;
- add or remove photos, or skip a room, after the close;
- reopen a visit closed by mistake (admins only).

Who may correct within the window: the people checked in on that visit. Admins may correct any visit at any time.
Every correction is an append-only record (who, when, what, reason) and also an audit row. The visit page and the report
show a **"corrected"** marker.

## 11. Pay report and CSV (admins and the super admin)

A page **"Visits done"** with a date range (default: the last 14 days):

```
Visits done · 16/11 to 29/11                [Export CSV]
Ana      12 visits
Bruno     9 visits   (1 corrected)
Carla     7 visits   (2 closed without photos)
```

Clicking a name lists that person's visits (date, client, property, photos count, markers). A person counts for a visit
when they were checked in when it was closed (after corrections). Open visits (checked in, not closed) are listed apart
as "not closed". **CSV columns (builder's call, proposed)**: date, person, client, property, check-in time, check-out time,
photos, closed without photos, corrected, checked in by. Staff do not see this page.

## 12. Invoices

The billable list (`invoices/billing.py`) marks each occurrence that has **no check-out** with a warning ("no check-out").
It stays billable; nothing else in invoicing changes.

## 13. Who sees what

- **Staff**: their own visits (the ones that list them), the check-ins, photos and corrections of those visits, and the
  rooms of those properties. Nothing else changes for Staff.
- **Admins and the super admin**: every visit, the "Visits done" report, room lists and the photos-required switch.
- **(builder's call, proposed)**: photos are served only through the API, behind the guard and the same visibility check
  as their visit, with `Cache-Control: private, no-store`; never as static files from Caddy.

## 14. Photos: size, format and privacy

Decided: compressed on the phone, **about 1280 px on the longest side, WebP, medium quality (about 120 KB)**, kept
**6 months**, then deleted; the visit record (who, when, corrections, how many photos there were) stays forever.

**(builder's call, proposed)**:
- The browser redraws each picture on a canvas (as the avatar and preview code already do). Redrawing drops all metadata,
  **including the GPS location** phones embed. Where the browser cannot encode WebP (older iPhones), fall back to JPEG of a
  similar size.
- The server accepts only WebP or JPEG checked by their bytes, at most 600 KB each, decodes it (Pillow) to make sure it is
  an image, and never trusts a file name. At most 2 uploads at once per process (the existing slot limit).
- **Disk guard**: uploads are refused with `503 storage_full` when the photo folder's disk has less than 1 GB free.

## 15. Storage on disk and backups

**(builder's call, proposed)**:
- A host folder `deploy/data/visit-photos/` (git-ignored), mounted into the API container read-write at
  `/data/visit-photos`, owned by the container's user (uid 10001); the folder path is an API setting added to
  `api.environment` in the compose file.
- File names are random ids (never user input), sharded in subfolders; the row holds the id, size, content type and
  SHA-256. Write the file to a temporary name, then rename, then insert the row; delete the row first, then the file.
- **Backups**: `kmk-backup.sh` gains a step that snapshots the photo folder into `infrastructure/backups/photos/<date>/`
  with `rsync --link-dest` (unchanged files are hard links, so 14 snapshots cost about one copy plus the new photos),
  pruned with the same newest-14 rule. The restore documentation gains "copy the newest snapshot back".
- **Retention**: a new CLI command `purge-visit-photos` deletes photos of visits older than 6 months and files with no row
  (orphans), and is run daily by a systemd user timer next to the backup one (installed by the same `install.sh`).

## 16. Pages (builder's call, proposed)

- **"Visits today"** (phone-first): the visits of the day that list me, each with Check-in / Check-out, who is checked in,
  photos by room, and the corrections window.
- On the Agenda, the visit's dialog shows its state (not started, in progress, closed, corrected) and a Check-in button.
- **"Visits done"** (admins): section 11.
- Property page: the room list and the photos-required checkbox (admins).

## 17. Left to the builder

The table layout (for example `visits`, `visit_people`, `visit_photos`, `visit_room_skips`, `visit_corrections`,
`property_rooms`), the exact routes, the Dashboard card if any, wording in the four languages, and how the visit dialog
and the new pages look, within the decisions above. Tests follow the project's rules: test first, every new route behind
the guard (`test_mfa_guard.py`), authority in `policy.py`, the correction window and the photos-required rule covered,
photo type and size checks, and the backup photo snapshot covered by `test_backup_scripts.py`.
Raise the minor version (user-visible feature) and update `docs/` (README data model, operations: folder, timer,
backup and restore; security: photos and visibility; roadmap).
