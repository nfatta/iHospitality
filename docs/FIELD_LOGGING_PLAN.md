# Field Logging Plan (V3): contractors log their own work

> **Written 14 Sep 2026 from a design conversation with the operator. The design
> below is AGREED. NOTHING IS BUILT.** Read `CLAUDE.md`, `docs/PORTAL_PLAN.md`
> and `docs/DATA_ACCESS_TIERS.md` first. This is the V3 item in `HANDOFF.md`:
> contractors enter their own work in the portal and HubSpot stops being the
> input.
>
> Decisions made in that conversation are listed at the bottom under
> **Decisions to record**. They get D-numbers in `DECISIONS.md` when the phase
> that implements them lands, not before.

---

## Why

HubSpot is the input today and the business is leaving it (D84). Contractors
log a deal in HubSpot, the operator pulls it into staging, reviews it and
promotes it. That is two systems, a manual pull and a month-end scramble.

The goal: **the person in the field logs the work once, in the portal, with
photos, receipts and location, and it is visible internally the moment it is
saved.** Brands see a month only after the operator has reconciled it.

---

## Words used in this plan

| Word | Meaning |
|---|---|
| **Activity** | What HubSpot called a deal. One visit or piece of work at one venue on one date. Replaces the word "deal" everywhere in the portal. |
| **Activity type** | The dropdown inside an Activity (`tasting event split`, `1st case sale`...). The raw rate-card string (D74). |
| **Name** | Free text the contractor types. Stored as `activities.title`. |
| **Brand line** | One brand's part of an Activity. An Activity has one or more. Each brand line is ONE row in `activities`. |
| **Planned / Done** | A Planned activity has a future date and counts for nothing. Marking it Done makes it a real activity. |
| **Close date** | The date the work was done. `activities.activity_date`. Drives money, reports and release. |
| **Created** | When the Activity was first saved. Stamped automatically, never typed. |
| **Release** | The operator marking one brand's month as reconciled. Brands see nothing from an unreleased month. |

---

## Rollout

- **Pilot: Phil.** He logs in the portal ONLY (not HubSpot) for 2 to 4 weeks.
  Everyone else stays on HubSpot and the sync keeps running for them.
- **Phil is an admin (`staff`), so his view hides contractor-only faults**
  (D154). Every portal page is also opened as the contractor role before the
  switch, and the SQL tests impersonate a contractor and a brand (D125).
- After the pilot: compare against what HubSpot would have held, fix, move
  everyone, then **turn the HubSpot sync off.**

---

## 1. Logging an Activity

### Fields

| Field | Level | Notes |
|---|---|---|
| Venue | Activity | Search existing, or **+ Create new venue** (section 3). |
| Close date | Activity | Defaults to today, can be backdated, never in the future (the `activities_date_not_future` CHECK stays). For future work, see **Planned**. |
| Name | Activity | Typed. |
| Photos | Activity | Section 4. Per-photo, per-brand visibility. |
| Location | Activity | Section 7. Captured on save. |
| Brand | Brand line | Active brands. **+ Add another brand** adds a line. |
| Activity type | Brand line | **Keyed to that brand**: the brand's own rate-card strings plus the shared `(all brands)` strings that price for it. **No money shown.** |
| Quantity | Brand line | The multiplier (D65). |
| Amount | Brand line | Shown only when that type is percentage-priced for that brand (D98). The form learns this without learning the percentage. |
| Brand-facing description | Brand line | `brand_visible_summary`. What that brand reads after release. |
| Internal notes | Brand line | `notes`. **Notes are per brand**, because month-end reports are per brand. |
| Who did it | Activity | **From the login. Never a form field.** Written to `activity_contractor` (D135). |
| Created | Activity | Server timestamp. |

### Several brands, one Activity

A shared tasting for two brands is ONE Activity with two brand lines, each with
its own type (`tasting event split`), quantity, description and notes.

**Stored as one `activities` row per brand line**, linked by a new
`activity_group_id`. That keeps everything that already works per row working:
money (`v_activity_money`), RLS isolation, reports, the account-status trigger.
Brand A can never read Brand B's line or notes.

> `activity_group_id` is a new column on `activities`, and **new columns are
> not granted to brands** (D134). That is the right default here: a brand has
> no use for the group id, and a brand-facing view that ever needs it fails
> loudly rather than leaking.

### Check in now, log later (added 14 Sep 2026)

Operator: activities are often logged later, and some work (a case sale that
came in through the distributor) happens with nobody there. So logging is split
from being there:

- **"I'm at an account"**: one tap, pick the venue (search or create), Save.
  It stamps the venue, the time (server and device) and the phone's location.
  An optional quick note or photo. Nothing else is asked.
- **When the contractor opens Log Activity later, the first thing shown is
  "Accounts you were at, not logged yet"**: tap one and the form opens with the
  venue, close date and location already filled from the check-in.
- **A check-in ends one of three ways:** logged (linked to one or more
  activities), **nothing to log** (dismissed, with an optional reason), or still
  open. Open check-ins feed the reminders (section 9).
- **An activity with no check-in is normal**, not a fault: a distributor-driven
  case sale or reorder (D118) is logged after the fact with a backdated close
  date. It simply carries no on-site stamp.
- **A linked check-in is the proof of visit.** Later, the far-from-venue flag and
  visit recommendations read check-ins first.
- **Brands never see check-ins.** Stored in an internal `venue_checkin` table
  (contractor from the login, venue, times, location, note, status);
  activities carry an internal `checkin_id`.
- **Open questions for the build:** is a check-out time (how long they were
  there) wanted; and when two people check in at the same venue, is that one
  shared visit or two.

### Two people at one event

**Each logs their own Activity** and is paid on their own. If an Activity with
the same venue, close date and activity type already exists from someone else,
the form **warns and does not block**.

### Planned, then Done

- **Planned**: saved with a future **planned date**. Shows in **Upcoming** for
  the contractor and for staff. Counts toward no money, no report, no brand.
- **Mark done**: close date fills in (planned date or today, editable), the
  contractor adds quantity, photos and notes, and it becomes real activities.
- **Reminder** if the planned date passes and it is not marked done.
- Stored in its own internal table (`planned_activity`), NOT in `activities`,
  because the future-date CHECK protects the money and must not soften.

### The contractor's running total

A **"This month so far: $X"** figure on the Log page: **their own pay**, never
the charge (D137). It reads `v_my_activity_pay` / `v_my_pay`, the same source
as `my-pay.html`, and moves the moment they save. Percentage work updates once
the amount is in.

### Editing and deleting your own work

- A contractor can **edit or delete their own brand lines until that brand's
  month is released, or until staff has edited the row**, whichever comes
  first. After that it is locked and only staff changes it.
- **Contractor edits must NOT stamp `hand_edited_at`.** That stamp means "a
  person in the admin ruled on this" and drives the sync's stop-and-ask (D64,
  D84). Contractor edits get their own `contractor_edited_at`.
- **Delete is a recycle bin, not a delete.** The line disappears from every
  portal page and every money figure, and a full snapshot (the row, notes,
  photos, contractor, GPS, who deleted it, when, optional reason) is kept in
  `activity_deleted`. The admin lists them and can **restore**.
- **Why an archive table and not a `deleted_at` flag:** the admin, invoicing
  and every money view read `activities` with `service_role`, which bypasses
  RLS. A flag would have to be remembered in every one of those queries, and
  the one that forgets counts a deleted row as money.

---

## 2. What brands see: the month release gate

**Brands see a month only after the operator releases it, per brand.**

- New table `brand_month_release (brand_id, month, released_at, released_by)`.
  Staff-only writes, from the admin.
- **`activities_select` for a brand becomes: own brand AND month released.**
  Because `venues_select` and `photos_select` already reach brands only through
  `activities`, unreleased work disappears from venues and photos with no
  further policy change. The `v_brand_*` views are `security_invoker`, so they
  inherit it.
- **The leak to fix: account status.** `brand_venue_status` is advanced by a
  trigger the moment an activity is inserted (D86), so a brand could read
  `placed` before the month is released. **Brand-facing status must be derived
  from released activities only.** This is real design work in Phase 1 and
  gets its own impersonation test.
- **Per-photo brand visibility** (section 4) is a second condition on
  `photos_select` and on `photos_storage_select` (D153: both gates must agree).
- **Day one: every brand, every month through Aug 2026, is released.** September
  onward is hidden until released. Brands lose sight of September's in-progress
  work, which is the intent.
- **Unaffected:** staff and contractor pages (`is_internal()`), the Streamlit
  admin (service role), and the Brand report sheet push, which the operator
  already controls by month.
- **Release is undoable.** It is a row, not a one-way transformation.

---

## 3. Venues, contacts and venue problems

### Create a venue in the form

**+ Create new venue** under Venue, or on its own:

- **Name** (required), **City**, **Notes**
- **Manager/owner contact(s)**: name, role, phone, email, **best time to reach**
- **Location** captured at creation (section 7)
- **"Did you mean...?"**: as the name is typed, close existing matches are
  shown before a new venue is created. It suggests; the contractor decides. The
  operator merges real duplicates on the Venues page (D81 still holds for the
  importer: the matcher never guesses).
- **Market** is left for the operator to set on the Venues page.

### Contacts

- **Multiple contacts per venue**, on new AND existing venues. Add, edit, or
  mark "no longer there".
- `venue_contact.hubspot_contact_id` is `NOT NULL` today and must become
  nullable; same for `venue_note.hubspot_note_id`. New columns:
  `best_time_to_reach`, `notes`, `is_current`, and who created or edited it.
- A contact edited in the portal is stamped and **the HubSpot contact sync
  leaves it alone** (the D84/D152 rule).
- Contacts and notes stay `is_internal()`, never a brand (D152).

### Report a venue problem

**Report a problem** on any venue: moved, closed, wrong name, duplicate of
another venue, plus a note. Lands in a queue on the admin's Venues page.
Contractors flag; the operator decides (closed vs retired is D159's
distinction and stays his).

> ⚠️ **Fix `merge_venue()` BEFORE the pilot.** It does not rescue
> `venue_note`, `venue_contact_link` or `venue_profile`, which cascade on
> delete (D174). Contractors creating venues will create duplicates, and
> merging them today destroys the contacts and notes the contractors typed.

---

## 4. Photos

- **Take photo** (opens the camera) or **Upload** (photo library). Several per
  Activity. Addable after the fact until release.
- **Shrunk on the phone** to about 1600px JPEG before upload. **Only the shrunk
  version is kept.**
- **Read the photo's metadata BEFORE shrinking**, because shrinking erases it
  (section 7). An EXIF reader loads from jsdelivr like `supabase-js`; no build
  step.
- Progress bar, retry on failure, queued with the draft when there is no
  signal (section 8).
- **Consent checkbox** stays (`photos.consent_confirmed`).
- **"Brand can see" per photo, VISIBLE by default.** On a multi-brand Activity
  the operator or contractor picks which brands. Stored per photo row, and a
  photo shared by two brand lines is one row per line pointing at the same file,
  so visibility is naturally per brand.
- A photo's brand-facing description is still `summary`, never `caption`
  (D122).
- Upload path is inside the uploader's own folder; a storage INSERT policy
  allows that prefix only, and no UPDATE or DELETE.
- ⚠️ **Verify on Phil's actual phone**: that iPhone HEIC arrives as JPEG through
  the file input, and what metadata survives.

---

## 5. Expenses

**Their own record, not an activity with a checkbox.**

| Field | Notes |
|---|---|
| Who | From the login. |
| Brand | **Active brands plus iHospitality.** No brand means iHospitality. |
| Venue | Search or create. |
| Linked Activity | Optional, chosen from Activities at that venue. |
| Date, amount | Amount required. |
| Category | From an `expense_category` table the operator edits (D60). |
| Receipt | Camera or upload. **Required**, or a reason why there is none. |
| Notes | Internal. |
| Location | Captured on save. |

- **Company card, so there is no reimbursement step.** The receipt is what
  matters: every expense is either **billed to the brand** or **written off**.
- **Outcome defaults from the brand** (a brand means bill it, iHospitality means
  write it off) and the operator overrides it in the admin.
- **Status:** submitted, then billed or written off.
- **Brands NEVER see expenses.** Not the line, the receipt or the notes. RLS:
  staff, or the contractor who submitted it.
- Receipts live in a private `receipts` storage bucket, same ownership rules.
- Same lifecycle as activities: editable until the brand's month is released,
  deletes go to a recycle bin.
- **Migrate the 5 existing `is_expense` activities** (all carry no amount) into
  `expense`, so there is one system. `activities.is_expense` and D78's branch
  in `v_activity_money` stay for HubSpot history.

---

## 6. Mileage

- **Only for events that iHospitality or the brand requested.** Never day-to-day
  travel.
- **Entered when needed, per trip, on the event's Activity**: a brand line of
  type `mileage` (quantity = miles, priced by the rate card as today, a
  pass-through, D91) plus **From** (a venue, or other with a description). **To**
  is the Activity's venue.
- **The system verifies a claim, it does not calculate one.** Once venues have
  coordinates (Later, below), the admin shows the straight-line distance from
  From to To beside the miles claimed.

---

## 7. GPS and time

**Recorded from day one. No GPS features in V1**, so that later features start
with months of history.

| When | What is stored |
|---|---|
| Photo attached | Photo's own taken-at time and GPS **if they survived**; otherwise the phone's location and time at that moment. |
| Activity or expense saved | The phone's location, accuracy (metres) and device time. Always attempted. |
| Venue created | The phone's location, as the venue's first coordinates. |
| Every save | The server's own timestamp, which a wrong phone clock cannot change. |

- **Photo metadata GPS is usually missing.** iPhones strip location from photos
  shared with a website by default, Android's picker increasingly does, and
  photos taken through the browser camera often carry none. The phone's
  location is the dependable source.
- **Denied or unavailable: save anyway, flag "no location".** Never block.
- **Captured only when logging, never tracked in the background.** Contractors
  are told this in writing before the pilot. (Worth a check on what is
  appropriate for independent contractors; this plan is not legal advice.)
- **Visibility:** staff see all; a contractor sees their own; brands never.
- **GPS is NOT a column on `activities` or `venues`.** A brand can `select *` on
  both (D88), so coordinates live in internal tables (`activity_capture`,
  `photo_capture`, `venue_location`).
- **Kept forever.**
- iPhone may re-ask location permission periodically for an installed portal.

---

## 8. No signal

- **The form saves a draft on the phone as it is filled in** (IndexedDB, photos
  included), so nothing is lost if the page closes.
- **Send fails:** the entry stays on the phone marked **Not sent yet**, retries
  automatically while the portal is open, and has a Send button.
- **Every Activity gets an ID generated on the phone before sending**, and the
  database function treats a repeat of that ID as the same submission. A double
  tap or a retry never creates a duplicate.
- **Limit:** iPhones do not let a website send while it is closed, so a queued
  entry goes out the next time the portal is opened.
- The service worker still **never caches a Supabase response** (`sw.js`
  header). Drafts are app data in IndexedDB, not a cached response.

---

## 9. Reminders

**Types:**
- **Personal**: a contractor sets a reminder for anything ("call Sarah at Prime
  Catch Tuesday 2pm"), optionally attached to a venue, contact or Activity.
- **Planned date passed** and not marked done.
- **New entries** for staff: activities, expenses, venue problems.
- **Month-end nudge** to finish logging and attach receipts.
- **Missing receipt** after a few days.

**Delivery: phone notification, with email as the fallback.**

- Push from the installed portal (Android; iPhone only when added to the Home
  Screen, iOS 16.4 or later). Permission is asked on a tap, never on page load.
- Email for anyone who has not allowed notifications. **Needs custom SMTP in
  Supabase**, which the password-reset flow is already blocked on (D144).
- **Something must run on a schedule, and nothing does today.** A Supabase
  scheduled job calls an Edge Function that reads due reminders and sends them.
  That function holds the service key and VAPID keys **server-side only**. It
  sends notifications; it is not a write path from the browser, so it does not
  widen D61. (It is `DATA_ACCESS_TIERS.md` option (a), used for sending only.)
- An in-portal reminders list and badge exist regardless, so nothing depends on
  a notification arriving.

---

## 10. The admin (laptop, Streamlit)

- **Release months**: per brand, per month, with undo.
- **Review and edit**: field entries alongside HubSpot deals, with **no
  location** and (Later) **far from venue** flags.
- **Expenses**: receipts, bill or write off.
- **Recycle bin**: deleted activities and expenses, restore.
- **Venues**: field-created venues, venue problem queue, merge (after the
  `merge_venue()` fix), set market.
- **Upcoming**: planned activities across everyone.

Promote, rate card, users and merges stay on the laptop (Tier 3).

---

## 11. Security: how D61 is reopened

D61 says the portal is read-only by construction. V3 opens it **once, narrowly,
on purpose**:

- **Still ZERO table write grants for `authenticated`.** The grant audit in
  `db/test/run.sh` stays at 0 (cleaned up 14 Sep 2026: the stray TRUNCATE).
- **Writes go through named `security definer` functions only**, called with
  `db.rpc(...)`: submit, edit, delete Activity; mark planned done; create venue;
  add or edit contact; add venue note; report venue problem; submit, edit,
  delete expense; set reminder; register push subscription.
- **The gate is the first line of every function body:** caller is active and
  has a `contractor_id` (keys on the contractor record, never on the role,
  D140). A brand login gets an exception, not a partial write.
- **Identity comes from the login.** No function accepts a contractor id or a
  user id as a parameter.
- **Ownership and lock checks inside the function**: own row, month not
  released, not staff-edited.
- **Functions never write** rates, users, merges, promote or release.
- **The activity-type vocabulary function must not call
  `resolve_activity_type()`**, which creates rows (D167). It reads only.
- **Storage:** INSERT into the uploader's own prefix in `activation-photos` and
  `receipts`; no UPDATE, no DELETE.
- **Tests**, each proven able to fail (D114): a brand calling every write
  function RAISES; a contractor cannot edit another contractor's row, a released
  month, or a staff-edited row; retries with the same client ID do not
  duplicate; a brand reads nothing from an unreleased month, including account
  status and photos; expenses and GPS are invisible to brands and to other
  contractors.

---

## Build phases

Each phase ships and is verified on its own. Take a backup before any schema
apply (`backup_db.py`). Netlify builds are rationed: prove locally, one build
per portal phase.

| Phase | What | Verify |
|---|---|---|
| **1. Release gate** | `brand_month_release`, brand policies, brand-facing account status from released months, photo policies, day-one release through Aug 2026, admin Release page. **Useful before anything else exists.** | Impersonate a brand: Aug visible, Sep invisible across activities, venues, photos, status. Staff pages unchanged. |
| **2. Write foundation** | RPC gate pattern, `activity_group_id`, `contractor_edited_at`, capture tables, brand-keyed activity-type vocabulary (no money), venue create, contacts (nullable HubSpot ids), venue notes, venue problems, recycle bin, storage policies, **`merge_venue()` rescue fix**. | SQL suite incl. new test files; grant audit 0. |
| **3. Log Activity (portal)** | Log page with multi-brand lines, photos (camera/upload, shrink, EXIF, visibility), GPS capture, drafts and retry, month-to-date pay, My activity (edit/delete until release), venue create, contacts, report problem. `ALLOWED` list (D124), nav, `sw.js` version. | Open as contractor AND admin (D154), on a phone; type in every field (D92). |
| **3b. Check-ins** | "I'm at an account", `venue_checkin`, the not-logged-yet list at the top of Log Activity, prefill, dismiss, `checkin_id` on activities. | A check-in logged later lands with its venue, date and location; brands read 0 check-ins. |
| **4. Planned / Done** | `planned_activity`, Upcoming, Mark done. | Planned counts for nothing; Done lands as activities. |
| **5. Expenses** | `expense`, `expense_category`, receipts bucket, portal form, admin expense page, migrate the 5 rows. | Brand and other contractor read 0 expenses and receipts. |
| **6. Admin** | Field entries on Review and edit with flags, recycle bin, venue problem queue, Upcoming. | Open every tab. |
| **7. Reminders** | In-portal list first, then push subscription, scheduled job, Edge Function, email fallback (needs SMTP). | A due reminder arrives on Phil's phone and by email. |
| **8. Pilot and cutover** | Phil portal-only for 2 to 4 weeks, written GPS notice, compare with HubSpot, move everyone, sync off. | Month reconciles from portal data alone. |

---

## Logged for later

- **Nearby accounts**: a list sorted by distance from where you stand, with
  status, days since last visit, grade, and prospects nobody has worked.
  *"I am at Prime Catch; what within 3 miles has not been visited in 90 days?"*
- **Visit recommendations**: suggested stops from location, **when the manager
  is available** (why best time to reach is captured now), how quiet the account
  is, and grade (D117).
- **Venue coordinates for existing venues** from HubSpot company addresses, or
  confirmed from a first logged visit.
- **Far from venue flag** on Review and edit, threshold in a table (D60).
- **Mileage check**: straight-line From-to-To beside miles claimed. Real
  driving distance needs a routing service; start with straight line.
- **Map**: only if Nearby accounts proves used. If built, contractors get the
  Territory view; trip and visit-proof views stay staff-only.

---

## Risks and open items

- **Storage**: photos plus receipts will grow toward Supabase's free 1 GB.
  Shrinking helps; watch it.
- **SMTP** is unconfigured and blocks both email reminders and password reset.
- **Duplicates during the pilot**: Phil stops HubSpot entirely; the Duplicates
  page catches the rest.
- **`account_status` trigger and planned/deleted rows**: the trigger only
  advances (D86). A deleted depletion that was a venue's only one leaves the
  status wrong, as D113 describes; the delete function should walk it back.
- **iPhone specifics**: HEIC, metadata stripping, location re-prompts, push
  requiring Home Screen install. All to verify on Phil's phone in Phase 3.

---

## Decisions to record

Numbered in `DECISIONS.md` when the implementing phase lands.

1. **"Deal" becomes "Activity"** in the portal; "Activity type" is the dropdown;
   Name is typed.
2. **Field entries land directly as activities**, not in staging. The release
   gate protects brands; month-end reconciliation is the review.
3. **Brands see a month only when released, per brand.** Day one: through Aug
   2026. Brand-facing account status reads released months only.
4. **One Activity, many brand lines**, one `activities` row per line, linked by
   `activity_group_id`; notes and description per brand.
5. **Each person logs their own Activity**; duplicates warn, never block.
6. **Planned then Done**, in a separate table; the future-date CHECK stays.
7. **Contractors edit and delete their own work until release or a staff
   edit**; deletes go to an archive table, restorable.
8. **Contractors create venues and contacts** (multiple, editable, best time to
   reach) and report venue problems; the operator merges and decides.
9. **Photos: camera or upload, shrunk only, visible to brands by default, per
   brand.**
10. **Expenses are their own table**: company card, receipt required, billed to
    brand or written off, brand list is active brands plus iHospitality,
    **never brand-visible**.
11. **Mileage is event-only and verified, never calculated.**
12. **GPS and time recorded from day one, never blocking, never background,
    kept forever, never brand-visible, never a column on `activities` or
    `venues`.**
13. **D61 reopened narrowly**: zero table write grants remain; named definer
    functions with a contractor-record gate on the first line; identity from
    the login only.
14. **Reminders by push with email fallback**, via a scheduled Supabase job
    whose keys never reach a browser.
15. **Pilot is Phil**, verified additionally as the contractor role.
16. **Being there and logging are separate acts**: a one-tap check-in stamps
    venue, time and location; Log Activity starts from open check-ins; an
    activity with no check-in is normal.
