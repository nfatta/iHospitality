# DECISIONS.md

Judgment calls made during the build. Newest last. Each: what, why, what the
alternative was. Operator-confirmed items are marked ✅; assumptions still needing
a ruling are marked ⚠️.

---

**D1 — Python tooling lives in `Hubspot/`, not `portal/`.** ✅ operator-confirmed 10 Aug 2026

`PORTAL_PLAN.md` places `seed_from_csv.py`, `sync_hubspot.py`, and `admin/app.py`
under `portal/`. But this repo's root is the Netlify publish directory, so a
committed `.py` file is served as downloadable text — the exact Phase 0 risk.
`.gitignore` now blocks `*.py` here. Alternative considered: un-ignore `portal/*.py`
and rely on `_redirects` to block them. Rejected — a gitignore that fails closed
beats an edge rule that must be maintained. The plan's file paths are superseded
on this point only; everything else in the layout stands.

---

**D2 — `_redirects` blocks portal source files from being served.** ✅ operator-confirmed 10 Aug 2026

`schema.sql` documents the tables and every RLS policy — a map for anyone probing
the portal. `robots.txt` only asks politely. Netlify's `_redirects` enforces it at
the edge with no build step. Alternative: keep the SQL outside the repo entirely.
Rejected — the plan wants the schema in version control, and it is the main SQL
learning artifact.

---

**D3 — `activity_type_aliases` table added, beyond the plan.** ⚠️ new structure

The plan specifies `activity_type` as a lookup table. The live exports contain 23
distinct spellings for ~15 real activities (`Account Visit` / `account visit (PK)`,
`Drink List 1` / `drink list 2` / `drink list N/C`). A second table maps every raw
HubSpot string to a canonical type, so the loader can *fail loudly* on an unseen
value instead of dropping it. Alternative: clean the strings inside the loader.
Rejected — the mapping is data that changes, not logic; in a table it is
inspectable and editable without touching code.

---

**D4 — Activity taxonomy is admin-managed at runtime; imports never hard-fail on an unknown type.** ✅ operator-directed 10 Aug 2026

Superseded the original question. The operator's ruling: the activity vocabulary
("account sold", "case sold" and the rest) is *going to change*, so the system
must let an admin add and adjust types rather than have the mapping settled in
SQL by us. Individual mapping calls are explicitly not worth resolving now.

Built to match:
- `resolve_activity_type(raw)` — looks up the alias table; on an unknown value it
  creates the type, flags it `needs_review`, records the alias, and returns it. An
  undefined activity type can never cost a row. Blank/NULL routes to a single
  `unclassified` type instead of inventing one per empty value.
- `merge_activity_type(source, target)` — folds one type into another, moving
  activities *and* aliases, retiring the source rather than deleting it so the
  merge is reversible and no foreign key breaks. Re-importing the old raw string
  afterwards follows the merge instead of resurrecting the source.
- `v_activity_types_needing_review` — the admin's review queue, with the raw
  spellings each type has been seen as and how many activities it holds.

Both functions are `revoke`d from `public`/`anon`/`authenticated`: Postgres grants
EXECUTE to PUBLIC on new functions by default, which would have let any logged-in
brand user create activity types. The review queue view is staff-only for the same
reason. Tested — a brand login is refused on both functions.

---

**D5 — No write policies anywhere; the portal is structurally read-only.**

RLS is enabled with `SELECT` policies only, so all writes from the portal's
`anon`/`authenticated` keys are denied by default. Writes happen via the
`service_role` key from the Streamlit admin and the sync script, which bypass RLS.
Alternative: write policies scoped by brand. Rejected as premature — nothing in
Phases 1–5 needs a brand user to write. Phase 6 field entry adds them
deliberately, one at a time.

---

**D6 — Verify on the real target, not just locally.** ✅ CLOSED 10 Aug 2026 — and it caught a real bug

Originally logged as a gap: the schema was proven only against a local cluster
with a hand-written Supabase stub. The operator created the project the same day
and the schema was applied to it (Postgres 17.6).

**The gap was not theoretical.** On Supabase, `authenticated` held **33
INSERT/UPDATE/DELETE grants** that no local run ever showed. Cause: Supabase's
default privileges grant `ALL` on new objects in `public` to `anon` and
`authenticated`, so this file's `grant select ... to authenticated` *added* to
that default instead of replacing it. A stock local Postgres has no such default,
so the local harness was **more secure than production** and hid the whole class
of bug.

RLS was still holding — with no INSERT/UPDATE/DELETE policy, no row qualifies, so
those statements affect 0 rows (verified against the live database inside a
rolled-back transaction: 0 rows affected, 942 activities intact). The grants were
nonetheless removed, because they are one permissive policy or one dashboard
toggle away from mattering.

Two follow-ups, both done:
- `schema.sql` now revokes writes from `authenticated` and sets default
  privileges so future objects cannot reopen it.
- `test/00_supabase_stub.sql` now reproduces Supabase's default privileges, and
  `run.sh` asserts the grant counts. The local harness would now fail on this.

Standing lesson: local Postgres is not Supabase. Anything involving roles,
grants, or default privileges must be checked against the real project.

---

**D7 — Trigger derives `brand_venue_status` from activity type, ignoring deal stage.** ✅ operator-confirmed 10 Aug 2026

`sync_brand_venue_status()` advances a venue to `pitched` on any activity and
`placed` on a depletion activity, and never overwrites the human judgements
(`reordering`, `dormant`, `lost`). But HubSpot already carries deal stages
(`Closed won`, `Finalizing terms`, `Objection handling`, …) that are better signal
and are currently unused. Left out because the stage→status mapping is one of the
plan's own open questions and guessing it would bake in a wrong answer quietly.

---

**D8 — `python-dotenv` added as a dependency.**

The playbook treats dependencies as liabilities. This one is ~30 lines of
equivalent hand-rolled parsing, is the near-universal convention, and touches only
local scripts — not the deployed site, which has no dependencies at all. Added to
`Hubspot/automate_hurry/requirements.txt`.

---

**D10 — The `@` in the Supabase database password must be percent-encoded in `DATABASE_URL`.**

Not a design decision, a trap worth writing down. libpq splits a connection URI
at the **first** `@`, so a password containing one makes it read the rest of the
password as the hostname — the error is a DNS failure
(`failed to resolve host 'mpioncollege!23@db...'`), which points nowhere near the
real cause. Encoded as `%40` in `Hubspot/.env`, with a comment listing the other
characters needing the same treatment (`:` `/` `#` `?`). The password itself is
unchanged in Supabase.

---

**D11 — One `DATABASE_URL` for both local testing and Supabase.**

The loader and `apply_schema.py` take a single connection string rather than
having a "local mode". Supabase is plain Postgres, so the code path exercised by
`test_seed_integration.sh` against a throwaway cluster is byte-for-byte the code
path that runs against production. A local-only mode would have let the two
drift, which is exactly how "works locally" happens.

---

**D12 — Non-servable files live outside the website repo, not behind a redirect.** ✅ 10 Aug 2026

`_redirects` originally carried rules like `/portal/*.sql   /   404` to stop the
schema being downloaded. **Those rules do not work.** Netlify's `*` is a trailing
splat, not a filename glob, so `/portal/*.sql` matches nothing — `schema.sql`
would have been served at `ihospitality.vip/portal/schema.sql` while appearing to
be protected. This was caught before any deploy, but only by questioning a rule
that could not be tested locally.

`schema.sql`, the SQL test harness and the db README moved to
`Hubspot/portal_seed/db/`. The website repo's `portal/` now contains only the
five pages, `portal.css` and `portal.js`.

Standing rule: **if a file must not be public, it does not belong in the website
repo.** Do not reach for a redirect rule to hide something. Verified against the
live deploy preview — all four source paths return 404.

---

**D13 — `Hubspot/portal_seed/` is its own git repo.** ✅ operator-directed 10 Aug 2026

D1 put the Python outside the website repo for deploy safety, which left it with
no version history at all. It is now a separate repo with its own `.gitignore`
(secrets stay in `Hubspot/.env`, one level up and outside it), README and
`requirements.txt`. It has no remote — local only.

---

**D14 — The portal is demoed via a Netlify deploy preview, not production.** ✅ operator-directed 10 Aug 2026

Branch `portal-v1` + PR #1 produce a preview at
`deploy-preview-1--cool-dusk-e84d8f.netlify.app`, which is a complete working
copy against the live database. `ihospitality.vip` stays untouched until the PR
is merged. The preview lives only as long as the PR is open.

---

**D9 — `anon` lockdown placed at the end of `schema.sql`.**

Supabase's default privileges grant `anon` access to newly created objects in
`public`. Revoking mid-file would miss everything defined after that point,
including the three dashboard views. The revoke plus `alter default privileges`
runs last so it catches all of it, and stops future objects reopening the hole.

---

**D15 — The Supabase free tier pauses a project after 7 days of inactivity, and it looks like DNS failure.** 18 Aug 2026

The project went unreachable between 10 and 18 Aug. The symptom was
`failed to resolve host 'db.<ref>.supabase.co'`, which reads like a network or a
`DATABASE_URL` problem and is neither. Confirmed it was the project and not the
network by resolving the API host `<ref>.supabase.co` against three independent
resolvers (the ISP's, 8.8.8.8, 1.1.1.1) — all NXDOMAIN — while the shared host
`aws-0-us-east-1.pooler.supabase.com` resolved normally from the same machine.
A paused project is removed from public DNS entirely; both hostnames vanish.

Restored from the dashboard by the operator with no data loss: 942 activities,
297 venues, 11 brands, and the full grant/RLS posture all intact afterwards.

Two things follow. The demo preview stays live on Netlify while the database
behind it is gone, so the portal appears broken rather than offline — anyone
holding that URL sees errors. And **any gap of more than a week will do this
again**, which is an argument for the Pro tier once real brands have logins,
not merely for the storage headroom.

Standing lesson, alongside D10: a Supabase connection failure that presents as
DNS is far more likely to be a paused project than a bad connection string.
Check the dashboard before debugging the URL.

---

**D16 — Photos are stored as web-optimized derivatives; originals never leave the local library.** ✅ operator-confirmed 18 Aug 2026

The existing library is 465 MB of full-size originals against a 1 GB free-tier
storage cap, so uploading originals would exhaust the tier within one import.
Derivatives are resized to a 1600px longest edge at JPEG quality ~82 — roughly
200 KB each, which keeps thousands of photos inside the free tier.

One shared pure function, two entry points: the sync optimizes in flight
(download, resize in memory, upload) and a standalone batch script processes the
existing local library. EXIF is stripped except orientation, and
`DateTimeOriginal` populates `photos.taken_at` so the gallery sorts by when a
photo was taken rather than when it was imported.

Alternative considered: upload originals and pay for the Pro tier now. Rejected
as premature — originals stay in OneDrive, which is already backed up, so
regenerating larger derivatives later costs a re-run and nothing else.

**Accepted consequence:** 1600px is right for decks and social and wrong for
print, so a brand cannot pull a print-resolution file from the portal. Revisit
if one asks; the originals still exist.

This adds **Pillow**, a new dependency. Justified on the same grounds as D8: the
alternative is hand-rolled image decoding, which is not a 30-line job, and it
touches only local tooling — the deployed site still has no dependencies at all.

---

**D17 — The sync writes `notes` only, and never `brand_visible_summary`.** ✅ operator-confirmed 18 Aug 2026

The two columns exist so internal candour can never be published to a client by
accident. HubSpot note bodies are internal writing and go to `notes`; the
brand-facing summary is written by a human and stays under human control. An
importer that filled both would collapse the distinction the schema was built to
enforce.

**Known consequence, and it is currently visible.** `v_brand_activity_log`
exposes `brand_visible_summary as summary`, and `activity.html` renders it under
a "Notes" heading. Nothing populates it, so all 942 rows show a blank column
today. Writing those summaries is a Phase 5 admin screen. Until then the column
should be dropped from the UI rather than shown empty — logged as presentation
work, not fixed here.

---

**D18 — Password reset ships as static HTML, split out of Phase 5.** ✅ operator-confirmed 18 Aug 2026

PROGRESS listed password reset as Phase 5 work because that is where account
management lives. But Supabase does this with `resetPasswordForEmail()` plus one
new page, and it is the item gating real brand logins. Tying it to the Streamlit
admin would have made the smallest blocker wait on the largest build.

Alternative: build it inside the admin as originally planned. Rejected — same
result, months later.

---

**D19 — Build order resequenced: all data in, then analysis, then presentation.** ✅ operator-directed 18 Aug 2026

The operator's call, and the reason is sound: the build was moving to new
features while the foundation was incomplete. The order is now

1. **Everything in** — sync deals, notes, photos, city/market, then reconcile
   against HubSpot.
2. **Analysis** — purpose-built views for the questions actually asked monthly,
   chosen by the operator rather than guessed.
3. **Presentation** — sorting, clickable rows, and dropping columns that carry
   no data.

This supersedes the phase ordering in `PORTAL_PLAN.md` for sequencing only; no
phase's content changes.

---

**D20 — `consent_confirmed` gates the public gallery, not viewing inside the portal.** ✅ operator-confirmed 18 Aug 2026

Neither the `photos_select` RLS policy nor `photos.html` filters on
`consent_confirmed`, which defaults to `false`. That is harmless at zero photos
and stops being harmless the moment the sync runs.

Reading taken: the portal is private and brand-scoped, and a brand seeing a
photo of its own activation is not publication. The constraint carried over from
`GALLERY_PLAN.md` is about publishing identifiable people to the **public**
gallery, which is what `consent_confirmed` should gate.

**Operator ruling 18 Aug:** consent for every photo iHospitality uploads is
already covered by the terms and agreement signed for events and by employees.
So the portal needs no consent gate, and the sync sets `consent_confirmed = true`
on import rather than leaving the column's `false` default to be cleared by hand
on thousands of rows.

The column stays, with its meaning inverted in practice: `true` is the normal
state, and setting one to `false` is how a specific photo gets held back from
the public gallery — a bad shot, or someone who objects after the fact. That is
worth keeping, because it is the only per-photo control there is.

One case the blanket agreement does not obviously cover is a member of the
public caught in the background of an event photo, who signed nothing. That is
the operator's call to make, not a technical constraint; noting it here so the
question is on the record rather than assumed away.

---

**D21 — `recurring_case` is a reorder, and it was silently excluded from every units figure.** ✅ operator-ruled 18 Aug 2026

Asked what `recurring_case` was, the operator answered: **the venue reordered a
case; `case_sale` is the initial sale.** So the two are genuinely distinct and
must not be merged — the difference between winning an account and keeping one
is the most commercially meaningful distinction in the dataset.

The data did not reflect that. `case_sale` carried `is_depletion = true` and
`recurring_case` carried `false`. `v_brand_monthly_summary` computes
`units_moved` as `sum(quantity) filter (where t.is_depletion)`, so **51 reorders
— 5% of all activity, and the repeat business — were excluded from every
units-moved figure the portal has ever shown.** Corrected to `true`, and the
label changed from the auto-generated "Recurring Case" to "Case Reorder".

Measured effect on the live database: `units_moved` across all months went
**375 → 466**. The 91 units break down as 89 from the 51 reorders and 2 from the
tap merge below.

**Left undone deliberately.** `sync_brand_venue_status()` advances a venue to
`placed` on any depletion activity, so a reorder now advances it to `placed`
rather than to `reordering` — and `account_status_enum` has had a `reordering`
value sitting unused since Phase 1. Making reorders drive it is the obvious
next step and it changes D7's trigger, so it waits for a ruling rather than
being slipped in alongside a taxonomy fix.

---

**D22 — Five activity types merged; the vocabulary is now 21 active, not 26.** ✅ operator-ruled 18 Aug 2026

The exports carried near-duplicate types that would have quietly skewed every
Stage 2 pivot — "how many tasting events" answered 35 when the true figure was
37. Operator ruling: `tap_maintenance` is a genuinely different activity, the
other three tap types are one thing, and the remaining pairs are duplicates.

| merged | into | activities moved |
|---|---|---|
| `tasting_event_split` | `tasting_event` | 2 |
| `day_buy_out_comp` | `day_buyout` | 1 |
| `barrel_prep_charge` | `barrel_prep` | 1 |
| `tap_cocktail` | `tap_placement` | 2 |
| `tap_with_labor` | `tap_placement` | 0 |

Run through `merge_activity_type()`, which moves the activities *and* the
aliases and then retires the source rather than deleting it — so re-importing an
old HubSpot spelling follows the merge instead of resurrecting the type, and the
foreign keys never break. Verified after: 942 activities unchanged, 0 orphans,
review queue down from 11 to 5.

**Done before Stage 2, not after, and that ordering is the point.** Analysis
built on an unmerged taxonomy produces numbers that are wrong in a way nobody
notices, because every individual figure looks reasonable.

Five types still await a ruling: `aspen_green_fresh_market_incentive` (9),
`unclassified` (8), `promo_specialist` (1), `single_barrel_sale` (1),
`5l_barrel` (1).

---

**D23 — The blank-brand deals are archived on purpose, and the portal is now the better record of them.** ✅ operator-explained 18 Aug 2026

The backfill skipped 80 deals for having no `brand` property, 75 of which exist
in the database with a correct brand carried over from the CSV exports. The
worklist built to "fix" them in HubSpot was **the wrong recommendation** and is
withdrawn.

Operator's explanation: those deals were **archived in HubSpot, and the brand had
to be removed from the deal before it could be archived.** The blank field is the
consequence of a deliberate action, not a data-entry lapse. Refilling it would
fight the archiving workflow — and the shape of the data agrees, since the
affected deals cluster on brands that have gone quiet (Starr Rum's last activity
is 17 Dec 2025, Heavens Door's 6 Aug 2025).

**Three consequences worth stating.**

1. **Do not refill those fields.** `hubspot_missing_brand_worklist.csv` should be
   ignored for the 75 known rows. The 5 unknown ones are probably archived Starr
   Rum deals on the same reasoning, and are the only entries still worth a look.

2. **The portal now holds history HubSpot has deliberately discarded** — which is
   the first concrete instance of the plan's stated goal, that this becomes
   iHospitality's own system of record rather than a HubSpot mirror. The CSV
   exports captured a brand attribution that the live API can no longer supply.

3. **Those 75 rows are now irreplaceable and must be protected.** The sync only
   inserts and updates, never deletes, so a normal run cannot harm them. But
   `seed_from_csv.py --truncate` would wipe them and no re-run from the API could
   restore them. **Treat `--truncate` as destructive from this point on**; it was
   merely inconvenient before.

Open question left with the operator: `brands.is_active` exists and every brand
is currently `true`. Starr Rum and Heavens Door look dormant rather than active.
Marking them would keep them out of admin pickers without deleting any history.

---

**D24 — The HubSpot deal name is the brand-facing summary.** ✅ operator-ruled 18 Aug 2026

`brand_visible_summary` was empty on all 1,070 activities, leaving the activity
log's Notes column blank and giving photos no context. The plan was a Phase 5
screen for writing summaries by hand. The operator's ruling removes the need:
**the deal name already says what happened** — "sold in a case of 44 North to
liquor store" needs no second sentence written on top of it.

The deal name was being requested from the API and thrown away; `activities` had
no column for it. Added `activities.title`, populated by the sync, and
`v_brand_activity_log.summary` is now
`coalesce(brand_visible_summary, title)` — so a hand-written summary still wins
where one exists, and the portal does not need to know which it got.

**Audited before adopting it**, because this puts internal text in front of
clients: 400 names from 2026 — none blank, none mentioning price, comps or
discounts, none negative, mean length 31 characters. Ten name a person at the
account ("Account Visit w/ Hunter BM"), flagged to the operator as their call.

The distinction that makes this safe: a deal **name** is written to be read by
whoever opens the record, while a note **body** is written candidly. Only the
former is safe to publish. `notes` stays internal (D17).

Coverage is 995 of 1,070. The 75 without a title are exactly the archived deals
from D23, which independently confirms that finding. Their names do exist in the
CSV exports if backfilling them is ever wanted.

---

**D25 — Photos are deduplicated by content hash, scoped per activity.** ✅ operator-approved 18 Aug 2026

`hubspot_file_id` stops one file importing twice but cannot stop the same
photograph being uploaded to HubSpot as two files and attached to two notes on
one deal. That is not hypothetical: of the first five photos imported, **only
four were distinct images**.

`photos.content_hash` holds a SHA-256 of the **optimized** bytes, not the
original — two HubSpot files can differ byte-for-byte while being the same
photograph, and optimisation normalises them to identical output, so hashing the
source would miss exactly the duplicates worth catching.

The unique index is on `(activity_id, content_hash)` rather than the hash alone:
two different activities legitimately sharing an image (a product shot used at
two venues) is not an error, while the same image twice on one activity always
is. Backfilling the hash over the existing five rows made the index reject the
duplicate immediately; that row and its storage object were removed.

---

**D26 — Photos are organised by activity, never as an undifferentiated wall.** ✅ operator-directed 18 Aug 2026

Operator: *"I don't want all the photos just there without any kind of reason
behind them."* Three defects underneath that instinct, all confirmed:

1. **The gallery sorts by a column that is always empty.** `photos.html` orders
   by `taken_at`, and every HubSpot photo has `taken_at` NULL — HubSpot's file
   tool strips EXIF on ingest, so the shutter time is gone before we see it
   (every sampled photo came back exactly 1200×1600 with no metadata). The order
   is therefore arbitrary. It must sort by the activity's date.
2. **Duplicates would appear** — fixed by D25.
3. **Nothing supplied the reason** — fixed by D24; a photo's context is its
   activity's title, date, venue and type.

Agreed shape: photos group under their activity, headed by date · venue ·
activity type and the title. **No per-photo captions** — one line per visit
covers the group, and writing one line per photo forever does not scale.

Staff browsing is month first, then a brand filter inside the month, matching
how the activity table is meant to navigate. Clicking a photo through to its
activity page is wanted but explicitly deferred by the operator.

---

**D27 — Expense-pipeline deals are flagged, and their attachments never reach the gallery.** ✅ operator-directed 18 Aug 2026

Late but decisive instruction from the operator: *"we should not be taking
photos that are listed on the expense pipeline."* HubSpot runs two deal
pipelines — "Client Acquisition" (1,071 deals, the field work this portal
exists to show) and **"Expense"** (id `890766181`, 5 deals). Attachments on
expense deals are **receipts**: card digits, totals, unrelated line items.
Internal financial paperwork, not proof of work.

**This was caught before any damage, but only just.** All 5 expense deals were
already loaded as activities, and the photo pipeline had no notion of a
pipeline at all. The first live photo run happened to cover August while the
expense deals fall in April and July, so nothing was imported — luck, not
design. The full backfill would have pulled every receipt into brand-facing
galleries.

Built as `activities.is_expense`, derived at sync time from the `pipeline`
property. Two deliberate choices:

- **Flagged, not filtered out at import.** The expense rows are still real
  activity ("44 North @ Prime Catch - prizes or contest") and discarding them
  would lose the record. Only their *photos* are refused.
- **Excluded in `fetch_activities()`'s SQL, not at the download step.** Filtering
  at the source query means no later mistake in `sync_photos.py` can reach a
  receipt: it is never listed, never downloaded, never optimised, never
  uploaded.

An unknown or missing pipeline resolves to `is_expense = false`, tested
explicitly. That failure direction is deliberate: wrongly including a normal
deal is visible in the gallery, wrongly excluding one is silent.

**Still open for the operator:** those 5 expense activities remain visible to
brands in the activity log, since the ruling covered photos only. "44 North @
Prime Catch - prizes or contest" may be legitimate proof of work, or may be
something billed to the brand and better hidden. Needs a ruling.

---

**D28 — Expense activities stay visible to brands; only their photos are withheld.** ✅ operator-ruled 18 Aug 2026

Follow-up to D27. The five expense-pipeline activities remain in the brand-facing
activity log — "44 North @ Prime Catch - prizes or contest" is real work done for
the brand and worth showing. It is only the **attachments** that are refused,
because those are receipts.

This is why D27 built `is_expense` as a flag rather than filtering the rows away
at import: the ruling landed on the side the flag already supported, and no
re-import was needed to honour it.

---

**D29 — The month roll-up is one view for both audiences, and it had to be SQL.** ✅ operator-requested 18 Aug 2026

The staff dashboard showed August as "3 activities". The real figure is 29. It
was rendering one row per *(brand, month)* from `v_brand_monthly_summary` with
no brand column, so August appeared four times and the headline card read
whichever brand happened to sort first — Dame Mas, with 3.

`v_monthly_summary` groups by month alone. Because it runs `security_invoker`,
RLS filters the underlying activities *before* the aggregate: a brand user gets
their own months, staff get every brand combined into one row per month. One
definition, no staff-only variant to keep in step, and no path by which a brand
user can see a cross-brand total. Verified against all three real logins, plus
`anon`, which is refused outright.

**Why this could not be a JavaScript sum.** `venues_touched` is a
`count(distinct venue_id)` *per brand*, so a venue two brands both visited is 1
in each row and adding them gives 2 for one venue. Measured on live data, naive
summing overstates venues by **7 to 14 per month**. Activity counts, units and
photos are additive; the distinct count is not, and only SQL can recompute it at
the coarser grain. Everything else on these pages — sorting, filtering, grouping
— stays in the browser, where it belongs.

Two smaller staff-only bugs fixed alongside: the "Venues, all time" card counted
rows of `v_brand_venue_counts`, which holds one row per brand/venue *pair* (596
pairs over far fewer venues), and the date range read `data[0]` for both ends.

A SQL note worth keeping: the first draft counted photos with a correlated
subquery on `a.activity_date` and Postgres refused it — that column is not in
the `GROUP BY`, only `date_trunc()` of it is. Rewritten to aggregate photos to
the same grain and join, matching `v_brand_monthly_summary`. The rejection was
lucky: a naive direct join would have fanned each activity into N rows and
quietly multiplied every sum.

---

**D30 — Sorting lives in the browser; aggregates live in SQL.** ✅ 18 Aug 2026

`sortableTable()` in `portal.js` replaces `table()` on the pages that need it,
keeping the drop-empty-columns behaviour and adding click-to-sort, keyboard
support, and optional row navigation.

The line: a view per sort order would be a dozen views all saying the same
thing, and at ~1,100 activities the browser reorders instantly. Aggregates stay
in SQL because they are correctness-critical (D29 is the proof); ordering is
presentation.

Three details that are deliberate:
- Dates sort on the raw ISO value, not the rendered one — "Aug 11, 2026" sorted
  alphabetically lands nowhere near August.
- Blanks always sink to the bottom regardless of direction. A screen of
  em-dashes at the top is never what someone was asking for.
- A new column starts descending, which is right for dates and counts alike.

The Brand column appears only when more than one brand is present in the rows,
so staff get it and a brand user never sees a column containing only their own
name — neither page needs to know which kind of user it is serving.

Drill-down is `activity.html?month=YYYY-MM`, validated against a strict
year-month pattern rather than trusted, and shown as a dismissible chip. No
router, no build step — consistent with the locked no-npm decision.

---

**D31 — `sync.py` is the single command; `pillow-heif` is the third dependency.** ✅ operator-requested 18 Aug 2026

**One command.** `sync.py` wraps the deal and photo syncs, which must run in
that order — a photo hangs off an activity, so importing photos first finds
nothing to attach them to. It stops if the deals step fails rather than
reporting a clean photo run over incomplete data, and drops the `--limit`
guardrail that only existed while the photo sync was being built. The four
reasons a photo will not appear are in `--help`, so the answer does not live
only in a chat log.

**`pillow-heif`.** iPhones shoot HEIC by default and Pillow cannot decode it
unaided — that was the entirety of the "6 image could not be decoded" failures
in the first backfill. Six real photos, and a share that grows as more people
shoot on phones. Justified on the same grounds as D8 and D16: local tooling
only, the deployed site still has no dependencies at all, and the alternative
is not writing 30 lines but implementing an image codec.

Registered at import time, not inside `optimize()`: per-call registration would
re-run for every photo, and a caller importing the module for its other
functions would get format support that depended on call order. Four regression
tests build a real HEIC in memory and assert it decodes, emerges as JPEG, and
resizes like anything else — so if the registration is ever dropped, the tests
fail rather than the photos quietly vanishing.

Result: **412 photos**, 393 distinct images. The 19 non-distinct ones are the
same photograph on *different* activities, which the per-activity uniqueness of
D25 deliberately permits — one photo of a joint event legitimately belongs to
both brands' records, and each brand sees it in their own gallery.

---

**D32 — The gallery is built on `v_brand_photos`, grouped by activity.** ✅ 18 Aug 2026

Implements D26. A new view carries each photo together with the activity that
gives it meaning — date, venue, activity type, and the deal name as `summary` —
so the page runs one query instead of nested joins, and so what a brand can see
is decided in SQL rather than assembled in the browser.

Four changes from the old gallery, each fixing something real:

1. **Ordered by `activity_date`, not `photos.taken_at`.** HubSpot strips EXIF on
   upload, so `taken_at` is NULL for all 412 photos and the old page was sorting
   on an empty column — the order was arbitrary. The activity date is also the
   better key: it is when the work happened, not when a shutter fired.
2. **Grouped by `activity_id`, not by `date|venue`.** The old key merged two
   different activities at one venue on one day into a single unlabelled block.
3. **Every group is headed by what happened** — the deal name, then date · venue
   · type · count. This is the whole point of the operator's objection: a photo
   with no reason attached is not proof of anything.
4. **Month first, then brand and type.** The month picker defaults to the most
   recent month rather than to everything. 412 images at once is a slow page and
   is precisely the wall the structure exists to avoid.

Signed URLs are minted only for the visible subset and cached per session, so
changing filters never re-signs what is already signed. The lightbox walks
photos in *display* order, so its arrows follow what is on screen rather than
the unfiltered list.

Per-photo captions stay out (D26). `caption` is exposed by the view but is
expected to be NULL — it is deliberately not filled from the HubSpot note body,
which is internal writing (D17).

**Verified:** `v_brand_photos` returns 412 rows for staff and 46/45 for the two
brand logins, each seeing exactly one brand; the page's module graph executes in
a real browser with zero console errors before the auth redirect; JS
syntax-checked with node. **Not verified: the rendered gallery itself** — that
needs a login, and entering a password is out of scope for this session. The
data layer beneath it is checked; anything wrong will be layout.

---

**D33 — Cities are recorded; `market` is not, because the business is expanding.** ✅ operator-ruled 18 Aug 2026

The two-value `market_enum` (`central_florida`, `palm_beach_county`) left roughly
90 venues unclassifiable — Melbourne, Cocoa Beach, Palm Bay, Satellite Beach,
Tampa, Miami Beach, Jacksonville, Port St Lucie. The question put to the operator
was whether to add a third market. The answer reframed it: *"it shouldn't matter
if in or out of market. We are in the midst of expanding so let's not cap
ourselves."*

So `venues.city` is populated and **`venues.market` stays NULL on every row**.
The enum is left in place — it still enforces the positioning rule if anything
ever writes to it — but nothing classifies a city into it. A schema constraint
written to protect brand-facing language was quietly becoming a constraint on
where the business could be seen to operate; that is the wrong job for it.

Cities arrive **through the sync**, not from a one-time CSV load: `city` was
added to the company batch read, so venues stay current as HubSpot changes. Two
details that matter — city is written with a separate UPDATE rather than in the
venue INSERT, because 349 venues already existed before the column was populated
and the insert loop skips anything already cached; and the update uses
`coalesce` semantics so a value entered by hand is never blanked by an empty CRM
field.

Result: **317 of 349 venues** carry a city. **64 sit in cities the old rule would
have discarded** — Melbourne 26, Tampa 14, Cocoa Beach 10, Jacksonville 6,
Palm Bay 5, Port St Lucie 3.

---

**D34 — Three analysis views, one per question actually asked.** ✅ operator-approved 18 Aug 2026

Not a generic pile of views. A view nobody reads is worse than no view, because
it still has to be kept correct. All three are `security_invoker`, so RLS answers
each question at the asker's own scope from a single definition.

| view | the question |
|---|---|
| `v_activity_mix` | "How many staff trainings for this brand, or overall?" |
| `v_venue_performance` | "Which venues are reordering, and which have gone quiet?" |
| `v_city_summary` | "Where are we actually working?" |

**Two of the three depended on earlier rulings, which is the argument for having
done the data work first.** `v_activity_mix` is only trustworthy because of the
taxonomy merges (D22) — before them, counting tasting events returned 35 when
the honest answer was 37. And `v_venue_performance` only became possible once the
operator explained that `recurring_case` is a reorder and `case_sale` the initial
sale (D21); until then, winning an account and keeping one were indistinguishable.

`v_venue_performance` is at brand × venue grain, because Blue Run reordering
somewhere says nothing about whether Wodka is.

**A data observation this surfaced:** some venues show reorders with zero
recorded initial sale — Sable (Club Allenby) has 4 reorders and no `case_sale`.
Either the first sale was logged under another activity type or it predates the
imported data. Worth a look before these numbers are shown to a brand.

---

**D35 — Reorder counts are a measurement artifact, not a performance ranking.** ✅ operator-explained 18 Aug 2026

`v_venue_performance` showed Wodka holding almost every reorder in the database
— 66 of 68, with 44 North holding the other one and every remaining brand at
zero. That reads as a product performance story. It is not one.

Operator's explanation: **Wodka was the first brand tracked for reorder rates,
and the first that pays for that tracking.** Dame Mas pays too, but its price
point means it sells by the bottle rather than the case, so its repeat business
never appears as `recurring_case` at all — 62 case sales, zero reorder rows.

So a zero in the Reorders column means **"not measured for this brand"**, never
"no repeat business". Shown to Dame Mas or 44 North as a column of zeroes it
would be actively misleading about their own accounts.

Handled by the drop-empty-column behaviour already in `sortableTable()`: a
column whose every value is 0 is not rendered. A brand with no reorder tracking
simply never sees the column, and staff — who can see Wodka's — do. Neither page
needs to know which case it is in.

**Left for the operator:** if reorder tracking expands to other brands, or if
bottle-level repeat business should be counted, the activity taxonomy needs a
type for it. `recurring_case` is a case-shaped word for a case-shaped fact.

---

**D36 — The venues page is driven by `v_venue_performance`, and the market filter is gone.** ✅ 18 Aug 2026

Rebuilt on the analysis view, adding sales, reorders, units and days-quiet, all
sortable, defaulting to quietest-first — the order that answers "who needs a
visit".

Three things the rebuild fixed or avoided:

1. **The Market filter was dead.** Market is NULL on every venue since D33, so
   that picker filtered on nothing. Replaced with **City**, which 317 of 349
   venues now carry.
2. **The first `v_venue_performance` inner-joined activities**, which dropped
   every venue with none — 22 accounts, and precisely the ones worth chasing.
   Rebuilt from `brand_venue_status` with activities LEFT JOINed, the same trap
   `v_brand_venue_counts` already documents. Row count went from a silent 574 to
   the correct 596.
3. **"Quiet" counts only accounts that have actually been visited.** A venue
   never visited has `days_since` NULL, which is a different problem from one
   that has gone quiet; counting them together would hide both. Never-visited
   rows sort to the bottom rather than the top.

Days-quiet is colour-coded at 90 and 180 days, and sorts on the raw day count so
"412 days" outranks "90 days" instead of sorting as text.

---

**D37 — Five brands marked inactive; the flag is currently a label, not a behaviour.** ✅ operator-directed 18 Aug 2026

`is_active = false` on **Blue Run, Barmen 1873, Starr Rum, Five Trail, Heavens
Door**. The activity data agrees with the call — last activity 15 Mar, 26 Feb,
17 Dec 2025, 7 Mar and 6 Aug 2025 respectively, against 13 Aug 2026 for the
four that remain active.

Still active: 44 North, Wodka, Dame Mas, Aspen Green, plus `All Brands` and
`iHospitality`, which are the two non-client rows nobody has ruled on yet.

**Stated plainly because it would otherwise be assumed:** nothing reads
`brands.is_active`. No view, no RLS policy, no portal page filters on it, so
these five brands still appear everywhere they did before. The column is a
record of a decision, not an enforcement of one. Deliberately not wired into the
portal without a ruling: hiding a dormant brand's history from a staff view is
the kind of "helpful" change that loses data in front of someone.

No brand matching "Coors" or "Molson" exists in the database. Barmen 1873 and
Five Trail are both Molson Coors whiskeys, so the operator's phrasing is read as
describing them rather than naming a twelfth brand.

---

**D38 — Dame Mas bottle sales exist outside HubSpot and are NOT imported yet.** ⚠️ awaiting operator input

`Ihospitality/Dame Mas/Dame Mas 2026 - Account Sold Summary.csv` — 18 venue
rows, **100 bottles, $16,577.30**. The operator: Dame Mas reorders sometimes
never reach HubSpot "because of how the reporting is sent to us".

This is the concrete instance of D35's open question. Dame Mas sells by the
bottle, `recurring_case` is a case-shaped word for a case-shaped fact, and so
Dame Mas shows 62 case sales and zero reorders while genuinely reordering.

**Deliberately not imported**, because four things cannot be resolved from the
file:

1. **Three of the four sections have no month.** Section 1 is headed "April";
   sections 2, 3 and 4 are headed "Accounts". Every activity needs a date, and
   guessing which months these are would put invented dates in front of a
   client.
2. **What "Pods" counts is unknown** — it sits between Bottles and Total and is
   usually 1 or 2.
3. **No activity type fits.** Loading bottles as `case_sale` would corrupt both
   the unit counts and the case/reorder distinction that D21 established.
4. **One cell is visibly corrupted**: SECOND RODEO reads bottles 12, pods
   "1,967", total $1,966.50 — the total has spilled into the Pods column.

**Venue matching is 10 of 18, and two of those ten are suspect.** "EXECUTIVE
CIGAR SHOP & LOUNGE, SANFORD" matched an existing "Executive Cigar" in
*Melbourne*, and the same file separately lists "Executive Cigar, Melbourne" —
so those are two locations, not one. "CITY DOG CANTINA #11529" matched "City Dog
Cantina #2". Both are exactly the wrong merge `normalize.py` refuses to make
automatically; they need a human, not a fuzzy matcher.

---

**D39 — `case_equivalent` makes bottles and cases comparable; units stay in their own unit.** ✅ operator-informed 18 Aug 2026

Six bottles make one case (operator). Without that factor, importing 100 bottles
as depletion `quantity` would have added bottles to cases in every `units_moved`
figure across five views — the comparability problem D35 named, made concrete.

`activity_types.case_equivalent` holds the factor: 1 for the case types, 1/6 for
the two new bottle types. **`quantity` stays in the activity's own natural unit**
so a row still matches the document it came from — 12 bottles reads as 12 — and
the views multiply. Default 1 means no existing number moved; verified
byte-identical across all five views before and after.

Two SQL traps, both worth remembering because `create or replace view` hides
them until you run it:

- **It cannot change a column's data type.** Adding `::numeric(12,2)` turned a
  working replace into "cannot change data type of view column units_moved",
  and rolled back the whole apply — including the `alter table` that had already
  succeeded.
- **It matches columns by POSITION.** Inserting `pods_total` before
  `photo_count` reads as renaming every column after it. New view columns go at
  the tail, always. Hit three times in one session.

And a numeric wart: 6 × 0.166667 is 1.000002, so the sums are rounded to 2dp. A
dashboard reading "1.000002 cases" is a bug report waiting to happen.

---

**D40 — `activities.pods` and per-row `amount` are BRAND-FACING.** ✅ operator-ruled 18 Aug 2026

Both were first built as internal — pods as a line in `notes`, amount exposed
only as a monthly total. The operator corrected it: **iHospitality is paid a
percentage of sales plus a bonus based on pods**, so a brand cannot check what
it is billed without seeing both at row level.

Pods therefore gets a real column rather than free text. A number a client is
paid against cannot live in an internal field they never see.

Checked before exposing `amount`, since brand-facing money deserves it: only 89
of 1,070 HubSpot rows carry one, all small (max $200), and `total_amount` was
already visible in the monthly views — so this is the same information at row
grain, not a new disclosure.

`activities.external_ref` was added alongside: a unique, nullable idempotency
key for rows with no HubSpot deal. Same pattern as `hubspot_deal_id`, and the
mechanism Phase 6 field entry will need rather than a second meaning bolted onto
the HubSpot column.

---

**D41 — Dame Mas bottle sales: 13 of 18 rows imported, and the gap is the majority of the value.** ⚠️ incomplete by design

Imported 13 rows — **57 bottles, 19 pods, $7,973.30** — across April to July
2026. Dame Mas now shows 11 bottle reorders and 2 bottle sales where it
previously showed no repeat business at all.

**Update, same day:** the Sanford location was **bought out and now trades as
Barrel & Blend**, which was already in the portal with six activities against it
— including two Dame Mas visits in April and May 2026. Mapped onto it, so one
premises' history stays in one place rather than splitting across its old and
new trading names. That row (24 bottles, 2 pods, **$3,933** — the file's largest)
imported as a *sale* rather than a reorder, correctly: Dame Mas's earlier visits
there were an Account Visit and a Tasting Event, neither a depletion.

**Four rows remain skipped**, their venues not yet identified: O-Ku, Pescado
Seafood Grill, Eden Lounge, Rachels World Class Mens Club.

Position now: **$11,906.30 of $16,577.30 imported**, 21 pods, 73 bottles.
**$4,671.00 still missing** — Eden Lounge $2,458.50, Rachels $1,966.50, and the
two Inlet Beach venues at $123 each. `--create-venues` loads them once the names
are settled.

The Executive Cigar pair is a good illustration of why fuzzy matching is refused
here: two venues sharing a trading name, in different cities, only one of which
was sold, and the sold one now answering to a third name entirely.

Skipping rather than creating is the reversible choice: three of the first eight
unmatched names turned out to exist under another spelling — "Gleneagles" missed
"Gleneagle" by one letter — and a duplicate venue splits one account's history
in two.

Rules applied, worth re-checking against reality: dates land on the **last day**
of each month (the summary gives no day, and the last day cannot claim a sale
happened before it did); and **sale vs reorder** is inferred as "earliest
depletion at this venue is the sale, anything later is a reorder", counting
existing HubSpot case sales — so a venue that bought cases in March and bottles
in April reads as a reorder.

---

**D42 — The rate card carries TWO rates, because charge and cost are different numbers.** ✅ operator-directed 18 Aug 2026

The instruction that forced it: *"For 44 North we don't charge them back for
reorders just the initial case. But we do pay our contractors for reorders so we
need to be aware of which are reorders or not."*

One rate per activity cannot express that. `rate_card` therefore holds
`charge_rate` and `pay_rate` as separate columns, plus `charge_pct` / `pay_pct`
for money that is a percentage of the sale rather than a rate per anything.

Keyed on `source_activity_type` — the raw string — because the sheet prices
"tasting event", "tasting event N/C" and "Tasting Event Split" at $150, $0 and
$100 while all three resolve to one type (D22).

**Staff-only, and this is the one policy that must not soften.** A single row is
one brand's price; the table is every brand's price side by side. Verified: a
brand login sees 0 rows. The operator's own point stands though — per-activity
*fees* are safe to show a brand, because RLS means they only ever see fees on
their own rows. It is the card that is sensitive, not the number.

---

**D43 — Two rate lookups per activity, not one. This was a real bug.** 18 Aug 2026

`v_activity_money` first resolved charge and pay in a single `DISTINCT ON`.
Charge rates are brand-specific rows; contractor pay is mostly a shared row with
`brand_id` NULL. So the brand-specific charge row won and **every pay rate was
silently discarded** — cost came out $0 for all five brands that had charges,
and 67 Wodka reorders reported $670 charged against nothing paid.

Fixed with two lateral joins, each resolving against the best row that actually
carries that side, both preferring a brand-specific line over the shared
default. Cost went from $0 to $12,560.

Caught only by reading the numbers. The view ran without error and returned a
plausible-looking table; a margin equal to revenue is exactly the sort of wrong
that survives a green test suite.

**A second bug in the same family:** the bottle importer had
`source_activity_type` in its INSERT but not in its `ON CONFLICT DO UPDATE`, so
all 14 already-existing rows kept it NULL through a run reporting "14 updated".
Adding a column to an upsert means adding it in **both** halves.

---

**D44 — Dame Mas: `amount` is gross sales; 10% to iHospitality, 8% to the contractor, 2% kept.** ✅ operator-confirmed 18 Aug 2026

Briefly ambiguous and worth recording, because the two readings differed by a
factor of ten. The operator first said the figures in the summary were already
iHospitality's 10%. The data said otherwise: $163.10 a bottle overall, with
$163.88 recurring exactly — a bottle price, not a tenth of one. Had it been the
10%, gross would have been $1,631 a bottle.

Confirmed: **Extra Añejo $210.75, Reposado $123.00**, both present as pure rows
in the data; the intermediate per-bottle figures are mixed-expression orders,
which is precisely what `pods` counts.

So `amount` is gross sales. iHospitality charges 10% of the monthly depletion
total, the contractor receives 80% of that — 8% of sales — and 2% is kept.
Verified against the live data at **10.00% / 8.00% / 2.00%** exactly.

The lesson worth keeping: a per-unit sanity check settled in one query what the
description alone could not. When a money figure has two readings, divide it by
something physical.

---

**D45 — Account visits are $0 for every brand, stated rather than left absent.** ✅ operator-ruled 18 Aug 2026

*"We do not charge any brand for account visits."* Loaded as an explicit $0 with
`brand_id` NULL, not left out of the rate card.

The distinction matters more than it looks. A **missing** rate reads as
"unpriced", which inflates the gap count and makes every margin beside it look
understated. An explicit **$0** says "we know, and it is free". Dame Mas alone
had 102 account visits sitting in that gap. Overall unpriced fell from 367 to
193 — over half the apparent gap was this one rule.

---

**D46 — The Dame Mas invoice recap independently validates the whole import.** ✅ 18 Aug 2026

The operator's 2026 recap gives a Commission figure per month. Checked against
what the portal computes from the bottle data:

| month | portal | invoice | |
|---|---|---|---|
| April | $690.16 | $960.60 | short $270.44 |
| May | **$266.93** | **$266.93** | exact |
| June | $212.48 | $409.13 | short $196.65 |
| July | **$21.08** | **$21.08** | exact |

Two months match to the cent, and **both gaps are exactly 10% of the venues
still unidentified** — $270.44 is a tenth of April's missing $2,704.50 (O-Ku,
Pescado, Eden Lounge) and $196.65 a tenth of June's Rachels at $1,966.50.

One check therefore confirms four separate things at once: the section-to-month
mapping (April, May, June, July), that `amount` is gross sales rather than a
commission, that the rate is 10%, and precisely which rows are still missing and
what they are worth. Worth more than any test written against our own
assumptions.

The recap also shows Dame Mas on **$750 a month consulting**, where the
chargeback sheet's retainers run $975–$1,850 — so Dame Mas is a different
arrangement, not an omission from that sheet.

---

**D47 — `business.html`: an internal page, and the first use of `brands.is_active`.** ✅ operator-requested 18 Aug 2026

Charge, cost and margin per brand, with a toggle between current brands and all
of them — which is what finally gives `is_active` (D37) a job after being set as
a label that read nothing.

Three deliberate choices:

- **Unpriced counts sit beside the margin, in amber.** Every unpriced activity
  makes the number next to it an understatement, and a margin shown without
  that context invites a decision it cannot support.
- **A second table lists exactly what is unpriced**, by brand and by the string
  HubSpot actually wrote — so the gap is a worklist rather than a complaint.
- **Nav link hidden for brand users, but that is convenience, not the gate.**
  The money comes from `rate_card`, whose RLS is staff-only, so a brand user
  reaching the URL reads nulls. Verified: a brand login sees 91 of its own
  activity rows with 0 charges and 0 costs, and 0 rate-card rows.

---

**D48 — The four Dame Mas venues created; every month now reconciles to the invoice.** ✅ operator-approved 18 Aug 2026

*"All those locations for Dame Mas are what we charged for so I guess add."*
Created O-Ku, Pescado Seafood Grill, Eden Lounge and Rachels World Class Mens
Club, and imported their rows — the last of the 18.

| month | portal | invoice |
|---|---|---|
| April | $960.61 | $960.60 |
| May | $266.93 | $266.93 |
| June | $409.13 | $409.13 |
| July | $21.08 | $21.08 |

**April is one cent high, and that is left visible rather than forced.** Each
row's 10% is rounded to cents before summing, so fourteen roundings drift a
penny. Rounding once at the end would match the invoice exactly but would
misstate every individual row; the per-row figure is what an account manager
reads. A penny of documented drift beats a hidden reconciliation.

Holding these venues back until the operator identified them was the right call
in the end — three of the first eight unmatched names turned out to exist under
another spelling, and Rachels genuinely was missing from a system it should have
been in.

---

**D49 — Aspen Green's fresh-market incentive is $100 each, and stays priced although the programme ended.** ✅ operator-ruled 18 Aug 2026

Earlier ruled "ignore these", then corrected: $100 apiece, nine activities, and
the programme no longer exists. Priced anyway — history does not stop being true
when a programme stops running, and a margin that silently omits $900 of real
revenue is wrong in the direction that flatters nobody.

Aspen Green moves from **−$385 to +$800**.

---

**D50 — `All Brands` retired; `iHospitality` and the archived brands left alone.** ✅ operator-directed 18 Aug 2026

- **All Brands** was a device for grouping brands to make reporting easier, and
  nothing under it was ever chargeable — mostly account visits and drink
  development. Marked inactive, so the business page's "current brands" view
  drops it and its 21 unpriced activities stop reading as a gap.
- **Starr Rum and Heavens Door** — to be archived; already inactive (D37). Their
  75 unpriced activities are expected and need no rates.
- **iHospitality** is the internal brand, for charging work back to the company.
  Out of scope for now, by instruction.

Left as-is: `account sold`, 74 activities. **56 of them are Dame Mas**, and
their deal names read as placements and reorders ("Dame Mas Repo reorder at City
Dog Cantina"). If those are what the depletion report bills, charging them
separately would double-count against the 10% commission — so they stay unpriced
until the operator rules, which is the safe direction. The other 18, across four
brands, look like ordinary case sales.

---

**D51 — `account sold` is a placement, not a billing event. It was never going to reconcile.** ✅ established 18 Aug 2026

The operator asked whether the `account sold` rows line up with the monthly
commission on the Dame Mas invoice recaps. Tested across all thirteen months
those recaps cover (Jul 2025 – Jul 2026) by dividing each month's implied gross
(commission × 10) by that month's `account sold` units. A plausible answer would
land between the two known bottle prices, $123.00 and $210.75.

**Eleven of thirteen months do not.** Implied unit prices run to $933 (Oct
2025), $1,364 (Jun 2026) and $2,401 (Apr 2026), and July 2026 was billed $21.08
with **no `account sold` rows at all**.

April 2026 settles it, because both sources exist for that month: the depletion
summary lists **10 venues and 59 bottles**, while HubSpot holds **3 account-sold
events totalling 4 units**.

So the two record different things. **`account sold` is a new placement** — an
account being sold into. **Commission is billed off the monthly depletion
report**, every bottle moved across every account. They were never the same
number.

Two consequences:

1. **Do not price Dame Mas `account sold` at a case rate.** It would not match
   the invoice and would double-count against the 10%. Leaving those 56
   activities unpriced was correct, not a gap to close.
2. **The depletion summaries are the only billing source**, and four of thirteen
   months exist. Missing: Jul 2025 – Mar 2026, worth **$2,307.75** of 2025
   commission plus **$1,020.53** across Jan–Mar 2026.

The operator's own test still applies in the other direction: a venue with an
`account sold` and no line in that month's depletion summary is worth
questioning. Of the 8 rows inside the Apr–Jul 2026 window, 6 appear on the
summary and **2 do not** — City Dog Cantina (30 Apr) and Star Liquors VII
(26 May).

**Method worth reusing:** the check that settled this was dividing money by
something physical. A commission total alone is unfalsifiable; a commission
implying $2,401 a bottle is obviously wrong. Same technique caught the gross-vs-
commission ambiguity in D44.

---

**D52 — The operator's matching rule works, with a one-month lag. It identifies the mis-typed rows.** ✅ 18 Aug 2026

Refines D51. That entry established that `account sold` **quantities** cannot
reconcile to the invoice — correct, and unchanged. But the operator's actual
rule was about **which venues**, not how many bottles: *"if we have 5 account
sold in a month and some combination make 3 match that month, the other two were
account visits."*

Tested properly — month by month, and allowing the depletion report to lag the
placement by one month, which is the operator's own description of the process
("we have to wait for the depletion report"):

| placement | depleted |
|---|---|
| 9 Apr · Black Hawk Social | April |
| 16 Apr · El Patron Mexican | April |
| 30 Apr · City Dog Cantina | **May** |
| 21 May · Gleneagle Country Club | **June** |
| 28 May · Dancers Royale | **June** |
| 2 Jun · Vineyard Wine Co | June |
| 30 Jun · Gleneagle Country Club | June |

**7 of 8 tie to a depletion. One does not: 26 May, Star Liquors VII** — the
candidate for having really been an account visit.

**An earlier figure in this session was wrong.** "6 of 8 match" came from
comparing against every summary venue at once rather than against each month's,
which both missed the lag and allowed false matches. The month-aware test is the
correct one; the careless version happened to give a similar-looking number for
the wrong reasons.

Three things follow:

1. **The rule is a working QA tool**, not a one-off. Applied to the remaining 48
   `account sold` rows as their depletion summaries arrive, it will separate real
   placements from mis-typed visits mechanically.
2. **Venue name families matter.** "City Dog Cantina" matched "City Dog Cantina
   #2" only after normalising away the `#` suffix. Those are probably two records
   for one premises and worth merging.
3. **`account sold` is being retired** by the operator, so this is historical
   cleanup rather than an ongoing concern — but the 74 existing rows still need
   classifying before any Dame Mas revenue figure is trustworthy.

---

**D53 — The Dame Mas activity workbooks: what they close, and three problems in them.** 18 Aug 2026

`Dame Mas 2026.xlsx` holds a sheet per month covering **Aug 2025 – Jul 2026** —
most of the nine-month gap D51 identified. Columns are Date, Account, Notes,
Qty, Opportunity, Images, and `Opportunity` carries the activity type. This is
venue-and-type detail, which is exactly what was missing.

**Star Liquors VII is confirmed, and the reason is better than "a mis-typed
visit".** Its note reads: *"Met with Amish, Owner… He has committed to a case of
each, **to be bought tomorrow**."* So it was a **commitment, not a completed
sale** — logged as `account sold` before anything depleted, which is precisely
why it appears on no depletion summary. D52's method found it; the note explains
it. Whether it should be reclassified as a visit or as a sale in a later month
is the operator's call, but it does not belong in May's revenue.

**Three problems to fix in the workbook itself, none of them ours:**

1. **The DECEMBER sheet is a byte-identical copy of NOVEMBER** — same 13 rows,
   dated 4–20 Nov. December 2025 is therefore absent, yet the invoice recap bills
   **$377.65** of commission for it. Real activity is missing from the file.
2. **The 2025 sheets (AUGUST, SEPTEMBER, OCTOBER) use a different layout** — 8
   columns rather than 6, with the column that holds the activity type in the
   2026 sheets instead holding note text. Any importer must detect the layout per
   sheet rather than assume one shape; reading them positionally would file long
   sentences as activity types.
3. **NOVEMBER's type column holds `1` and `2`** — quantities, not types. That
   sheet carries no activity type at all.

Casing is inconsistent throughout (`account sold` / `Account Sold`, `Account
Visit` / `account visit`), which `normalize_activity_type` already handles.

`Dame Mas 2025 Activity Report.xlsx` could not be read — the file is open in
Excel and locked. Nothing was inferred from it.

---

**D54 — The two Dame Mas bottle prices, and which SKU each belongs to.** ✅ operator-confirmed 19 Aug 2026

| SKU | price |
|---|---|
| Reposado | **$123.00** |
| Extra Añejo | **$210.75** |

*"Reposado is the cheaper of the two"* (operator, 19 Aug 2026). D51 recorded both
figures but not which was which, which left every mixed-SKU line ambiguous.

The Account Sold Summary corroborates it independently: Geronimo's 2 bottles bill
$333.75, which is $123.00 + $210.75 and so is one of each; Black Hawk's 2 bottles
bill $246.00, which is two Reposado.

**One line does not decompose.** Eden Lounge, 13 bottles, $2,458.50. Solving
$210.75x + $123.00(13−x) = $2,458.50 gives x = 9.795 — not a whole number of
bottles at either price. Flagged, not resolved; it is one line and does not block
anything.

---

**D55 — `account sold` classified from the rep's own note, not from the depletion report.** 19 Aug 2026

D52 separated real placements from mis-typed visits by matching against monthly
depletion summaries. That method is sound but only reaches months where a
depletion report exists — four of thirteen. **The workbook note exists for every
row**, so `classify_account_sold.py` reads that instead.

Of 61 Dame Mas `account sold` rows: **46 confirmed sales, 4 mis-typed visits, 11
needing an operator call.**

**The rule is tense-sensitive, and that is the whole trick.** A keyword match on
"bought" or "sold" gets Star Liquors VII wrong — *"committed to a case of each,
**to be bought tomorrow**"* contains "bought" and is not a sale. So a
future-tense marker appearing *before* the sale verb demotes the row. The four it
catches:

| date | venue | why |
|---|---|---|
| 13 Oct 2025 | Sip Tequila | note is "SIP Meeting" |
| 16 Mar 2026 | Geronimo | "walked in to set an appointment" — the sale landed 18 Mar as its own row |
| 21 May 2026 | Gleneagle Country Club | "they will be bringing it in" |
| 26 May 2026 | Star Liquors VII | the D52/D53 row, found again by a different method |

**Two methods, independently agreeing on Star Liquors VII, is the result worth
trusting.** D52 found it by absence from a depletion report; this found it from
the note. Neither knew about the other.

The 11 unresolved rows are left as `account sold` rather than guessed. Nine read
like placements ("New Dame Mas xAnejo at Chatham's Place") but carry no verb, and
two have no note at all. Inventing revenue for a client from a noun phrase is
precisely what D51 warned against.

---

**D56 — `activities.quantity` holds SKUs, not bottles. A records fault, not a billing one.** ✅ operator-corrected 19 Aug 2026

Found while reading the notes for D55. The stored quantity is mostly the number
of SKUs touched, while the note states the bottles that actually moved:

| date | venue | portal | the note says |
|---|---|---|---|
| 26 Feb 2026 | Golden Ox — Warehouse | 2 | "3b Repo/3b Anejo" = 6 |
| 26 Feb 2026 | Golden Ox — Clermont | 2 | 6 |
| 26 Feb 2026 | Golden Ox — Groveland | 2 | 6 |
| 19 Feb 2026 | City Dog Cantina | 1 | "Sold in 4b of the Repo" |
| 21 Aug 2025 | Secrets Hideaway | 1 | "x2b of Extra Anejo for both bars" = 4 |

Across the 12 rows where the note states a count, the portal holds **18 bottles
against 44 stated.**

**An earlier draft of this entry called that 26 bottles "unbilled" and put a
$3,198–$5,479 figure on it. That was wrong, and the operator corrected it the
same day:** *"everything we billed was correct, that is based on depletion
reports from the distributor. If anything is wrong it is our records. But the
billing is the truth."*

So the direction of the error was backwards. **Commission is billed off the
distributor's depletion report**, which counts every bottle that actually moved —
it never depended on `activities.quantity`. The invoice was right. What is wrong
is the portal's own record of how much product moved, which matters for what a
brand SEES on the venue and activity pages, not for what anyone was charged.

**This is the standing rule, and it outranks any reconstruction from our own
notes: the distributor's depletion report is the source of truth for what sold,
and the invoice built on it is correct by definition.** Where a note, a HubSpot
quantity or a workbook row disagrees with it, the note is the thing to fix.

**Not written back.** The reading is a regex over free text and two rows collapse
where a venue has one row per SKU on the same date. `--show-quantity-gap` reports
it so the portal's display can be corrected toward the depletion reports — never
the other way round.

---

**D57 — A later reorder proves an earlier placement. 11 unresolved rows became 3.** ✅ 19 Aug 2026

D55 left 11 `account sold` rows that its note-reading could not judge, mostly
noun phrases with no verb: *"New Dame Mas xAnejo at Chatham's Place"*. Applying
the operator's own standard from D56 — the distributor's record is the truth,
our prose is not — gives a better test than parsing the sentence.

**You cannot reorder what was never placed.** So for any row the note cannot
settle, look at the venue's later history: a subsequent depletion at the same
venue means product was there to run out, and the placement happened.

Eight of the eleven resolve on that basis, and three of them are corroborated by
the distributor's own summary rather than by our notes at all:

| row | what settles it |
|---|---|
| Agave Bandido, 7 Aug 2025 | bottle reorder 31 May 2026, from the distributor's summary |
| Mullets Cigar and Bar, 6 Oct 2025 | bottle reorder 30 Apr 2026, same source |
| Executive Cigar, 4 Mar 2026 *(blank note)* | bottle reorder 31 Jul 2026, same source |
| Chatham's Place, 7 Aug 2025 | reordered 10 Feb 2026 |
| Roasted Spirits, 15 Aug 2025 | reordered 11 Sep 2025 and 16 Feb 2026 |
| KAVAS at the Point, 21 Aug 2025 | new placements 8 Sep 2025, reorders after |
| Cuba Libre, 27 Jan 2026 | case sale 18 Dec 2025 precedes it |
| Campi, 30 Mar 2026 *(blank note)* | 26 May 2026 visit "to check on Dame Mas" — it was there |

**Two blank-note rows were settled without reading anything**, which is the point:
the venue's history is evidence where the note is silent.

**Three remain, and they stay `account sold`.** Copper Rocket (26 Aug 2025) has
no later depletion, only a staff training. Executive Cigar and Campi are resolved
above; the residue is Copper Rocket plus two rows whose venue history is a single
event. Guessing them buys nothing.

**One is not a classification question at all.** `Tequila Dame Más`, 18 Jul 2025 —
the venue slot holds the brand name. `normalize.py` keeps
`BRAND_NAMES_NOT_VENUES` for exactly this, and the row escaped it because
`venue_key` compared accented text: "Más" and "Mas" were different strings to the
regex. Both tools now fold accents before matching.

---

**D58 — Three double-entered events, reported and not merged.** 19 Aug 2026

The same field event is sometimes written down twice, once in HubSpot and once
in the workbook, a day apart:

| venue | dates | note |
|---|---|---|
| Chatham's Place | 7 Aug 2025, twice | "New Dame Mas xAnejo at Chatham's Place" / "…x Anejo at Chatham Place" |
| Chatham's Place | 10 and 11 Feb 2026 | "Reorder for backbar", identical |
| Capital Grille I Drive | 20 and 21 Jan 2026 | "Sold in new bottles both repo/xAnejo" / "new placemts" |

**Reported, never auto-merged.** A wrong merge deletes a real sale, and these are
distinguishable at a glance by a human who was there. They do not affect billing
— per D56 that comes off the depletion report — but they do double what a brand
sees on its own venue page.

---

**D59 — The workbook import was rolled back. Its dedupe was wrong in a way worth keeping.** ✅ operator-directed 19 Aug 2026

29 rows were imported from the Dame Mas activity workbooks against the operator's
actual intent (*"I dont mean import the workbooks, my bad"*). All 29 were deleted
by `external_ref like 'workbook:%'`; Dame Mas returned to exactly 196 activities
and the invoice canary re-tied. No photos were attached to any of them.

**Nine of the 29 were duplicates, and the reason generalises.** The importer
deduped on an exact date match. But the two systems date the same event
differently — **the workbook records the day the rep did the work, HubSpot
records the day the deal was entered, consistently one day later**:

| venue | workbook | HubSpot |
|---|---|---|
| Barrel & Blend | 29 Oct 2025 | 30 Oct 2025 |
| Capital Grille I Drive | 20 Jan 2026 | 21 Jan 2026 |
| KAVAS at the Point | 20 Jan 2026 | 21 Jan 2026 |
| Chatham's Place | 10 Feb 2026 | 11 Feb 2026 |
| MARU | 14 May 2026 | 15 May 2026 |

**Any future reconciliation between the workbook and HubSpot must match on a date
WINDOW, not a date.** Exact-date matching will silently double every row. This is
the fact worth carrying forward from a change that was otherwise reverted.

Two of the three "double entries" reported in D58 were created by this import,
not found in the data. Only Chatham's Place 7 Aug 2025 is genuine — two distinct
HubSpot deals (`41554360913`, `41559850771`) on one date.

**Ruling on genuine HubSpot duplicates: flag, never delete.** The portal reports
them; the operator corrects HubSpot; the next sync carries the fix through.
HubSpot stays authoritative and the two systems never diverge.

---

**D60 — No hardcoded business data. The classifier's rules moved to the database.** ✅ operator-ruled 19 Aug 2026

*"I want to make sure none of this stuff with the data is hard coded in and is
being pulled from the database. I dont want any shortcuts."*

An audit of the tooling found three tiers, and only the first was actually fine:

1. **Runtime is already clean.** Every view reads a table; `resolve_activity_type()`
   reads `activity_type_aliases`; `v_activity_money` reads `rate_card`. No
   hardcoded business data reaches a brand's browser.
2. **The seeding scripts hold the source of record in Python.**
   `load_rate_card.py` carries eleven dicts — `CHARGE_BY_BRAND`,
   `PAY_PCT_BY_BRAND`, `GLOBAL_CHARGE` and the rest — and writes them into
   `rate_card`. The database ends up correct, but **the only way to change a rate
   is to edit a file and re-run a script.** `normalize.py` holds
   `BRAND_CANONICAL` / `BRAND_NAMES_NOT_VENUES`; `import_bottle_sales.py` holds
   `NAME_MAP` and `SECTION_MONTHS`.
3. **`classify_account_sold.py` was worse than both** — its rules were read from
   Python constants at runtime and stored nowhere at all.

**Tier 3 is fixed now.** `classification_signals` holds the sale / visit / future
phrases with a `rationale` column, staff-only RLS, seeded from the working
version. The tool loads them per run. Verified by inserting a phrase with SQL
alone and watching the classification change with no code touched.

The hardcoded Dame Mas workbook paths went too — `--workbook` is explicit, and a
run without it falls back to the notes already in the database.

**Tier 2 is the next real piece of work**, and it is the same work as the admin
back end: a rate the operator can edit is a rate that lives in a table with a UI
in front of it, not a dict in a repo they do not deploy from.

---

**D61 — The staff admin is built, and it stays a separate Python app.** ✅ 19 Aug 2026

*"Lets build the admin portal. This would be where Phil and I can do our
business analysis but also where I would clean the data."*

Six pages under `Hubspot/portal_seed/admin/`, run with
`streamlit run admin/app.py`:

| page | what it does |
|---|---|
| **Health** | the invoice reconciliation, the work queue, and the size of everything |
| **Analysis** | money by month, venues, activity mix, cities, and every row behind them |
| **Activity types** | the review queue — rename, retype, merge |
| **Account sold** | this session's classification work, per row, plus the rules behind it |
| **Duplicates** | one event recorded twice, side by side |
| **Venues** | merge duplicates, fix rows that are not venues |
| **Rate card** | what is unpriced, and add or supersede a rate |

**It is a separate app rather than pages in the brand portal, and that is a
security property rather than a preference.** The portal is read-only by
construction: RLS carries SELECT policies only and `authenticated` holds no
write grants, so a browser that cannot write cannot be tricked into writing.
Granting staff writes to a browser role would dissolve that for **every** user,
brand logins included. The admin connects from Python with `DATABASE_URL`,
server-side, where the credential never reaches a browser. `verify_live.py`
still reports 0 anon grants and 0 write grants to `authenticated`.

**Three things the build found that reading would not have:**

1. **The canary was hiding a gap.** Driving it from `invoice_recap` instead of
   four figures pasted into a script immediately surfaced Jan–Mar 2026: $1,020.53
   billed against nothing in the portal. A LEFT JOIN *from the invoice* is what
   makes a missing month visible — joining the other way silently drops it.
2. **A row could corroborate itself.** The account-sold page excluded "the same
   date" rather than "this row", so a venue's only depletion — the row being
   judged — appeared as evidence for it. Now keyed by activity id.
3. **`market` is deliberately unused**, so a "353 venues outside both markets"
   metric dressed a design decision up as a data fault. Replaced with a city
   count, which is the geography the business actually uses.

**Also fixed on the way:** `import_invoice_recap.py` rounded 409.125 to 409.12
against an invoice billing 409.13 — a one-cent disagreement invented by the
importer. Money columns are `numeric(14,4)` and rounding happens at display.

**17 duplicate venue clusters and 12 duplicate activity pairs** are now visible
that nobody had counted before.

---

**D62 — `rate_card` uniqueness was never enforced on shared lines. 46 duplicate rows removed.** ✅ 19 Aug 2026

Found while checking whether an accidental re-run of `load_rate_card.py` had
done damage. It had not — but it exposed something older.

The constraint was `unique (brand_id, source_activity_type, effective_from)`.
**In Postgres a UNIQUE constraint treats NULL as distinct from every other
NULL**, so it never applied to the shared lines — the ones with `brand_id NULL`,
which is exactly how contractor pay is stored.

The effect was invisible and cumulative. Every run of `load_rate_card.py`
inserted **another** copy of every shared line, because `on conflict` had no
conflict to find. Seven runs left seven identical copies of `staff training`,
`recurring case`, `1st case sale` and six more — **55 rows standing in for 9**,
and 278 lines where 232 was the truth.

**Money was never wrong, which is why nobody noticed.** `v_activity_money`
resolves each side with `order by … limit 1`, so it picked one copy and ignored
the rest. Charge and cost are byte-identical before and after the fix:
$14,346.85 and $9,061.18 across active brands.

**What it did break is editing** — and that only mattered from today. Changing a
rate in the admin would have updated one copy of seven and appeared to do
nothing at all. The bug had been harmless for as long as rates were only ever
written by a script that rewrote all of them.

Fixed by deduplicating to the lowest id per group and rebuilding the constraint
as `unique nulls not distinct (…)` (Postgres 15+; this project is on 17.6), so
it now means what it always read as. The admin's `on conflict` clause needed no
change — it was correct all along and simply had nothing to match against.

**The general lesson, worth more than the fix:** a constraint that has never
fired looks identical to a constraint that is working. This one had been dead
since Phase 1 and the only symptom was a row count nobody had reason to check.

---

**D63 — The admin is a laptop tool. Its access control is that it is not reachable; Phil gets analysis through the portal instead.** ✅ 19 Aug 2026

`HANDOFF.md` framed the next job as "add authentication to the admin", on the
assumption that Phil needed to reach it. He does not. **Cleanup is the
operator's job, done at his own machine; what Phil wants is the analysis.** Once
that was said out loud the problem changed shape, and most of the planned work
evaporated.

**What was considered.** Streamlit's `st.login()` OIDC against Google; a
Tailscale tailnet; an always-on cloud VM (~$5/mo) inside that tailnet; and
rebuilding the whole admin on the website with Netlify Functions holding
`service_role` server-side. That last one is genuinely possible — Netlify
Functions are not static files — and it was rejected on cost, not feasibility:
~1,439 lines of Python become ~3,000 lines of hand-written JS, and, more
importantly, **it converts a structural guarantee into a code guarantee.** Today
there is no path from the internet to a write. That is worth more than a single
sign-on.

**What was chosen — split by what is dangerous:**

- **Analysis → the website**, under the operator's existing portal login. This
  needs *no new backend*: `is_staff()` is already in every SELECT policy, and
  `rate_card`, `invoice_recap` and `classification_signals` already carry
  staff-only policies. `create_portal_user.py --staff` already creates the
  account. Phil reads every brand and can write nothing.
- **Cleanup → stays Streamlit, on the laptop.** No VM, no Tailscale, no hosting
  bill, no second deploy target.

**The one real problem this surfaced.** Streamlit binds to *all* interfaces by
default — that is what the "Network URL" in its banner means. The admin has no
login and shows every brand's rate card, commission and invoice recap side by
side, so on any untrusted network (hotel, coffee shop, a client's wifi) all of
it was readable by anyone on that LAN. Verified before the fix; `netstat` now
shows `127.0.0.1:8501` rather than `0.0.0.0:8501`, and the banner no longer
advertises a network address.

Fixed with `.streamlit/config.toml` setting `server.address = "127.0.0.1"`.

**And a guard, because that file alone is not enough.** Streamlit resolves
config against the *working directory*, so launching from anywhere but
`portal_seed/` silently drops the setting and re-publishes everything.
`lib._require_loopback()` re-reads the live value on every page and refuses to
render if it is not loopback — `None`, Streamlit's default, fails the check.
**This is D62's lesson applied rather than re-learned:** a protection that
silently does not apply looks exactly like one that works. This one fails loudly,
in the browser, with the correct command to run.

**The trade being accepted, stated plainly:** Phil can see a data problem but
cannot fix it, and nothing gets cleaned while the operator is away. That matches
how the two of them actually work. If it ever stops matching — if someone else
must reach this app — it needs **real authentication first**, not a firewall
rule and not a wider bind address.

---

**D64 — HubSpot lands in a staging zone and is PROMOTED by a person. Cleanup is durable; deletion is permanent.** ✅ operator-confirmed 19 Aug 2026

**The bug this fixes had never fired, because the sync has never run in anger.**
`sync_hubspot.py` wrote straight into `activities` with `on conflict
(hubspot_deal_id) do update set …` across nine columns — `brand_id`, `title`,
`is_expense`, `source_activity_type`, `activity_date`, `quantity`, `amount`,
`venue_id`, `activity_type_id`. Every one of those is something a person fixes
in the admin. The first real sync would have silently reverted the lot, with no
warning and no record that anything had been undone. Three columns survived by
accident (`notes`, `brand_visible_summary`, `pods`) because nobody added them to
the list. Venue `city` was already protected on purpose with `coalesce`, so the
problem was understood for cities and never generalised.

**The operator proposed the fix and it is better than what was on the table.**
The alternative under discussion was per-column protection: an `edited_fields
text[]` on `activities`, with the sync skipping any column named in it. That
works, but it defends the data field by field and turns every upstream edit into
a silent, permanent divergence nobody is told about.

**Chosen instead: separate the LANDING ZONE from the CLEAN ZONE.** HubSpot lands
raw in `staging.hubspot_deals`. A person reviews and PROMOTES into `activities`,
which is then ours. Cleanup is durable because the sync has nothing to overwrite
— not because we defended each column from it.

**Five states, derived in `staging.v_review_queue` rather than stored, so the
sync and the admin cannot disagree about what needs a person:**

| state | meaning |
|---|---|
| `new` | never promoted — needs first review |
| `in_sync` | `promoted_hash = content_hash`, nothing to do |
| `rejected` | `rejected_hash = content_hash` — dismissed, stay quiet |
| `conflict` | HubSpot moved **and** the row was hand-edited — ask |
| `auto` | HubSpot moved and nobody had touched it — apply it |

**`auto` is what keeps D59 alive.** The ruling that duplicates get *"fixed in
HubSpot, let the sync carry it through"* requires updates to actually flow. The
operator's first instinct — skip any id already imported — would have frozen
every promoted row forever and quietly killed that. Rows nobody has edited still
take HubSpot's corrections automatically; only edited rows stop and ask.

**Rejection records the VALUE, not the fact.** Declining a change stores the
hash declined, so the same change never asks twice but a *new* change still
does. A boolean `rejected` would silence the row permanently — which is how a
review queue becomes noise people learn to scroll past.

**Answering a conflict never deletes anything.** Three distinct actions, and the
operator confirmed this reading: *accept* replaces the local value and resumes
auto-updating; *keep mine* leaves the row alone and dismisses the prompt;
*delete* is a separate deliberate act for duplicates.

**Tombstones cannot live on `activities`.** `hubspot_deal_id` is a column ON the
row, so deleting a duplicate takes the id with it and the next sync re-imports it
as though it were new. The id has to outlive the row:
`staging.hubspot_suppressed (deal_id, reason, suppressed_at, suppressed_by)`.

**Two things Postgres decided for us:**

1. `content_hash` was written as a GENERATED column and rejected — *"generation
   expression is not immutable"*. Casting a date to text depends on `DateStyle`,
   which makes the expression STABLE, not IMMUTABLE. It is a `before insert or
   update` trigger instead, using `to_char(…, 'YYYY-MM-DD')` so the hash cannot
   move if the setting does.
2. The local suite applied the generated column happily and only Supabase
   refused it — **the same class of gap as D6, in the opposite direction.** Local
   Postgres is still not Supabase; the live apply is the one that counts.

**`staging` is locked down explicitly rather than by inheritance.** Supabase's
default grant of ALL on new `public` objects is scoped to `public`, so a new
schema should not inherit it — but "should not" is exactly the assumption that
hid D6. Verified after apply: **0 grants to `anon` or `authenticated`**, RLS on
both tables with no policies, writes via `service_role` only.

**The trade the operator accepted:** work landing in staging is not in the portal
until promoted, so a brand sees nothing until a person has looked at it. That is
the point — it is the same reason the admin exists.

---

**D65 — `quantity` is ALWAYS the activity multiplier. The rate card said otherwise on 211 of 232 lines, and the portal was understating revenue by $5,540.** ✅ applied 21 Aug 2026 (agreed 19 Aug)

Found by the operator looking at the new edit grid: two 44 North case sales,
quantity 3, showing **$50 charge and $25 cost** — the rate for one case, not
three. *"In this example we bring in $150 because it's 3 times 50 and pay out
75."*

**The mechanism was right and the data was wrong.** `v_activity_money` already
handles four bases — flat, per_unit, percent, unpriced — and `per_unit`
correctly multiplies by `activities.quantity`. Only **21 of 232** rate lines
carry the flag, and they are all mileage, hourly labour and the incentives.
Every case-sale line except Aspen Green's is flat, so a six-case sale bills as
one.

**Operator ruling, which settles a question the schema had left open:**
*"Even if it's 3 expressions it's still 3 cases. The quantity is always the
activity multiplier."* The schema comment on `per_unit` had reasoned the other
way for events — *"a tasting event is one fee however long it ran"* — and that
reading is now retired. It also supersedes the worry carried from D56 that
`quantity` is SKU count rather than bottles: SKU count or case count, it
multiplies the activity either way.

**What it is worth, with quantity always multiplying:**

| brand | portal today | corrected | difference |
|---|---|---|---|
| 44 North | $10,357.10 | **$13,257.10** | +$2,900 |
| Blue Run | $5,007.50 | $6,487.50 | +$1,480 |
| Wodka | $2,617.00 | $3,477.00 | +$860 |
| Barmen 1873 | $3,045.00 | $3,225.00 | +$180 |
| Five Trail | $885.00 | $1,005.00 | +$120 |
| **total** | **$24,754.35** | **$30,294.35** | **+$5,540** |

Dame Mas and Aspen Green are unaffected — they price on `charge_pct`, which
applies to `amount` and never touched `quantity`.

**None of this was under-billed.** QuickBooks invoices retainer and commission
separately (see D64's neighbours and the QuickBooks findings of 19 Aug), so the
money that left the client was correct. What was wrong is what the portal
reports — the figure a brand sees, and every margin number on the Analysis page.

**THE TRAP, and it is the important half of this entry.** The view multiplies by
`coalesce(a.quantity, 0)`. Flipping `per_unit` on without touching that would
have turned every NULL-quantity row into **$0** and silently deleted $1,065 of
revenue. It must become `coalesce(a.quantity, 1)` — one activity of unstated
quantity is one, not none — on the charge *and* cost branches.

61 rows carry NULL quantity, which the operator explained immediately:
**`quantity` was added to the workflow later**, so the older rows predate it.
51 of the 61 are account visits charging $0 and are unaffected either way; the
exposure is 10 rows and $1,065:

    aspen green fresh market incentive   4   $400
    tasting event                        2   $300
    drink list 1                         1   $160
    1st case sale                        2   $120
    staff training                       1    $85

**Two outliers surfaced on the way, and neither changes the ruling.**

*Meg O'Malley's, 10 Dec 2025, `drink list 1`, quantity 6* — the other 34 drink
list rows are all quantity 1, including one whose own title says *"x2
cocktails"*. **Operator: it should be 1.** The 6 came from HubSpot deal
**51628024207** and was copied faithfully by the seed. Per D59 it is corrected
in HubSpot, not here — and under D64 that correction now flows on its own,
because nobody has hand-edited the row, so the next sync sees state `auto`.

*That same row has no venue*, and not through a matching failure: the deal
carries no company association in HubSpot at all. Seven 44 North activities are
in that state with the venue named in the title. Separately, **Meg O'Malley's
exists twice** — one copy with a city and a HubSpot id, one with neither — which
is one of the 17 duplicate clusters and exactly the shape that makes a repeat
account read as two one-timers.

**Applying this is two changes, and doing one without the other is worse than
doing neither:** set `per_unit` on the flat lines (rate-card data, editable in
the admin, D60 — no code) *and* change the coalesce in `v_activity_money`.

---

**APPLIED 21 Aug 2026.** In that order, because the order is the safety: the
schema went first (a coalesce of 1 changes nothing while `per_unit` is still
false), then the data. The reverse would have opened the $1,065 hole for as
long as it took to run the second command.

**209 lines flipped, not 211.** Two of the 211 are pure-percent — no
`charge_rate`, no `pay_rate` — and the view tests `charge_pct` before it tests
`per_unit`, so the flag is dead on those rows. Setting it there would have been
noise standing in for meaning. The update was
`where not per_unit and (charge_rate is not null or pay_rate is not null)`.

**The result ties to the prediction to the cent:** charge $24,754.35 →
**$30,294.35**, every brand's delta exactly as tabled above. The apply script
asserted that total before it committed, so a figure that had drifted would have
rolled the transaction back rather than landed quietly.

**The half this entry did not carry: cost moves too, and margin barely does.**
Contractors are paid per case as well, so contractor cost goes $13,851.18 →
**$17,741.18 (+$3,890)** and the real change in margin is **$10,903.17 →
$12,553.17, +$1,650** — not the +$5,540 the charge column suggests on its own.
Dame Mas is the instructive row: its *charge* is untouched because it prices on
`charge_pct`, but its *cost* rises $175, because some of its pay lines are
rate-based. Percent on one side does not mean percent on both.

**The trap was real and slightly worse than measured:** the 10 exposed rows
carry $1,065 of charge *and* $420 of cost. 66 activities now hold NULL quantity
rather than the 61 counted on 19 Aug.

**A third change, ruled by the operator when it was put to him: the defaults
flip too.** Every rate-bearing line is now `per_unit`, but the column defaulted
to `false` and the admin's "Multiply by quantity" box started unchecked — so the
next rate line added would have quietly reproduced the exact bug this entry
fixes, and nobody would have seen it until a revenue figure looked low. The
column now defaults to `true` and the checkbox is pre-checked; unchecking it is
the deliberate act. This is **D62's lesson taken rather than re-learned** for
the third time: the wrong value of this flag is invisible, so the safe value has
to be the one you get by doing nothing.

**The data change is deliberately not in `schema.sql`.** That file is
re-applied routinely and idempotently; a blanket `update rate_card set per_unit
= true` living in it would re-flip any line the operator later turns off on
purpose — a rule compiled into a script the operator cannot reach, which is
what D60 forbids. Only the column default and the view are in the schema. The
one-time update ran once, against the live card, and this entry is its record.

**Verified after:** 73 pytest pass · offline schema/RLS/staging suite passes ·
`verify_live.py` clean (1,084 activities, 0 anon grants, 0 write grants to
`authenticated`) · the Dame Mas canary unchanged — 2026-04 +$0.01 (D48),
2026-05/06/07 tying exactly, Jan–Mar still the known hole. Unchanged is the
right answer there: Dame Mas prices on percent, so D65 could not touch it, and
a canary that had moved would have meant something was wrong.

---

**D66 — The retainer gets a table of its own. It is the majority of what the business sells, and the portal had nowhere to put it.** ✅ operator-ruled 21 Aug 2026

`charge` comes from `rate_card` pricing an **activity**. A retainer is not an
activity: no venue, no work date, no quantity, and it arrives whether or not
anyone visited an account that month. Dame Mas, July 2026, is the whole argument
in one line — **$750 of retainer against $21.08 of commission.**

**The size of what was missing.** From QuickBooks, over the fifteen months this
portal actually covers (Jun 2025 – Aug 2026), the Retainer item billed
**$76,875** against roughly $30,294 of priced activity. Lifetime it is $110,850
of a $167,580 Sales group — **66%**. Operator, 21 Aug: *"every brand has a
retainer."*

**The consequence was a wrong sign, not a small understatement.** Dame Mas read
charge $1,657.75 against cost $1,911.18: margin **−$253.43**. The portal said a
profitable account lost money. With its retainer the same account is
**+$10,246.57**.

**Two shortcuts were considered and refused, and the reasons are the entry.**

*Not a synthetic monthly activity.* It is the tempting one — everything
downstream already works off `activities`, so it costs no new plumbing. It would
also put rows nobody synced into the table **D64 exists to make trustworthy**,
forcing the sync to carry a permanent exception; show brands a "Monthly
Retainer" line in their own activity log beside real venue work; and inflate
every activity count in the system by twelve rows per brand per year. It buys
reuse at the price of the two things this project protects hardest.

*Not read from `invoice_recap.consulting`*, tempting under D56 and already
holding the right number for Dame Mas. **`invoice_recap` is the canary** — the
independent figure the portal is checked against. Source revenue from it and the
reconciliation compares the invoice to itself and ties forever. That is
**D62's shape exactly**: a check that can no longer fail is indistinguishable
from one that passes. invoice_recap stays the check; `brand_retainer` is the
source.

**Shape:** `brand_retainer` — brand, monthly amount, `effective_from`,
`effective_to`, note. Month-granular and **inclusive at both ends**, because a
person types these into a form and "the last month I billed them" is the fact
they hold; an exclusive end invites an off-by-one nobody would catch. A rate
change is a new row, as on the rate card. An **exclusion constraint** refuses
overlapping periods outright — a double-billed month is invisible in every total
that matters — and `03_retainer_test.sql` fires all six guards rather than
trusting them (D62 again).

`v_brand_month_revenue` **FULL joins** activity money to retainer months. A month
with a retainer and no activity is real, and so is a month with activity and no
retainer; an inner join would silently drop whichever side was missing — the
same mistake `lib.canary()` needed a LEFT JOIN to avoid.

**Scope starts June 2025**, where the HubSpot data starts (operator ruling, 21
Aug). Earlier QuickBooks history is archived outside this system.

**Billed in arrears** (operator, 21 Aug): the invoice naming a work month is
issued the month after, which is why `ACTIVITY DATE` and not `txn_date` is the
basis — and why `invoice_recap.month` is already correct and must not be shifted.

**What is NOT done, and it is most of it.** Only Dame Mas is on file, at
$750/mo from Jul 2025, still running. The QuickBooks connector **blanks the
service lines on almost every invoice** — a $3,503 Five Trail invoice returns
four empty line objects and a subtotal, in a single-invoice fetch as much as a
bulk one — so the other nine brands' amounts are not derivable from it and must
be entered on the Retainer page or exported from QuickBooks by hand.

---

**D67 — Contractor base pay is a property of the person and a cost of the business, not of a brand.** ✅ operator-ruled 21 Aug 2026

Asked whether the retainer carries a contractor cost, the operator ruled that it
does — but not in the shape the question assumed:

> *"We might pay one contractor a base of $350 every 2 weeks but another $500.
> It has nothing to do with the brand but has other internal factors."*

**So base pay is keyed on the person, on their own cadence, and it is a COMPANY
cost.** That distinction is load-bearing. Brand margin is a brand's revenue less
the cost of the activities done *for that brand*. Base pay is not caused by any
one brand, so pushing it into per-brand margin would mean **inventing an
allocation nobody agreed to**, after which every brand's margin quietly carries
a share of a cost it did not cause. It lands one level up, in
`v_month_business`, against the business as a whole.

**Per-activity pay stays in `rate_card.pay_rate`**, which a brand's job
genuinely does cause. A contractor can have both — a base every fortnight plus
per-activity pay — and neither page is the whole of what someone earns.

**Shape:** `contractors` (the person, retired rather than deleted, because their
historical pay is part of what last year cost) and `contractor_pay`
(effective-dated amount and cadence — weekly, biweekly, semimonthly, monthly).
Same exclusion constraint as the retainer. A rise is a new period; editing an
amount in place restates every month before it.

**"Monthly equivalent" is an average and the page says so.** Fortnightly pay
lands three times in some months, so the view spreads the annual cost evenly
rather than pretending to know which months carried the extra run. The **annual**
figure is the exact one; a single month reconciled against a bank statement
needs real pay dates.

**Also ruled, 21 Aug, and not yet applied:** mileage **earns** (a real margin
line) while itemised expenses are **pass-through at cost** and must be excluded
from revenue and margin, or margin is inflated by money that was never
iHospitality's. Reconciliation is to be **line by line against invoice lines**,
not brand-month totals — which the connector's blanked service lines currently
prevent. And the admin UI is **not to be touched** until it is discussed; the
operator's word was *"counterintuitive"* rather than complicated.

---

**D68 — The retainers are loaded and reconciled month by month against QuickBooks. Five months tie exactly, and the misses are informative.** ✅ 21 Aug 2026

The operator supplied the monthly retainer sheet: 44 North $1,450, Wodka
$1,225, Heaven's Door $1,850, Gin Lane $1,600, Coors Whiskey $1,525, Blue Run
$975, Dame Mas $750, Aspen Green $500 rising to $1,000, Starr Rum $900. **He had
the amounts; nobody had the periods.** Those were derived from each brand's
activity span and then corrected against QuickBooks, one work month at a time.

**The method is the point.** `brand_retainer` and the QuickBooks retainer figure
are independent, so a month that ties is real evidence — which is exactly why
D66 refused to source revenue from `invoice_recap`. Billed in arrears, so the
transaction month is shifted back one to compare like with like.

**Five months tie to the dollar:** Jul, Aug and Sep 2025, and Jun and Jul 2026.
That is strong confirmation of the amounts *and* of the arrears shift.

**Corrections the reconciliation forced, each evidenced by an exact amount:**

- *Blue Run and Coors Whiskey end at work month Feb 2026.* March 2026 was over
  by exactly $975 + $1,525 + $500.
- *Heaven's Door ends at work month Jul 2025.* August was over by exactly
  $1,850 — and their **last invoice, 3119, carries work month July 2025**.
  Documentary, not curve-fitting.
- *Starr Rum at $900.* The reconciliation **predicted this before the operator
  supplied it** — a steady −$900 across Jul–Sep 2025 with no brand to explain
  it. He then confirmed "$900 a month."

**THE CORRECTION THAT WAS WRONG, and it is the most useful entry here.** Aspen
Green's period was first "corrected" from Feb 2026 to Jun 2026 because that made
four months tie. It was wrong. The operator: *"we have not been billing Aspen
Green through QuickBooks until recently — they were sending money via Zelle
without an invoice."* Their first invoice is **3202, work month Jun 2026**.
QuickBooks structurally could not see Aspen Green before that, so the tie was
achieved by deleting real revenue to match a blind source. Restored to Feb 2026,
and the +$500 deltas for Feb–May 2026 are now **expected and correct**.

> **Tying to a source is only evidence if the source can see the thing.**
> A reconciliation that forces agreement with an incomplete record does not find
> the truth; it destroys it. This is D62's family — a check that cannot fail —
> approached from the other side.

**Coors Whiskey is now its own brand.** One QuickBooks customer, "Five Trail
Whiskey / Barmen Bourbon," billed $1,525/mo. At the operator's request it is
held under that name rather than attributed to either brand, so Coors Whiskey
shows a retainer with no activity while Five Trail and Barmen 1873 show activity
with no retainer. That is the billing as it actually happened, and it is the
customer-above-brand layer surfacing again — it is not modelled, only named.

**Residual, and it is small:** six months still disagree — Jun 2025 (−$950),
Oct 2025 (+$1,450), Nov (+$675), Dec (+$900), Jan 2026 (+$1,475), Feb (−$950).
Gin Lane ($1,600/mo) is not a portal brand and is deliberately excluded, which
accounts for part of it. **Not curve-fitted any further on purpose** — the
Aspen Green lesson above is exactly what over-fitting produces.

**Heaven's Door is owed $16,361.08** across invoices 3099, 3106, 3111, 3114 and
3119 — work months Mar–Jul 2025, none paid. The operator flagged it as a live
problem. It is recorded here because the portal had no idea.

---

**D69 — The 21 "All Brands" activities are split into one activity per brand on retainer that month.** ✅ operator-ruled 21 Aug 2026

Operator: *"those are generally account visits where we went to a place to
represent all brands… it isn't a paid or charged activity. If you could break
those up into individual activities for every brand that was active at that
time."*

**"Active at that time" is defined as a retainer running in that work month** —
which is only possible because D68 loaded them, and is a better definition than
`is_active` (a *current* flag that says nothing about last December). **Coors
Whiskey expands to Five Trail and Barmen 1873**: it is a billing entity, not
something represented at a bar.

**Two risks were checked before anything was written.**

*Would the copies be charged?* No. Every rate line for `account visit`,
`account visit (pk)` and `day buy-out comp` charges **$0** across all brands.
The one exception, Heaven's Door `account visit (pk)` at $20, is moot — they
hold no retainer in any affected month. Confirmed after the fact: portal charge
and cost are **unchanged** at $30,294.35 / $17,741.18. The split moved no money.

*What happens to the HubSpot deal id?* All 21 rows carry one and the column is
**unique**, so one deal cannot become N rows. The original row keeps the deal id
and is reassigned to the first brand; the rest are new rows keyed on
`external_ref` as `allbrands-split:{deal}:{brand}` — the same stable-idempotency
pattern `import_activity_workbook.py` and `import_bottle_sales.py` already use,
which is what makes re-running safe. **`external_ref` is unique too**, which the
first attempt discovered by violating it; a single shared back-reference would
not have worked.

**Every row is marked `hand_edited`**, so under D64 the next sync stops and asks
rather than silently reverting the split.

**21 rows became 127** (21 reassigned, 106 created). Activities 1,084 → 1,190,
and the `All Brands` brand now holds none. The Dame Mas canary is unchanged.

---

**D70 — The invoice PDFs carry the line detail the API withholds. Every retainer month in range now matches the invoice exactly.** ✅ 21 Aug 2026

The operator exported twelve months of invoices as `Invoice_year.pdf` — **74
pages, 54 invoices** (34 single-page, 20 two-page), work months **Aug 2025
through Jul 2026**. It carries exactly what the QuickBooks connector blanks: an
explicit **`Retainer`** line, per invoice, with its amount and its `ACTIVITY
DATE`. **50 of the 54 invoices carry one.**

**This unblocks the line-by-line reconciliation** that D67 recorded as blocked.
The PDF also separates `Expense Spend`, `Independent Commission`, `Case Sale`,
`Drink List 1`, `Account Visit` and `Mileage` with quantity and rate — the
per-activity detail needed for it.

**WHERE THE FILE MUST NOT LIVE.** It was first saved into the *website* repo,
whose root **is** the Netlify publish directory — one `git add -A` and twelve
months of client invoices would have been served at
`ihospitality.vip/Invoice_year.pdf`. It was untracked, so nothing was exposed.
Moved to `Hubspot/` (not deployed), and **`*.pdf` is now in `.gitignore`**
alongside `*.py` and `.env`. `_redirects` could not have hidden it (D12).

**Two Molson Coors entities, and they are different customers.** "Coors Whiskey
**Co**" is how **Blue Run** is billed (c/o Park Street Imports, Stephanie
Gonzalez); "Coors Whiskey **Company**" is **Five Trail / Barmen** (Alex Drozd).
Reading them as one would have merged two brands' retainers.

**Four corrections, each straight off an invoice (D56):**

| brand | was assumed | the invoices say |
|---|---|---|
| Wodka | from Nov 2025 | from **Dec 2025** (first is 3175) |
| Starr Rum | to Dec 2025 | to **Oct 2025** (last is 3166) |
| Blue Run | flat $975 to Feb 2026 | $975, **$950 for Jan 2026 only** (3177), $975 again Feb |
| Blue Run | — | Feb 2026 **is** billed, at $975 |

Blue Run's one-month dip to $950 is the kind of thing no assumption would ever
produce, and it is why the periods had to come from the invoices rather than
from activity spans.

**Result: every brand-month between Aug 2025 and Jul 2026 matches the invoice to
the dollar**, with one deliberate exception — **Aspen Green, Feb–May 2026**,
which is *correct* precisely because it does NOT match: they paid by Zelle with
no invoice raised until 3202 (D68). A reconciliation that forced those to tie
would be deleting real revenue.

**The QuickBooks month-by-month check improved from five ties to seven**, and
what is left is now explained rather than mysterious: the **±$1,450 pairs**
across Oct/Nov 2025 and Jan/Feb 2026 are exactly 44 North's rate cancelling
between adjacent months — QuickBooks *transaction*-month bucketing, while the
PDF proves the *work* months are right. The remaining +$500s are the Aspen Green
Zelle months. Residual on the whole window: **+$1,050 on $71,125**.

**Still outside the evidence:** Jun and Jul 2025 predate the PDF, and Aug 2026
is not yet invoiced (arrears). Those months rest on the activity span, not on an
invoice.

---

**D71 — Money paid without an invoice is MARKED, not explained in a note. The retainer now reconciles to zero.** ✅ operator-ruled 21 Aug 2026

Aspen Green paid **$500 a month by Zelle from Feb 2026** with no invoice raised
until 3202 (work month Jun 2026). **$2,000 in total.** The operator's framing:

> *"The $500 wouldn't be in QuickBooks since we never invoiced them, so it would
> be as if it never happened."*

Exactly so — and the consequence is the entry. **The money is real, and the
portal is now the only record of it.** QuickBooks has no invoice and, checked
directly, **no sale either**: Aspen Green does not appear in Sales by Customer
for Feb–Jun 2026 at all. Whether it was ever booked as income is a bookkeeping
question outside this system and was flagged to the operator.

**Why a note was not sufficient.** A retainer with no invoice can never tie to
one, so it shows as a permanent +$500 monthly shortfall — and the obvious fix
is to delete it. **That exact mistake was made earlier the same day** (D68) and
caught only because the operator happened to mention the Zelle payments. The
next person reconciles first and reads notes second, so the fact has to be
structural, not prose.

`brand_retainer.source` is now `invoiced | uninvoiced`. Uninvoiced money counts
toward revenue, is broken out as `retainer_uninvoiced` in
`v_brand_month_revenue`, and is **excluded from every comparison against
QuickBooks** — because a figure with no invoice should never be expected to tie.

The Aspen Green period had to be **split**, which is the detail that shows the
flag is doing real work: Feb–May 2026 is uninvoiced, **June 2026 is the same
$500 but invoiced** (3202), and July onward is $1,000 invoiced.

**A schema note worth keeping.** `create or replace view` cannot insert or
rename a column mid-list, and dropping `v_brand_month_revenue` would take
`v_month_business` with it. New columns go on the **end**. Separately, `FILTER`
is aggregate-only — a per-row conditional needs `CASE`.

---

**THE RESULT: $71,125 on file against $71,125 invoiced. Zero.**

Eleven of fourteen work months tie exactly. The three that do not are **two
perfectly cancelling ±$1,450 pairs** (Oct/Nov 2025, Jan/Feb 2026) where 44
North's invoice lands in an adjacent QuickBooks *transaction* month — the PDFs
prove the *work* months are right, so the portal is correct and the bucketing is
what moves.

**`Invoice_June_july25.pdf` closed the last gap**, and produced two corrections
that no amount of inference would have:

- **Heaven's Door bills as "Spirit Investment Partners."** Nothing in its BILL TO
  block says "Heaven's Door," which is why three earlier passes left a −$1,850
  hole in June 2025 and why D68 declined to guess at it. It was invoiced for
  **both June and July 2025**.
- **Starr Rum starts July 2025**, not June; June was an assumption from the
  activity span.
- 44 North's July 2025 invoice carries a malformed `ACTIVITY DATE` of "2024",
  so its month could not be parsed. The $1,450 is on the invoice.

**What still rests on assumption rather than an invoice: nothing, except Aug
2026** — which is not yet invoiced, because billing is in arrears.

---

**D72 — Line-by-line reconciliation: the activity data was NOT already correct, and the gap is concentrated in one brand.** ✅ 21 Aug 2026

The operator asked, reasonably, whether the day's work had already made the
activity data match the invoices. **It had not.** D65 changed how activities are
*priced*; D66–D71 reconciled the **retainer only**. Account visits, case sales
and bottle sales had never been compared to an invoice. This entry is that
comparison.

`reconcile_invoices.py` reads both invoice PDFs and compares **quantity per
brand × work month × activity type**.

**What ties exactly**, which is what says the method is sound rather than loose:
staff training **17 = 17**, printed feature **28 = 28**, Aspen Green fresh
market **9 = 9**, single barrel sale **1 = 1**. 133 brand-month-type
combinations agree.

**Case sales, the money line.** Combined across every case type, Jun 2025 –
Jul 2026: the invoices billed **524 cases, $11,555**. The portal holds **394**.

| brand | invoiced | portal | gap |
|---|---|---|---|
| **Aspen Green** | 199 | 57 | **+142** |
| Starr Rum | 10 | 0 | +10 |
| Blue Run | 33 | 26 | +7 |
| Coors Whiskey | 34 | 29 | +5 |
| 44 North | 98 | 104 | −6 |
| Wodka | 150 | 169 | −19 |

**Almost the entire gap is Aspen Green in two months** — invoice 3202 bills 75
cases for Jun 2026 and 3210 bills 124 for Jul 2026, against 4 and 20 in the
portal. Every other brand is within single figures. **Starr Rum's case sales
were never logged at all.**

**Account visits run 181 HIGHER in the portal than on the invoices**, and part
of that is self-inflicted: D69 split each "All Brands" visit into one row per
brand on retainer, while an invoice bills the visit once. No money moves — every
account-visit rate is $0 — but the counts no longer correspond, and anyone
comparing them should know why.

**The expected non-matches are now encoded in the tool** rather than left to be
rediscovered: 44 North reorders (**paid but never charged** — operator, 21 Aug),
Aspen Green Feb–May 2026 (Zelle, D71), Dame Mas depletion rows (it bills a
percentage of depletions, so `account sold` / `bottle sale` / `bottle reorder`
are the detail behind a commission rather than invoice lines), anything `n/c`,
and mileage (billed as miles × rate, not a count). **Forcing any of these to
agree would delete real data** — the mistake made once already on Aspen Green.

**Coors Whiskey is pooled with Five Trail + Barmen 1873** in the comparison. One
customer, two brands (D68); without pooling, every line on both sides reads as a
discrepancy.

---

**Operator UI feedback, 21 Aug 2026 — captured, NOT acted on.** The operator
asked that the admin UI not be touched until it is discussed, and then named two
concrete problems worth recording while they are fresh:

- **Activity types page**: it reports "10 unclassified activities" but gives no
  visible way to classify them. *"I see 10 unclassified activities but then when
  I go to change that I have no idea how to."*
- **Venues page**: it suggests merging two venues that are plainly different
  premises, with **no way to say so and dismiss it**. A suggestion that cannot
  be rejected reappears forever and trains the operator to ignore the page.
- **The pattern he wants**, in his words: *"for all the tabs where I can clean
  up data the easiest thing is to make the table editable and I can fix it
  accordingly, or if there is no error I say no error."* An editable grid plus a
  **"not an error" dismissal** that persists.

The dismissal needs somewhere to live — a suggestion the operator has rejected
has to be remembered, or the page will raise it again next week.

---

**D73 — The missing work was never in HubSpot, so it is backfilled from the invoices. And the canary was agreeing for the wrong reason.** ✅ operator-confirmed 21 Aug 2026

Asked whether Aspen Green's missing 142 cases were lost on import or never
logged, the operator was unambiguous: **"it was never in hubspot."** That
settles the class of problem — **no sync will ever produce this data**, because
the source does not have it. The invoice is the only record (D56).

**Two parts, and the order is the safety — the same shape as D65.**

**1. Sixteen rate-card lines the invoices prove exist were missing entirely.**
Aspen Green had **no `recurring case` charge line** and Starr Rum had **no rate
card at all**, despite both being invoiced throughout. A naive backfill would
have booked Aspen Green's 199 cases at **$0 charge against $995 of cost —
margin −$995**, which is worse than leaving them out. Rates first: charge
$30,294.35 → **$31,686.65**, purely from pricing work already logged.

Every rate came off the invoices, which state the rate on each line. Operator,
on Aspen Green: *"we pay out $5 a case so we make nothing on those."* Both sides
are stated explicitly on that line so the zero margin is **visible rather than
inferred**.

**2. Sixty-five invoice-derived activity rows**, keyed on `external_ref` in the
same stable-idempotency style `import_activity_workbook.py` and
`import_bottle_sales.py` already use, and marked `hand_edited` so the sync stops
rather than reverting them (D64). Charge → **$39,201.65**, cost → $21,466.18.

**What is lost, and is not pretended otherwise:** an invoice line carries a
brand, a work *month*, an item and a quantity. **No venue and no day.** So each
row is one activity per brand-month-type — truthful about what and how much,
silent about where. Venue analysis for these brands stays incomplete.

`recurring case` now ties **exactly at 359 = 359**, along with `5l barrel`,
`barrel prep`, `half case sale`, `drink list 2`, fresh market and single barrel.
Agreements went **133 → 198**.

---

**THE CANARY WAS AGREEING FOR THE WRONG REASON, and adding correct data exposed
it.** Pricing Dame Mas mileage and tasting events broke a tie that had held for
months. The instinct is to suspect the new data. **The data was right and the
CHECK was wrong.**

`invoice_recap.commission` is **one line on the invoice** — a percentage of
depletions, which for Dame Mas is `bottle sale` and `bottle reorder` priced at
10% through `charge_pct`. `lib.canary()` summed **every** charge Dame Mas
carried and compared that total against **one of its parts**. It agreed only for
as long as Dame Mas's flat-rate lines were missing from the rate card. The
moment the card became more complete, the check failed — not because anything
broke, but because it had never been comparing like with like.

Restricted to percent-priced rows it compares commission to commission, and
2026-04 (+$0.01, D48), 05, 06 and 07 tie again exactly.

> **A check that agrees because both sides are incomplete is D62 wearing a
> different hat.** It is not enough for a canary to be green; it has to be green
> for a reason you can state. This one now is.

**Still outstanding, and deliberately not "fixed":** the portal holds MORE than
the invoices in several types — account visits **−257** (partly D69's own split,
which multiplies one visit across brands while an invoice bills it once), and
`1st case sale` **−117**. Those are the dangerous direction: making them agree
means deleting logged work. They need looking at, not correcting.

---

**D74 — The edit grid was reclassifying without repricing. The column that moves money is the raw string, not the label.** ✅ operator-specified 21 Aug 2026

The operator described the monthly workflow he actually wants, which is the
right instinct — this should be a UI job done as data arrives, not a session of
someone running scripts:

> *"We have a table which lists the activity and the detail in different columns
> shows me the rate, then I have an empty column where I can put the new
> activity and then that will populate with the new rate and when I click save
> it updates. Venue and description should also be able to be edited."*

Most of that already existed on the Review and edit page. **The part that did
not is the part that mattered.**

`rate_card` is keyed on `source_activity_type` — the **raw** string — and
deliberately so: *"tasting event"*, *"tasting event N/C"* and *"Tasting Event
Split"* price at $150, $0 and $100 while all three classify as a single type.
The grid edited the tidy **label**. So changing an activity's type left the
charge exactly where it was — **silently**. Proved directly before rebuilding
anything: changing `activity_type_id` moved the money **not at all**; changing
`source_activity_type` moved it immediately.

**An edit control that appears to work and does nothing is indistinguishable
from one that works** — D62 for the third time this session, after the sync's
overwrite and the `per_unit` default.

**What the grid does now.** It edits the raw priced string; offers only strings
the rate card can actually price *for that brand*; and re-derives the label
through `resolve_activity_type()` on save, so reclassifying and repricing are
**one action** rather than two that look like one. The rate itself is shown —
seeing `$50 × 3 = $150` is what makes a wrong figure obvious, where seeing
`$150` alone does not — and the brand-facing description is editable, while
`title` stays read-only because it is HubSpot's deal name and the row's
provenance.

**A "what will change" preview prices the edit before it is committed**, and
resolves the rate through the *same* lookup `v_activity_money` uses — brand line
preferred over shared, effective on the activity's own date. A second pricing
implementation in Python would drift from the view; this one cannot. Verified
end to end: the preview said $75.00, the save produced $75.00, and the
classification followed.

It also **warns when a change would resolve to no rate at all**, rather than
letting a $0 vanish into a revenue total that looks complete — the same
principle as `unpriced` in `v_activity_money`.

**One bug found by testing rather than by the operator.** The first version
assembled the rate string in SQL with a literal `%`, which psycopg reads as a
placeholder whenever parameters are passed. That is exactly what broke the
Venues page, and `lib`'s `params or None` fix only rescues the *no-params* case
— which this is not. The numbers come back raw and are formatted in pandas. **A
page nobody has opened is not a page that works.**

---

**D75 — The two UI complaints had different causes, and one of them was that the page was not doing what it appeared to be doing.** ✅ operator-reported 21 Aug 2026

**Activity types.** *"I see 10 unclassified activities but then when I go to
change that I have no idea how to."* Two causes, not one.

Four of the five flagged types are simply **correct and want confirming** — and
the way to confirm one was to untick *"Still needs review"* inside a tab, three
clicks deep and phrased as a state rather than an action. There is a **"This
type is correct"** button on the row now.

The ten `unclassified` activities, though, **could not have been fixed from that
page by any route.** Their `source_activity_type` is **NULL** — there is no raw
string to alias or to merge — while every control on the page acted on a *type*
and the count on the Health page counts *rows*. The operator was not missing
something; the capability was absent.

The page now lists the **activities** waiting, with their HubSpot deal name —
which is where the meaning actually lives (*"44N drink development at
Maxine's"*) — and a column to put the priced string into. Saving re-derives the
type through `resolve_activity_type()` exactly as D74's grid does, so
classifying and pricing stay one action. **98 rows, not 10:** an activity with a
NULL source can never be priced whatever type it sits under, and all of them
belong in the queue.

**Venues.** *"I am not sure why it suggests merging these two as they are
completely different places."* **It was not suggesting them.** Both dropdowns in
the *Merge two venues* tab defaulted to the first two venues alphabetically, so
the page opened reading *"merge 1881 Kissimmee into 24 Middleton"* beneath a
warning that the two were unalike. Nothing was being proposed — two arbitrary
defaults were, under a caution that read as a recommendation.

> **A default that looks like a recommendation is a bug**, and the reasonable
> reading of it — "the system thinks these are duplicates" — was the operator's.
> Neither dropdown is pre-selected now, and the tab states that it suggests
> nothing.

The *Possible duplicates* tab genuinely does suggest, and now accepts **"these
are different places"** for an answer, with a reason recorded. `Executive Cigar`
and `Executive Cigar Sanford` were already the page's own worked example of a
pair that must not be merged, and there had been no way to say so.

**Keyed on the cluster's MEMBERSHIP, not its name.** If a third venue later
normalises into a dismissed cluster, the stored set no longer matches and the
cluster returns — nobody has judged the new one. Dismissing by name would
swallow it silently. Reversible from an expander, because a judgement made in a
hurry should not be permanent.

**A suggestion that cannot be rejected is worse than no suggestion**: it returns
every month and teaches the operator to ignore the page, which costs more than
the duplicates it was meant to catch.

---

**D76 — Two more from using the thing: identical names could not be merged, and the classifier would not take typing.** ✅ operator-reported 21 Aug 2026

**"There are 2 321 Liquors. I go to merge them and when I click on 321 on the
first part the other 321 becomes unselectable so I can't merge."**

The target list was `[n for n in names if n != source_name]` — filtered by
**name**. **Seventeen venue names are duplicated exactly** (321 Liquor, Meg
O'Malley's, Frigates, Squidlips, Coasters Pub…), so choosing one removed both,
and **the clearest duplicates in the database were the single case the page
could not merge.** Fifteen of the seventeen are empty shells with no city and no
activity — the easiest cleanup there is, and it was unreachable.

Both selectors are keyed on `id` now and labelled with city, activity count and
last activity, because two rows sharing a name is precisely when the name is not
enough to tell them apart:

    321 Liquor — Palm Bay · 1 activities · last 2025-12-17
    321 Liquor — no city · 0 activities · last never

**"Why wouldn't I manually type in the activity type in that table so then it
could update?"** and then **"ideally I would want to be able to type and as I
type it shows me options for what I have."**

Both right, and they resolved to different mechanics. The column began as a
closed dropdown to stop an unknown string resolving to **$0** and understating
revenue silently — a real risk, but it forced a trip to another page to record
any activity the rate card had not seen, which is the friction the page exists
to remove.

A `SelectboxColumn` **filters as you type**, so the common case is a few
keystrokes. It cannot accept a value outside its list — `accept_new_options`
exists on `st.selectbox` and **not** on `SelectboxColumn` as of Streamlit 1.52 —
so both grids now pair the type-ahead with a box that adds a genuinely new
string, which then becomes selectable in every row.

**The original worry is still handled, just later and better:** every entered
string is priced *before* saving, through the same lookup `v_activity_money`
uses, and anything that will not price is named. Verified: `Staff Training` →
$75.00, `  TASTING EVENT ` → $150.00, `stff trainng` → **NO RATE, flagged**. A
typo looks exactly like a new activity, so it now says so instead of becoming a
quiet zero.

**Both were found by the operator using the pages, not by the tests** — which is
the pattern of this whole session. The venue merge had passed every check that
existed, because nothing tested the one arrangement that mattered.

---

**Why `source_activity_type` was NULL, since it was asked.** All 84 such rows
came **from HubSpot**, in the original 10 Aug seed, on deals with the
activity-type property **left blank**. `resolve_activity_type(null)` routes
those to `unclassified` deliberately — *"an activity with no type at all is a
data problem, not a new category. Route it somewhere visible instead of
inventing a type per blank value."* Nothing is corrupted; the source field was
empty. Per D59 the durable fix is filling it in HubSpot so future syncs carry
it, otherwise new ones keep arriving unclassified.

---

**D77 — Nothing auto-saves, and the Save button was underneath 98 rows of grid.** ✅ operator-reported 21 Aug 2026

*"I'm testing out the activity editor and classified some of what was
unclassified. Does it auto save? If I refresh will it no longer say
unclassified?"*

**No, and no.** Streamlit holds grid edits in the widget until the button is
clicked; a refresh discards them. Checked the database when he asked: **none of
his edits had landed.**

The question is the finding. Two things were wrong.

**The Save button was several screens below the rows.** The queue is 98 rows and
the grid rendered at full height, so the page ran long enough that the control
sat well past the fold. Somebody classifying a batch would reasonably conclude
it had saved, because the only evidence otherwise was off-screen. Both grids now
have a fixed height and scroll *inside themselves*, so the save control stays on
the same screen as the rows it applies to.

**And nothing said the edits were unsaved.** The prompt read *"N row(s) would be
classified"* — accurate, and far too quiet for something that is lost on
refresh. It is a warning now, and says explicitly that leaving or refreshing
loses the edits.

**An IndexError was also hiding the button entirely.** Change detection looked
each row's id back up in the original frame —
`unresolved.loc[unresolved["id"] == r.id, ...].iloc[0]` — which raises the
moment an id does not round-trip through the widget, and the exception landed
exactly where the save block should have rendered. Rows are compared **by
position** now; `num_rows="fixed"` guarantees the same rows in the same order,
and it is how the Review and edit grid had always done it. The two pages match.

> **Three of 21 Aug's bugs were found by the operator using a page**, not by any
> test: the grid that reclassified without repricing (D74), the venue merge that
> could not merge identical names (D76), and this one. All three passed every
> check that existed, because no check drove a page the way a person does.

---

**D78 — Mileage earns and needs a cost behind it; itemised expenses pass through at cost. The exclusion is now structural, and the missing-cost blind spot has a name.** ✅ 21 Aug ruling, applied 22 Aug 2026

D67 recorded this ruling and left it unapplied:

> *Mileage **earns** (a real margin line) while itemised expenses are
> **pass-through at cost** and must be excluded from revenue and margin, or
> margin is inflated by money that was never iHospitality's.*

Applying it meant first finding out where each actually landed, and the two
halves turned out to be in opposite states.

**Expenses were already excluded — by luck, not by rule.** The five `is_expense`
activities did contribute $0 charge and $0 cost. But only because no rate-card
line happened to match their activity types, and that was one edit from ending:

- `account visit` carries **565 activities and no charge rate**, while the
  invoices bill account visits. The day that line is priced — and the open work
  list asks for exactly that — "Aspen Green Samples", an `is_expense` row typed
  `account visit`, starts earning revenue silently.
- One `is_expense` row sits in the classification queue with an **empty**
  activity type. Whatever clearing that queue assigns it, if that type is
  priced, the same thing happens.

**"A constraint that has never been exercised looks exactly like one that
works" (D62).** So the exclusion moved out of the data and into the view. The
`is_expense` branch is now **first** in both CASE expressions in
`v_activity_money`, which makes a reimbursement unreachable-by-construction
rather than unmatched-by-luck. No rate-card line, for any type, can make one
earn. `db/test/04_money_test.sql` builds precisely the dangerous case — an
expense activity with a fully populated rate-card line behind it — and asserts
the money still does not move. Removing the branch fails the suite; the live
data would not have shown it for months.

The money is not lost, only moved out of revenue: `reimbursement` carries the
pass-through amount and `reimbursements` appears **beside** revenue in
`v_month_money`, `v_brand_money`, `v_brand_month_revenue` and `v_month_business`
— never inside it. Adding it to both sides would inflate the top line while
leaving margin unchanged, which reads as a bigger business doing the same work.
An expense is also **no longer counted as `unpriced`**: it has no rate by design,
and a permanent floor under that number teaches the operator to ignore the one
figure that exists to be chased to nil.

**Mileage was the opposite problem, and it is not just mileage.** Mileage is in
revenue correctly — $0.70/mile, per_unit, 7 activities, **$1,243.90**. It has no
`pay_rate` at all, so cost resolves to **$0**, which reads exactly like a
contractor who drives for nothing.

Chasing it found the general fault. `unpriced` makes a missing **charge**
visible; nothing made a missing **pay line** visible. So:

| | direction | who notices |
|---|---|---|
| `unpriced` | understates revenue | someone chases it |
| no pay line | **overstates margin** | nobody, ever |

**37 activities across 12 types charge $6,568.90 with no pay rate behind them** —
mileage is $1,243.90 of it, alongside `5l barrel` ($1,395), `single barrel sale`
($1,000) and `aspen green fresh market incentive` ($900). That is now `uncosted`
on `v_activity_money`, `uncosted_charge` on every money view, a metric on the
Health page and Analysis, and its own panel on the Rate card page.

**`uncosted` requires the charge to be non-zero, and that detail is the
difference between a useful number and a dead one.** Defined as "has a charge
line, has no pay line" it flagged **718** rows, because every `n/c` type prices
at zero and has no pay line either — and a $0 charge inflates no margin. 718 is
a warning people scroll past. 37 is one they act on.

**What this does NOT do: invent the missing rates.** The mileage pay rate is
business data and belongs to the operator (D60), as do the pass-through amounts
— all five expense rows carry no `amount`, so `reimbursements` is currently
$0.00 while the Dame Mas invoices alone show $2,456.20 of expense lines. The
portal can now hold both correctly and says loudly that it does not yet.

**Revenue is unchanged at $116,751.65.** Nothing moved today; what changed is
that it can no longer move by accident.

---

**D79 — Four pages of the admin were broken in ways only a browser could show, and two of them had been broken for a month.** ✅ found 22 Aug 2026

D77 closed with the observation that three of 21 Aug's bugs were found by the
operator using a page rather than by any test. **Opening all nine pages on 22 Aug
found four more**, in two families. Both are invisible to every other check in
this repo: the queries return the right answers, the schema is fine, the tests
pass, and the page is still broken.

**Family one — a literal percent in a parameterised query.** psycopg treats `%`
as a placeholder introducer whenever params are passed, and **a comment counts**.

- **`lib.canary()` carried the words "10%" in a comment added by D73.** The
  admin's **front page** raised `incomplete placeholder` before rendering a
  single row, from the day D73 was committed. The handoff recorded the canary as
  verified at close — and it had been, *by querying it*, never by opening the
  app. The two are not the same evidence.
- **`7_Review_and_edit.py` had a comment WARNING about literal percent signs
  that quoted one as an example**, which broke the page that comment was about.
  That is the page the whole monthly workflow runs through. Writing the escape
  sequences out as examples fails the same way, and doing so was the first fix
  attempted here — psycopg counts those too, and then the parameter count no
  longer matches.

`lib.query`'s `params or None` cannot help by construction: these queries *have*
params. The note above it already predicted this — *"the escape has to be
remembered every time, and forgetting it fails at runtime on a page nobody
opened"* — and was right about everything except which page.

**Family two — two dollar signs in one Streamlit markdown string.** Streamlit
reads the pair as inline LaTeX, swallows both and italicises everything between,
taking any `**bold**` with it. **One** unpaired dollar sign is fine, which is
what makes it easy to miss: the same page carries a correct "$0" caption above a
mangled one.

- **Contractors** rendered `$350.00 semimonthly is **$700.00 a month**` as
  `350.00semimonthlyis**700.00` — on the page the operator is about to use to
  enter every contractor's pay.
- **Retainer** mangled the QuickBooks reconciliation caption the same way.

**Both families now have a source-level test** (`test_admin_sql.py`, 30 checks),
because both fail at render rather than in an answer, and neither needs a
database to detect. Each checker is **exercised against the real bug it was
written for** as well as synthetic ones — a test that has never failed is
indistinguishable from one that cannot fail (D62).

**And one more, from reading the page rather than the code.** The Retainer page
compared **fifteen** months of portal against **fourteen** months of QuickBooks
and reported *"$4,425.00 MORE than QuickBooks invoiced — most likely a period
left open that should have been closed."* That is an accusation of a data error
where the true answer is **"August has not been billed yet."** Billing is in
arrears, so the current work month is never invoiced; the check silently broke on
1 Aug and would have grown by a month's retainer every month until the operator
learned to scroll past the only check on that page. Bounded at
`QB_RETAINER_LAST_MONTH` now, it reads **$71,125.00 against $71,125** — D71's
zero, restored to the page that is supposed to show it — with the not-yet-billed
remainder called out separately as expected rather than missing.

> The pattern across D74–D79 is now unmistakable: **every check in this project
> that has never been watched run has eventually turned out to be broken.** Nine
> pages, opened in a browser, cost twenty minutes and found four failures, two of
> them a month old, on the two pages the next session was going to work in.

---

**D80 — Reconciliation and classification are different axes, an empty type is a merge that worked, and the deal note is now on the classification grid.** ✅ operator-asked 22 Aug 2026

Three questions from the operator, and the first rested on a premise worth
correcting.

**"We did a reconciliation — shouldn't that mean nothing is unclassified?"**
No, and the two are independent. **Reconciliation compares invoice lines to
portal rows**; `reconcile_invoices.py` writes nothing at all. **Classification
maps HubSpot's raw activity-type string to a canonical type.** A row can
reconcile perfectly and still be unclassified, and vice versa.

The reconciliation is intact and still runs: **196 brand-month-type combinations
agree, 88 differ for a known reason, 81 disagree** — and the 81 are the ones
D72/D73 already identified, portal *over* invoice on account visits and
`1st case sale`, which is the direction where making them tie means deleting
logged work.

**The 5 remaining unclassified rows all carry `source_activity_type` NULL.**
There is no raw string to resolve, because the HubSpot deal never had an
activity-type value. No reconciliation can fill a field the source system left
empty — that is open item 10, filling the property in HubSpot itself.

**"Some types are classified but have no activity. How does that happen?"**
They are **retired by a merge**, and the table gave no way to tell — a merged
type and a live empty one looked identical in a boolean column.

`merge_activity_type()` does three things: moves every activity to the target,
**repoints the aliases** so a future sync of the old raw string resolves to the
merged type instead of recreating it, and sets `is_active = false` on the source
**rather than deleting it**. All five empty types are inactive with zero
aliases, which is that function having worked correctly:

| retired type | its raw string now resolves to | activities |
|---|---|---|
| `day_buy_out_comp` | Day Buy-Out | 4 |
| `tap_cocktail` | Tap Placement | 4 |
| `tasting_event_split` | Tasting Event | 2 |
| `barrel_prep_charge` | Barrel Prep | 1 |
| `tap_with_labor` | Tap Placement | 0 — no row ever used that spelling |

**Nothing was lost, and the money did not move**, because charge is keyed on the
raw `source_activity_type` string and not on the type label (D74) — `tap cocktail`
still bills $700 under Tap Placement. They are kept rather than deleted because
deleting one lets the next sync recreate the type just merged away. The page now
splits them into their own section and traces each to its survivor, so the
question does not have to be asked twice.

**"Add notes to that table — the deal notes help me decide the type."** Done, as
the last column of the classification grid, read-only.

It earns its place: *"Sold in AG both SKUs for Jax location"* is plainly a case
sale where the deal name *"Fresh Market Stuart"* says nothing at all. **18 of the
93 queued rows carry one**, and the caption says so, because a column that is
blank four times out of five needs to distinguish "nothing recorded in HubSpot"
from "not loaded here."

**`activities.notes` is internal and stays that way.** It is written candidly and
names people; `brand_visible_summary` is the client-facing field. Selecting it
here is safe *only* because the admin is staff-only — it binds to loopback (D63)
and reads with `DATABASE_URL`, never from a browser session. The query carries a
comment saying so, because the standing rule is that the brand-facing views do
not select this column and the obvious way to break that rule is to copy a query
that does.

---

**D81 — The venue merge had never once succeeded, and the launcher that was supposed to make the admin safe to start pointed at the wrong directory.** ✅ 22 Aug 2026

Asked to "take care of the venue duplicates". The duplicates were the easy part.

**The merge was broken, and had been from the beginning.** It lived as five
lines inside `5_Venues.py`, and every attempt raised on the first statement:

```
update photos set venue_id = ...     ->  UndefinedColumn: column "venue_id" does not exist
```

**`photos` has no `venue_id` and never did** — a photo hangs off an *activity*
(`photos.activity_id`), so moving the activities moves the photos already. The
exception was caught by a handler that blamed `brand_venue_status` and told the
operator to "clear the duplicate status first", which is plausible enough that
nobody read past it.

**And the second bug was real too, so fixing only the first would still fail.**
`brand_venue_status` is keyed `(brand_id, venue_id)`, and a trigger gives every
brand that touched a venue a status row — so **any duplicate worth merging has
colliding statuses by construction.** The UPDATE hits the primary key every time.

**D76 recorded the merge as fixed.** What D76 fixed was being able to *select*
two identically named venues, which was a genuine bug. The merge underneath it
had never run to completion, and nothing noticed, because no test drove it and
the failure message named the wrong cause. D62 for the seventh time.

**Why the fix is a function, not a repair in place.** `merge_venue(source,
target)` now lives in `schema.sql` for the same reason `merge_activity_type()`
does: so the admin and anything else cannot disagree about what a merge means,
and so the offline suite can drive it without a browser.

**What it does with a colliding status, and why "keep the target's" is wrong.**
All 15 empty duplicates carry status rows *identical* to their target's, so on
live data every rule looks correct. **Root+Branch is the row that
discriminates**: the folded copy holds Blue Run `placed` with
`first_placed_on = 2025-08-22` while the survivor holds Blue Run `pitched` with
no placement date. Keeping the target would downgrade a placed account to a
pitch and throw away the date it was placed. So a collision **combines**:

| field | rule |
|---|---|
| `status` | whichever is further along the enum |
| `first_placed_on` | the earliest either knows |
| `last_touched_on` | the latest either knows |
| `notes` | both, joined, when they differ |

None of those can lose a fact. `db/test/05_venue_merge_test.sql` builds exactly
that discriminating case and was confirmed to **fail** — *"status is pitched,
expected placed — a placed account was downgraded to a pitch"* — when the rule
is regressed to keeping the target.

**The duplicates themselves: 15 merged, 2 deliberately left.** Venues went
**353 → 338**, no-city 32 → 17, no-activity 18 → 3, with activities (1,255) and
revenue ($116,751.65) unchanged. A JSON snapshot of every deleted row and its
statuses was written to `Hubspot/venue_merge_backup_<stamp>.json` first — the
merge is not reversible, and the operator asked for it in one instruction rather
than fifteen.

The 15 share a shape: the survivor came from the HubSpot sync and carries a
`hubspot_company_id`, the empty twin was created name-only by another importer.
`venues_name_unique_without_hubspot_id` is **partial** and so does not cover that
pairing, which is precisely how they accumulated.

**Two were NOT merged, because they are judgment calls and D58/D59 says flag
rather than auto-merge:**

- **Root+Branch, Clermont vs Clermont** — 12 activities against 2, and **two
  different HubSpot company ids**. HubSpot itself holds the place twice; the fix
  arguably belongs there, since merging here fixes the portal and lets HubSpot
  drift.
- **Boardwalk Bar & Grill, Melbourne vs Indialantic** — 3 activities against 2,
  two company ids, two adjacent but genuinely different towns. The 44 North and
  Barmen 1873 statuses carry identical dates on both, which suggests one place
  recorded twice — but Indialantic and Melbourne are not the same town and only
  the operator knows.

**The launcher, which turned out to be the same kind of problem.** Asked how to
start the admin without asking Claude to run it, and `.claude/launch.json`
already had an `ihospitality-admin` entry — pointing `streamlit` at an
**absolute** path to `app.py`. Streamlit resolves `.streamlit/config.toml`
against the **working directory**, which for that entry is the website repo,
where no such file exists. So the entry bound the admin to all interfaces and
`_require_loopback()` refused to render it: a launcher that could never work,
sitting next to one that could.

`portal_seed/start-admin.cmd` fixes it at the root. Its first real line is
`cd /d "%~dp0"` — the folder the file itself lives in — so the working directory
is correct from a Desktop shortcut, the Start menu, or anywhere else.
**D63 becomes automatic instead of remembered.** Verified by launching it from
`C:\…\Temp` and confirming the listener is `127.0.0.1:8501` and not `0.0.0.0`.

It deliberately keeps its console window open and ends in `pause`: without that
the window closes instantly on failure and the error is invisible — which is
this project's recurring failure mode in yet another costume.

**Not in the website repo, and that is deliberate.** That repo's root is the
Netlify publish directory, so a `.cmd` committed there would be downloadable at
`ihospitality.vip/start-admin.cmd`.

---

**D82 — A venue merge undid itself on the next sync, and the last two duplicates are gone.** ✅ operator-ruled 22 Aug 2026

The operator settled both judgment calls from D81:

> *"root and branch you are correct, it is the same place just double entered.
> boardwalk bar and grill is in Indialantic — merge the melbourne one into that."*

Note the second: **the survivor is the copy with FEWER activities.** Indialantic
held 2 and Melbourne 3, and the bar is in Indialantic. A rule like "keep the row
with more data" would have got it backwards; only the operator knows where the
bar is.

**Checking those two first found a bug that would have quietly reversed the
work.** Both differ from the 15 merged earlier in one way that turns out to
decide everything: **each folded copy carries its own `hubspot_company_id`.**

`sync_hubspot.apply()` pre-loads venues into a dict keyed `("id", company_id)`,
then inserts a fresh venue for any identity **not** in that dict. Delete a venue
and its company id is gone from the portal — so the next sync does not recognise
it, and **inserts the duplicate straight back.** The partial unique index does
not stop it either: `venues_name_unique_without_hubspot_id` only covers rows
with a NULL company id, and the recreated row has one.

The 15 merged earlier were safe **by accident** — all carried NULL company ids,
so there was nothing to come back as. Root+Branch and Boardwalk would both have
returned on the next real sync, which is item 8 on the open list.

**This is the lesson `merge_activity_type()` already learned**, and its own page
says so: it repoints the aliases *"so a future import of the old raw string
resolves to the merged type instead of recreating what you just merged away"*.
Venues had no equivalent. `promote._resolve_venue()` happens to fall back to a
name match and would have survived — but the sync's pre-load loop runs first and
has no name fallback, and the name fallback itself stops working the moment a
surviving venue is renamed.

**`venue_hubspot_alias` closes it.** `merge_venue()` records the folded venue's
company id against the survivor; the sync's pre-load and `promote()` both
consult it. `05_venue_merge_test.sql` now gives the folded twin its own company
id and asserts the alias exists and points at the survivor — *"the folded
venue's HubSpot id was forgotten — the next sync will recreate it"*.

**The merges, and what the combining rule saved.** Root+Branch was the case D81
predicted:

| | before | after |
|---|---|---|
| Blue Run status | `pitched` on the survivor, `placed` on the folded copy | **`placed`** |
| `first_placed_on` | null on the survivor | **2025-08-22** |
| `last_touched_on` | 2025-09-05 / 2025-08-22 | **2025-09-05** |

Keeping the survivor's row — the obvious implementation — would have downgraded
a placed account to a pitch and binned the date it was placed.

Boardwalk reported *4 statuses combined, 0 moved* where 2 and 2 were expected,
and the reason is worth recording: **moving the activities first fires the
trigger that creates a status row per brand**, so by the time the statuses were
reconciled the target already had all four. The combining rule then took the
better value on each. Correct either way, but it means "moved" will usually read
0 — the trigger gets there first.

**Result: 336 venues, zero duplicate names, 1,255 activities and $116,751.65
revenue both unchanged.** Down from 353 at the start of the day. Snapshots of
every deleted row and its statuses are in `Hubspot/venue_merge_backup_*.json`.

**Still open, and deliberately not touched:** `Crown Lounge` carries the city
**"Locals Eatery & Bar"** — a venue name in the city column.

---

**D83 — The staging zone protects DEALS, not venues and brands. That boundary was not written down anywhere, and it is the reason D82 was possible.** ✅ operator-questioned 22 Aug 2026

On being told a merged venue would come back on the next sync, the operator
asked the right question:

> *"I thought we developed a staging and landing area to prevent syncs from
> messing things up."*

**It was, and it does — for deals.** D64 is intact. The gap is one of scope, and
nothing in `CLAUDE.md`, `PORTAL_PLAN.md` or D64 itself said where the boundary
falls. `sync_hubspot.apply()` does four things, in this order:

| # | step | staged? |
|---|---|---|
| 1 | upsert into `brands` | **no — direct write** |
| 2 | upsert into `venues`, then update `venues.city` | **no — direct write** |
| 3 | land deals into `staging.hubspot_deals` | yes |
| 4 | promote only rows in state `auto` | yes, and gated |

Steps 1 and 2 run **before** the staging zone is reached. So the protection the
operator was relying on — hand edits survive, a conflict stops and asks — has
never applied to a venue or a brand. That is why D82's merged venues would have
been silently recreated: the recreate happens in step 2, and step 2 has no
review queue, no `hand_edited_at`, and no conflict state.

Whether that is right is a real question rather than an obvious bug. Deals carry
hand-corrected money and classification; venues and brands were treated as
reference data that HubSpot owns. **But two things make the boundary bite:**

**1. A merge is a human decision about venue identity, and step 2 does not know
it happened.** Fixed for company ids by `venue_hubspot_alias` (D82). Nothing
equivalent exists for brands.

**2. `venues.city` is overwritten by HubSpot on every sync, unconditionally.**

```sql
update venues set city = %s, updated_at = now()
 where id = %s and (city is distinct from %s)
```

The comment above it says a hand-entered value *"is never blanked by an empty
CRM field"*, and that much is true — no update is issued when HubSpot's city is
empty. **But when HubSpot HAS a city, it wins.** A city corrected in the admin
reverts on the next sync, with nothing reported.

That is not hypothetical: `Crown Lounge` currently carries the city
**"Locals Eatery & Bar"** — a venue name in the city column, almost certainly
straight from the HubSpot company record. Correcting it in the admin would hold
only until the next sync.

**Recorded, not fixed.** Giving venues the D64 treatment — a `hand_edited_at`
that makes the sync stop and ask — is a design decision with the same shape as
D64 itself, and it is the operator's to make. It is on the open list.

**The narrower lesson.** D64's write-up says *"HubSpot lands in staging; a person
promotes it"*, which reads as a statement about the whole sync. It is a statement
about deals. A protection whose scope is not written down gets remembered as
broader than it is — by the operator, and by whoever writes the next feature on
top of it.

---

**D84 — The portal is the source of record; HubSpot becomes an input. A hand-edited venue now wins, and the disagreement is kept.** ✅ operator-ruled 22 Aug 2026

> *"Really we will be moving away from HubSpot, so this will become our central
> source of data — and until we are completely done with HubSpot, that will be
> more for data collection."*

**This inverts the default.** Every sync decision to date assumed HubSpot owned
the record and the portal reflected it: D59 ("fix it in HubSpot, let the sync
carry it through"), D64's staging zone, the venue upsert running outside it
(D83). From here the portal holds the truth and HubSpot is one input to it.

**The exposure is far smaller than the ruling sounds, and saying so precisely
was most of the work.** Auditing every writer that touches a venue or brand:

| writer | what it does to an EXISTING row |
|---|---|
| `sync_hubspot` insert loop | new venues only — skips anything already cached |
| `on conflict (hubspot_company_id)` | `updated_at = now()` — overwrites nothing |
| `sync_hubspot` city update | **overwrites `city` — the entire surface** |
| `promote()` | inserts when unknown, never updates |
| `seed_from_csv` | inserts when unknown, never updates |
| `brands` upsert | `on conflict (name) do update set updated_at` — overwrites nothing |

So **`venues.city` was the only field the sync could overwrite**, and **brands
needed no protection at all** — the sync can create a brand but has never been
able to change one. A cathedral was not required, and building one would have
been the wrong instinct.

**The fix, and the half that is easy to miss.** `venues.hand_edited_at` /
`hand_edited_by` mirror `activities` (D64) down to the column names, so there is
one idea here and not two. The admin's venue form stamps them on save.

The obvious implementation — `and hand_edited_at is null` on the UPDATE —
**trades one silence for another.** Before D84 a hand-fixed city reverted with
nothing reported. With the lazy fix, HubSpot's disagreement vanishes with
nothing reported. Neither tells the operator anything, and the second is worse
because it feels solved.

So a refused change is **kept**. `set_venue_city_from_hubspot()` is one function
doing both halves together — a caller that remembers the skip and forgets the
proposal recreates exactly the silence this decision exists to remove — and
`staging.hubspot_venue_proposal` holds what HubSpot wanted. The Venues page
lists them: **Take HubSpot's** or **Keep ours**.

Four behaviours that only show up once it runs twice, all asserted in
`db/test/06_venue_handedit_test.sql`:

- **A venue nobody edited still takes HubSpot's city.** The goal is to stop hand
  edits being clobbered, not to stop the sync working — while HubSpot is still
  the collection tool, most venues must keep flowing.
- **Re-syncing does not pile up duplicates**, and the *same* refused value does
  not re-open a dismissed proposal. A panel that nags forever gets ignored.
- **A DIFFERENT value DOES re-open it.** Dismissing "Melbourne" is not a
  decision about "Palm Bay", and treating it as one hides the next disagreement
  behind the last.
- **Agreement is not a conflict.** If HubSpot catches up to our value the
  proposal clears itself, rather than showing a settled argument for ever.

The test was confirmed to fail on the lazy fix — *"the refused change was not
recorded — HubSpot disagrees and nobody will ever know"*.

**Proved end to end on the live row it was written for.** `Crown Lounge` carries
the city **"Locals Eatery & Bar"**, straight from its HubSpot company record.
Run against live and rolled back:

```
start:            Crown Lounge city='Locals Eatery & Bar' protected=False
sync, unedited:   city='Locals Eatery & Bar'   (HubSpot still owns it)
after your edit:  city='Indian Harbour Beach'
after next sync:  city='Indian Harbour Beach'  overwritten=False
flagged for you:  HubSpot wanted 'Locals Eatery & Bar', dismissed=False
```

**No backfill.** Nothing records which of the 336 venues were already corrected
by hand, so nothing is marked protected today; the flag is set from the next
edit onward. Marking all 336 would freeze HubSpot out of venues it should still
be feeding while it remains the collection tool.

**What this does NOT yet cover, and should be revisited as HubSpot recedes:**
venue *name* (the sync only sets it at insert, so it is already safe by
accident rather than by rule), and brands (safe for the same reason). Both
become real questions the moment anything starts updating them.

---

**D85 — The Duplicates page told the operator to do something the app could not do, and had no way to say "not a duplicate".** ✅ operator-reported 22 Aug 2026

Two reports from using the page, and they are the same fault twice: **the page
could refuse, and it could not help.**

---

**1. "I can't delete a duplicate because it says a photo is attached. How do I
transfer the photo, or what's the workaround?"**

There was no workaround. The branch read *"Deleting it would orphan them. Move
the photos first"* while nothing anywhere in the app could move a photo. **A
guard with no escape hatch is a wall.**

**The guard is right; its wording was wrong, and the wrong word mattered.**
`photos.activity_id` is `ON DELETE CASCADE`, so deleting the activity does not
*orphan* the photos — it **destroys** them, silently, along with the only visual
record that the work happened. Refusing was correct. Refusing with no way
forward was the bug.

**Why a function and not `update photos set activity_id = …`.** There is a
partial unique index on `photos (activity_id, content_hash)`, so the plain
update raises the instant the surviving activity already holds the same
*image* — and that is not an edge case, it is **the normal case**. Checked
against live: 44 North at Chefs Table, two rows, two photo files, and

```
44-north/2026/04/212876649137.jpg   hash 31e31414…
44-north/2026/04/211037705049.jpg   hash 31e31414…
```

— **the same photograph**, uploaded to HubSpot twice as two files. **18 of the
duplicate pairs carry photos**, so the naive move would have failed exactly
where it was most wanted. Same shape as the venue merge colliding on
`brand_venue_status` (D81).

`move_activity_photos()` moves what can move, drops a copy the target already
holds, and **returns the freed storage paths** rather than swallowing them — the
files stay in the bucket, and a caller who does not know they are now
unreferenced can never tidy them up. A photo with **no** `content_hash` always
moves and is never treated as a duplicate: rows predating that column would
otherwise vanish.

`db/test/07_move_photos_test.sql` pins two things. It asserts a **bare UPDATE
still collides** — so if the unique index ever goes, the careful version cannot
quietly become pointless without anyone noticing. And it asserts **the cascade
is real**, because the Duplicates guard was written for a cascade and would need
revisiting if the FK ever became `SET NULL` or `RESTRICT`.

---

**2. "It has Wildflower a case sale and tap placement as a potential duplicate.
They aren't, but I have no way of saying that."**

Correct on both counts. The pair query joins any two **depletion** activities at
one brand/venue inside the window, and `case_sale` and `tap_placement` are both
depletions. The live pair, with its own notes attached:

| | |
|---|---|
| 2026-06-24 · Case Sale | *"Sold in case of Huck for new Sangria on tap to build on Thursday"* |
| 2026-06-25 · Tap Placement | *"Finalized sangria on tap for ongoing 44N featured drink"* |

Sold the case to build the tap; finished the tap the next day. **Two jobs**, and
the notes say so plainly.

`activity_duplicate_dismissed` mirrors `venue_duplicate_dismissed`, for the
reason that table already records: **a suggestion that cannot be rejected comes
back every month and trains the operator to ignore the page**, which costs far
more than the duplicates do.

Keyed on the ordered pair, with a check constraint holding the same order the
query emits, so one judgement cannot be stored twice under two spellings.
`ON DELETE CASCADE` both sides — a judgement about a deleted row is meaningless,
and leaving it would silence a future pair that reused an id. Deliberately **not**
keyed on the dates or types: the judgement is that these two ROWS are different
events, and correcting a date afterwards should not reopen the question.

**Dismissals are reviewable and reversible.** A dismissal that cannot be seen is
indistinguishable from a bug — rows vanish and nothing says why. The page lists
every judged pair with its reason and a **Suggest it again** button.

Verified through the page: **8 pairs → 7**, Wildflower gone, *"Pairs marked as
different events (1)"* showing the reason and the undo.

---

> Both halves of this are the same lesson, and it is the one D74–D79 kept
> teaching: **the failure was not in the data or the logic. It was that a person
> using the page reached a dead end.** No test could have found either, because
> both were about what the page did *not* offer.

---

**D86 — What "pitched" and "placed" actually mean, and the two rulings that make the account list tell the whole story.** ✅ operator-ruled 22 Aug 2026 · **NOT YET IMPLEMENTED**

The operator asked what decides pitched vs placed, having seen Wildflower read
`pitched` when he knew it was placed.

---

**THE RULE, as it stands today.** `brand_venue_status.status` is set by the
trigger `sync_brand_venue_status()`, which fires `after insert or update of
venue_id, brand_id, activity_date, activity_type_id on activities`:

| what happened | status becomes |
|---|---|
| nothing yet | `prospect` (the column default) |
| any **non-depletion** activity — visit, drink list, training, drink development | `pitched` |
| any **depletion** activity — `case_sale`, `tap_placement`, `recurring_case`, bottle sales | `placed` |
| `reordering`, `dormant`, `lost` | **never set by anything** |

It only ever **advances**, and only as far as `placed`. It never downgrades, so
a placed account cannot be knocked back to pitched by a later visit. **The
single fact that decides it is `activity_types.is_depletion`** — did product
actually move.

**The Wildflower case: the portal was right, and it is a different bar.**

| venue | city | activity | status |
|---|---|---|---|
| **Wildflower Sanford** | Sanford | 20 activities incl. case sales + tap placement | `placed` ✓ (both 44 North and Wodka) |
| **The Wildflower** | Baldwin Park | ONE drink list placement, 1 Jul 2025 | `pitched` ✓ |

Two different premises, two different HubSpot company ids, 40 miles apart. The
`pitched` row is Baldwin Park, which has had a drink list and nothing else — no
depletion, so `pitched` is correct. Not a bug, and worth recording because the
names are close enough that it will be misread again.

---

**RULING 1 — a reorder advances the account to `reordering`.** ✅ operator, 22 Aug

**21 brand/venue pairs have logged case reorders and every one still reads
`placed`.** The status stops at `placed` and never moves again, so the portal
never shows a brand the one thing it most wants to see: they bought again.

> *Chosen: "Yes — auto-advance on a reorder."*

The reasoning that decided it: **a reorder is a fact, not a judgement.** The
original design note grouped `reordering` with `dormant` and `lost` as "human
judgements the trigger must not overwrite" — correct for the other two, wrong
for this one. If a `recurring_case` row exists, the account reordered.

Affected: **20 Wodka pairs, 1 44 North.** Note D35's warning still applies —
`recurring_case` is only logged for brands that pay for reorder tracking, so an
absence means "not measured", never "no repeat business".

**RULING 2 — a venue quiet for 180 days is marked `dormant`.** ✅ operator, 22 Aug

Nothing is ever marked `dormant` or `lost` either. Offered three thresholds;
the operator chose **180 days**, the widest.

> *Chosen: "Auto-mark dormant after 180 days quiet." — **360 of 689 pairs**,
> over half the account list.*

That is a big, deliberate change to what every brand sees, and it was chosen
over the conservative one-year option (42 pairs) and over leaving it to the
days-quiet colouring already on `venues.html`. **It is honest**: an account
nobody has walked into in six months is not an active account, and saying so is
the point of the column.

**Implementation notes for whoever picks this up:**

- `dormant` must **not** be sticky the way `placed` is. A dormant account that
  gets visited has to come back to life, or the flag is a one-way door and the
  column becomes wrong in the other direction within a month. The advance-only
  logic in the trigger is exactly what must NOT be copied here.
- It cannot live in the insert trigger alone: nothing fires when a venue simply
  goes quiet. It needs either a scheduled job or — better and simpler — to be
  **derived in the view** from `days_since`, leaving the stored column for what
  a person or an activity set. Deriving it also makes it self-correcting, which
  handles the point above for free.
- `lost` stays a human judgement. Nothing proposed here sets it.
- `venues.html` already renders `reordering` and `dormant` pills and orders by
  them (`STATUS_ORDER`), so the front end needs no work for either ruling.

---

**BUILT 23 Aug 2026.** Both rulings are live and the numbers came out exactly as
D86 predicted: **21 pairs advanced to `reordering`** (20 Wodka, 1 44 North) and
**360 of 689 pairs read `dormant`**. 1,255 activities and $39,201.65 of activity
charge unchanged — this moved no money, only what the account list says.

How each half landed, and why:

- **The reorder is a FLAG ON THE TYPE, not a code in the trigger.**
  `activity_types.is_reorder`, read exactly the way `is_depletion` already is.
  Writing `code = 'recurring_case'` into the trigger would have been shorter and
  would have been a rule the operator cannot reach (D60) — and the business
  already has a SECOND reorder type. `bottle_reorder` (Dame Mas, 11 pairs) is a
  reorder by every plain reading of the word and is deliberately **left
  unticked**: turning it on is a checkbox on the Activity types page, not a
  decision smuggled in with the mechanism. Ticking it applies retroactively,
  which is the point — see the last bullet.
- **The reorder branch is FIRST in the trigger, and that ordering is the whole
  ruling.** Every reorder type is also a depletion, so testing depletion first
  sets `placed` and stops there for ever. That failure is invisible in the data:
  `placed` is a perfectly plausible status for an account that reordered. It is
  asserted in `08_account_status_test.sql` rather than eyeballed.
- **Dormancy is derived, in ONE function** — `account_status_effective(stored,
  days_since, dormant_after_days default 180)` — called by both
  `v_brand_venue_counts` and `v_venue_performance`. Two views working it out
  separately is how they come to disagree, and the account list is the one
  screen where a brand would notice. The 180 lives in that default and nowhere
  else. `lost` passes through untouched; a NULL `days_since` (24 pairs never
  visited) is not quietness and does not become dormant.
- **The un-dormanting is the assertion the test exists for.** A stored `dormant`
  copying the trigger's advance-only logic passes every other check in the file
  and fails that one. Walk back into the bar and the row comes back to life on
  the next page load.
- **The 21 frozen pairs needed a backfill, and so does every future tick of the
  flag.** The trigger only fires on write, so accounts that had already bought
  again would have sat at `placed` for ever. `schema.sql` carries an idempotent
  backfill, and the Activity types page runs the same update when the operator
  turns `is_reorder` ON for a type — otherwise ticking the box would only
  affect work logged from that moment, which is not what ticking it means.

---

**D87 — D86's "the front end needs no work" was half true, and the half that was
wrong is the number brands care about most.** ⚠️ found 23 Aug 2026, while
building D86

The pills were fine. **The stat cards on `venues.html` were not**, and nothing
about them would have looked broken.

Three of the four cards counted `r.status`, which is now the EFFECTIVE status.
The moment 360 pairs began reading `dormant`:

| card | said | would have said | why |
|---|---|---|---|
| Stocking your brand | 218 | **116** | 102 stocking accounts went quiet and left the count |
| Pitched | 471 | **213** | 258 pitched accounts went quiet |
| Quiet 90+ days | 148 | **46** | everything past 180 became `dormant` and stopped matching |

Read the third row again: a card **labelled "Quiet 90+ days" would have counted
only accounts quiet between 91 and 180**, dropping the ones that had been quiet
longest — the exact accounts it exists to surface. It would have gone DOWN as
the situation got worse, and the page would have rendered perfectly.

**THE RULING: the account list DISPLAYS the effective status and COUNTS the
stored one.** `status_stored` is appended to both views for that, and the cards
read it. A brand still sees the dormant pill on the row; the account is still
counted as stocking, because it is.

The general shape, and it is the third time this project has met it (the D78
expenses branch and the business-page filter were the others): **layering a
derived value over a stored one silently re-scopes every filter and count
already written against it.** Adding the derivation is the easy half. Finding
what was counting on the old meaning is the work — and a page that keeps
rendering is not evidence that it did not happen.

---

**D88 — Venue grading and ownership, and why they are a table of their own.**
✅ operator-ruled 23 Aug 2026

The operator asked for an A/B/C/D grade per venue and a contractor who owns it,
editable in a grid and loadable from a CSV. Three questions were put to him and
all three were answered the conservative way:

| question | ruling |
|---|---|
| grain | **Venue-level**, not per brand/venue pair. A bar's calibre does not change because a different brand is on the back bar, and "who owns the venue" is one person. |
| visibility | **Staff only**, both. |
| scope | Columns, grid and CSV now. HubSpot's deal owner is a later job. |

**THE VISIBILITY RULING IS WHY THIS IS ITS OWN TABLE, and it is not a stylistic
choice.** Two columns on `venues` would have been readable by every brand login
and no view could have stopped it: `venues_select` lets a brand read any venue
row it is related to, and **the grant is on the TABLE, not on a column list** —
so `select *` through PostgREST returns whatever columns exist there. A brand
discovering we graded them a D is a conversation to choose, not one the schema
starts. Column-level grants would technically work and are the wrong tool: every
future column would have to remember to opt out, and the one that forgets is
silent.

So `venue_grading` follows the shape `rate_card`, `contractors` and
`contractor_pay` already set — own table, RLS on, revoked from `anon` and
`authenticated`, gated behind `is_staff()` — and
`09_venue_grading_test.sql` asserts the lockdown rather than trusting it (D62).

**A merge would have destroyed the grade, silently.** `venue_grading.venue_id`
is `ON DELETE CASCADE`, so folding a graded venue into an ungraded one deletes
the grade along with the row, and the result is indistinguishable from a venue
nobody ever graded. Exactly the trap D85 found with photos. `merge_venue()` now
carries it across: the **target wins** where both are graded, because it is the
row the operator chose to keep and a grade is a judgement rather than a fact to
be combined the way the statuses are; a **gap on the target is filled** from the
source rather than thrown away. Confirmed by deliberately regressing the
function and watching the test fail.

**The CSV is keyed on the venue id, never on the name.** A name key breaks the
first time a venue is renamed or merged, and it breaks by matching the WRONG row
rather than by failing — the one outcome worth engineering against. Unrecognised
ids, invalid grades and unknown contractor names are reported and skipped, never
coerced, and nothing is written until the dry-run diff is confirmed. A CSV
restates all 336 rows at once, so the diff is the only thing standing between a
stray Excel fill-down and eighty venues silently regraded.

**A blank grade means NOT GRADED YET.** Both columns ship empty and null must
never be read as a bad grade. Noted here because it is the kind of thing a
future query gets wrong.

**Still open, and deliberately:** `bottle_reorder`-style ownership from HubSpot.
`hubspot_owner_id` is not in `DEAL_PROPERTIES`, so **deal ownership is not in
this database at all** — not even in the `payload` jsonb, because HubSpot only
returns the properties you ask for. Deriving "who actually worked this account"
needs a sync change plus the owners API, and then the D84 shape: the declared
owner wins, HubSpot's disagreement becomes a review queue for the venues where
two contractors both have activity.

---

**D89 — `st.stop()` had been killing an entire admin tab since the day it was
written, and the page looked perfect.** ⚠️ found 23 Aug 2026

While adding the grading tab, it rendered blank. So did **"Edit a venue"**, on
the unmodified page — which meant it was not the new code.

`st.stop()` **halts the entire script run**, not the block it sits in and not
the tab it sits in. It sat inside the merge tab's "you have not picked two
venues yet" branch — **which is the state on every single page load** — so the
run died before `with edit_tab:` was ever reached. The tab LABEL rendered,
because `st.tabs()` had already been called. The tab was empty. Nothing raised,
nothing was logged, the Streamlit console was clean, and the page looked
entirely normal: three labels across the top, one of them dead.

Replaced with an `else:`. It was the **only** instance in the admin that sits
after an `st.tabs()` call — every other `st.stop()` guards a page before its
tabs exist, which is the correct use.

**THE RULE THIS CHANGES.** D79 established: open every PAGE in a browser, every
session. That rule would never have caught this, and did not — the Venues page
opens fine and reports 336 venues. **Open every TAB.** A tab is a page you
cannot see, and this project now has two separate faults (D79's four pages, this
one) that were invisible to everything except a human clicking.

Worth noting what did NOT find it: 103 pytest, the eight-file offline schema
suite, `verify_live.py`, and `test_admin_sql.py` — which exists specifically to
catch render-time faults in this app's source, and which passes on the broken
version because the bug is control flow, not SQL.

---

**D90 — "The Aspen Green numbers don't make sense." They made perfect sense, and
that was the problem.** ⚠️ operator-reported 23 Aug 2026

Two questions off the Analysis page: where did $2,676.40 of uncosted charge come
from, and why does Aspen Green look wrong. Neither was a bug. Both were the
rate card telling the truth about figures nobody had looked at.

**THE $2,676.40 IS NOT NEW AND NOT A FAULT.** It is D78's measurement, filtered
to what the page was showing — active brands, the last thirteen months. All
time it is **$6,568.90 across 37 activities and 12 types**. Every one is a
rate-card line with a `charge_rate` and no `pay_rate`, so contractor cost
resolves to $0 rather than to unknown. Entering those twelve pay rates is
already open item 3 in the handoff, and some of them correctly have none —
work covered by base pay, which is a company cost (D67).

**ASPEN GREEN READ $0.00 MARGIN MONTH AFTER MONTH, and the cause was two
numbers.** `1st case sale` and `recurring case` are charged at **$5.00** and
paid at **$5.00**. Every case Aspen Green sells earns exactly nothing. For
comparison, the same work is charged $60 by four brands, $50 by 44 North and
$10 by Wodka.

The one month that was NOT flat — June 2026, $1,154.90 — is worse rather than
better: **$1,079.90 of it is uncosted**, nine Fresh Market incentives at $100
with no pay rate plus $179.90 of mileage. The only Aspen Green month showing a
margin shows one because most of it has no cost recorded.

---

**RULING 1 — clicking a brand-month opens it.** ✅ operator-asked, 23 Aug

> *"Are we able to make it where if I click on a brand row... it either opens up
> that month or brings me to that month for that brand?"*

A total is the shape that hides its own explanation. The detail opens **below
the table, not in another tab**: the question being asked is "what is in this
number", and answering it somewhere else means losing the number while you look.

It does not only list rows. It states **which of three things happened**,
because each misleads in a different direction and they are easy to confuse:

| | what it means | which way it lies |
|---|---|---|
| `unpriced` | no rate-card line at all | revenue **understated** — someone chases the invoice |
| `uncosted` | charged, no pay rate | margin **overstated** — nothing looks wrong (D78) |
| charge ≤ pay | fully priced, earns nothing | neither. The arithmetic is right; the RATE is the problem |

The third has no flag on the activity and cannot have one: it is not a data
fault. It is a priced decision that loses money.

The money tab became an `st.fragment` at the same time, so a click re-runs that
table and nothing else — not the venue grouping, the city grouping or the full
activity list, none of which a click changes.

**RULING 2 — the Rate card page now finds work priced at a loss.** And the
number is much larger than the case that prompted it: **51 activities charged
$2,040.00 against $3,335.00 of pay — a margin of MINUS $1,295.00.**

| brand | type | charge | pay | n | margin |
|---|---|---|---|---|---|
| Wodka | `1st case sale` | $10.00 | $25.00 | 33 | **−$1,140.00** |
| Dame Mas | `staff training` | $0.00 | $50.00 | 3 | −$150.00 |
| 44 North | `recurring case` | $0.00 | $5.00 | 1 | −$5.00 |
| Aspen Green | `1st case sale` | $5.00 | $5.00 | 12 | $0.00 |
| Aspen Green | `recurring case` | $5.00 | $5.00 | 2 | $0.00 |

**THE CHECK READS `v_activity_money`, NOT `rate_card`, AND THE FIRST VERSION OF
IT GOT THAT WRONG — which is the lesson worth keeping.** A charge and a pay for
the same work **do not have to live on the same row**. Wodka's `1st case sale`
carries a brand line charging $10.00 with no pay at all; the $25.00 comes from
the shared `(all brands)` line. Comparing `charge_rate` to `pay_rate` *within* a
`rate_card` row cannot see that pairing — so the first version reported the two
Aspen Green lines worth $0.00 and **missed 33 Wodka activities worth −$1,140,
the largest instance, invisible to the very check written to find it.** It was
caught only because the drill-down computes the same thing per activity and
disagreed.

The rule that generalises: **when a check and the money disagree, the money is
right.** The view already resolves the brand-line-over-shared-line precedence
exactly as the billing does. Any check that re-implements that precedence is a
second pricing implementation, and D48 already established what happens to
those.

**NOT ALL OF IT IS WRONG, and the page says so.** Work done at no charge still
costs what the contractor is paid, and 44 North's `recurring case` is paid and
never charged **by design** — it is on no invoice on purpose, and the handoff
has said so since 21 Aug. The page lists and quantifies; which figure to change
is business data and belongs to the operator (D60).

---

**D91 — The rate table is editable, mileage pays out in full, and two
constraints had never reached the live database.** ✅ operator-ruled 23 Aug 2026

> *"Are we able to make the current rate table editable? That would make it so
> much easier than using the add or change a rate setup. Keep that for adding a
> rate, but for changing let's just make it editable inside the table."*

**THIS CUTS AGAINST POINT 3 OF THE PAGE'S OWN DOCSTRING, and that tension is
the design rather than something to paper over.** `effective_from` exists so
that last year's revenue is not restated at this year's prices. An in-place edit
does precisely that, silently, to every activity the line has ever priced.

Both acts are real and they are **different**:

| | should it reach back? | how |
|---|---|---|
| **Correcting** a rate that was always wrong | **Yes** | edit in the table |
| **Changing** a price from a date forward | **No** | new row, later `effective_from` — the form |

Aspen Green charging $5.00 a case when it should have been $50.00 was never
true (D90); a new row dated today would leave every historical month still
wrong. So the grid edits in place, and the difference is made **visible**
instead of being left to memory: nothing saves until the money impact is shown.

**THE IMPACT IS MEASURED BY APPLYING THE EDIT AND ASKING THE VIEW, INSIDE A
TRANSACTION THAT IS ROLLED BACK.** It is never recomputed in Python. That is
D90's lesson applied one decision later: a check that re-implements how a charge
and a pay pair up missed the largest instance of the thing it was written to
find. `v_activity_money` already resolves brand-line-over-shared-line precedence
and `effective_from` ordering exactly as the billing does, so asking it is both
simpler and correct by construction. Verified against live: correcting Aspen
Green's two case lines to $50.00 previews as **+$11,520.00 of charge across 14
activities already on file** — which is exactly the number a person needs to see
before agreeing to restate history.

`brand` and `source_activity_type` stay read-only. Changing either does not
amend a rate, it points it at different work — which is an add, and the form
already does adds properly.

---

**RULING — mileage is a 100 percent pass-through.** ✅ operator, 23 Aug 2026

> *"All cases of mileage is 100% paid out to the contractor. So if we charge
> $180 in mileage for one event all 180 goes back, iHospitality keeps none of
> it."*

Eight rate lines, every brand, all charging **$0.70 per unit with no pay rate at
all** — which is why mileage was $1,243.90 of the uncosted total and the case
the operator first named on 21 Aug ("mileage belongs in revenue with a cost
behind it").

**The pay rate is set FROM the charge rate rather than typed**, so the two
cannot drift apart if either is ever changed.

| | before | after |
|---|---|---|
| activity charge | $39,201.65 | $39,201.65 (unchanged, correctly) |
| contractor cost | $21,466.18 | **$22,710.08** |
| charge with no cost behind it | $6,568.90 | **$5,325.00** |
| mileage margin, every brand | — | **$0.00** |

Mileage now appears in the "priced at or below what it pays" list, which is
**correct and must stay**: a zero margin is the right answer here, not a missing
number. The page says so explicitly, alongside the other two deliberate cases
(44 North's `recurring case`, and n/c work that still costs), so nobody "fixes"
them next month.

---

**FOUND WHILE BUILDING IT — the one-basis CHECK constraints had never reached
Supabase.** ⚠️

`rate_card_charge_one_basis` and `rate_card_pay_one_basis` are declared in
`create table if not exists rate_card`, which **does nothing when the table
already exists**. They were therefore real on every fresh install and in every
run of the offline suite, and **absent on the live database**.

Discovered by deliberately writing `charge_rate` and `charge_pct` in a single
edit to watch it be refused — and watching it succeed instead, silently pricing
the line at $0.00.

Restated as a guarded `ALTER`, exactly as `rate_card.per_unit`'s default already
had to be a few lines above. Zero rows violated them, so adding was safe. The
guard checks only for the constraint's EXISTENCE, deliberately: if a row ever
does violate this, the ALTER must fail loudly and stop the schema run, because
skipping a constraint quietly is how this one came to be missing in the first
place.

Two standing lessons, both already on the books: **D6** — local Postgres and
Supabase disagree, in both directions, about things this file claims to
guarantee. **D62** — a constraint nobody has exercised looks exactly like one
that works. This is the seventh instance.

---

**D92 — The money fields on "Add a rate" could never be enabled, by anyone, ever.**
⚠️ operator-reported 23 Aug 2026

> *"In the add or change a rate form I cannot type in the charge amount or the
> pay amount or the percentage. The cursor turns into a red null sign."*

The four money fields are disabled until the **Basis** radio beside them says
which basis that side uses — a good guard, because a line carries a rate OR a
percentage and never both. The radio defaults to `none`, so all four start
disabled. **That is correct, and it was meant to last one click.**

**Inside `st.form` it lasted for ever.** A form does not rerun the script when a
widget inside it changes — that batching *is* the point of a form — so
`charge_basis` still read `"none"` when the `number_input` below it was
constructed, on every render, whatever the radio was showing on screen. Picking
"amount" changed nothing until the form was submitted, and submitting with no
basis was refused by the form's own validation two lines further down. **There
was no sequence of actions that could enable them.**

**THE FIX IS NOT TO REMOVE THE GUARD — it is to stop batching.** The block is
now live widgets inside an `st.fragment`: the radio enables its field on the
click, and the reactivity costs one function call rather than a page reload.
Verified in a browser by clicking each basis in turn, watching exactly the right
field enable and the other three stay disabled, and typing a value into it.

**A regression of my own, in the same file, found the same way.** "Retire a rate
line" read a module-level `card` frame that the previous commit had made local
by moving the rates query inside the grid's fragment, so it raised `NameError`
on render. It now runs its own query rather than reading a variable another
section happens to leave lying around.

---

**THE CLASS IS NOW A TEST**, and this is the durable part.

`test_admin_sql.py` grows a third checker: **a widget inside `st.form` whose
`disabled=` is not a constant.** Constants are allowed — `disabled=True` cannot
depend on a widget and is a fine way to render something permanently read-only —
and `form_submit_button` is exempt, because it *does* re-evaluate on submit,
which is the one place inside a form where a computed disable behaves sensibly.

Confirmed to **FAIL on the pre-fix file**, naming both offending lines (D62).
103 tests → 118. It was the only instance in the admin.

**WHY IT SURVIVED EVERYTHING.** The page raises nothing. It renders every
widget. Both existing checkers pass on it. `verify_live.py` is clean, the schema
suite is green, and the page opens perfectly — I opened it myself, twice, in
this same session, while building the editable grid directly above it.

D79 said: open every page. D89 added: open every tab. **D92 is the same lesson
one step further in — opening a page is not USING it.** Three separate faults
now (D79's four pages, D89's dead tab, this) have been invisible to everything
except a person interacting with the thing. The static checks exist precisely
because that person is not always available, and each new fault should leave one
behind.

---

**D93 — Dame Mas reconciled to the invoices, and the 50 `account sold` rows
classified from the operator's own workbooks.** ✅ operator-ruled 23 Aug 2026

The operator asked why Dame Mas showed so many unpriced rows still reading
`account sold`, and pointed at the invoice PDFs and the two activity workbooks:
*"If you are not sure which account sold is a bottle sale or an account visit
lets use the data... Also use the notes in the deal as a guide. They arent 100%
fact but a good guide."*

**The canary now reads 13 months tying, 0 billed-but-missing, 0 drifted.** It
read 4 and 3 that morning.

---

**WHAT THE TWO SOURCES ACTUALLY CONTAIN**, established before deciding anything:

| source | gives | does not give |
|---|---|---|
| 13 invoice PDFs, Jul 2025 – Jul 2026 | commission, gross, retainer, itemised expenses, per month | anything per venue |
| the workbooks, 245 rows | per-venue events, SKU, bottle counts in the notes | dollars outside Apr–Jul 2026 |
| the Account Sold Summary | per-venue bottles and dollars | Apr–Jul 2026 only |

**RULING 1 — the missing months are recorded at MONTH level.** $3,307.28 of
commission across Jul 2025 – Mar 2026 was absent entirely. It is now one row per
month carrying that month's gross as its `amount`, priced by the brand's
existing 10 percent / 8 percent card — $2,645.82 of contractor cost, $661.46
net, and no special case anywhere in the money model.

**The per-venue alternative was TESTED, not assumed, and it fails.** Deriving
dollars from the bottle counts in the notes requires a stable bottle price and
there isn't one: $123.00 (Reposado) to $210.75 (Extra Anejo), with case
discounting on top, so Executive Cigar's 24 bottles price at $163.875 each while
Dancers Royale's six price at $207.75. October 2025 reconstructs to roughly
$5,000 against $6,533 invoiced. **The gap is D51's finding restated** — the
depletion report counts every bottle moved through every account, including
reorders nobody logged an activity for. The activity log is a subset and always
will be.

**The double-count guard is COMPUTED, not a date range.** Any month already
carrying percentage-priced rows is skipped, so Apr–Jul 2026 — where the
venue-level depletion is loaded and ties exactly — are left alone, and loading
another depletion summary tomorrow stops the monthly row for that month by
itself. Writing both is precisely what D51 warned against.

**RULING 2 — classification only, no money.** `classify_dame_mas.py` sets
`activities.activity_type_id` and **nothing else**. `source_activity_type` is
deliberately untouched, because that is the column the rate card keys on (D74) —
so no row it touches can start or stop earning. Dame Mas charge and cost are
unchanged to the cent, before and after 46 reclassifications.

| from the notes | rows |
|---|---|
| `bottle_sale` — a placement | 40 |
| `bottle_reorder` — bought again | 5 |
| `case_sale` — cases, unchanged | 4 |
| `account_visit` — never a sale | 1 |

The operator's warning that the notes are *"a good guide, not 100% fact"* is
taken literally: a note moves a row only when it says something unambiguous
("1 bottle reorder", "Sold in 4b of the Repo", "Walked in to set an
appointment"). Three rows with no note anywhere were left exactly as they were.

---

**THREE THINGS FOUND ON THE WAY, each worth more than the task that found it.**

**1. Every invoice must add to its own stated SUBTOTAL, or nothing is written.**
The first parser matched expense lines on the word "engagement" and was wrong
three separate ways: `"minimum 80% staff"` parsed as $80.00 once the percent
sign was stripped; `"THE COPPER ROCKET - Dame Mas 50.60"` is an expense and
never says so; and a $534.87 line sat under `"C. Nicolas"` on a wrapped row.
October's expenses read $123.50 against a real **$1,243.95**.

No vocabulary covers descriptions typed by hand each month. What is reliable is
the SHAPE — every charge sits in the item table and ends in an amount with
cents. So the parser takes every such line, names the three that are structural,
and lets the rest be expenses. **Nothing can be silently missed, because
"missed" would mean a line the subtotal does not account for.** Same method as
D51: check money against something that cannot lie about itself.

**2. The workbook and HubSpot disagree about dates by a day or two**, and exact
matching lost the clearest reorder in the set — Chatham's Place, 10 Feb in the
workbook and 11 Feb in HubSpot, note "Reorder for backbar". Same venue within
three days is the same event.

**3. ELEVEN SALE EVENTS ARE IN THE WORKBOOK AND NOT IN THE PORTAL AT ALL** —
verified against the portal month by month, not inferred from a failed name
match. Three February reorders (Mullets, Roasted Spirits, Fillin Station, all
reading "1 bottle reorder" or "1 case reorder"), five March placements
(Executive Cigar, Eden Lounge, Wine Bar George, Mullets, Campi), two August 2025
(Cypress Liquor, Nick & Moes) and Ruby St Grille's July 2025 two-SKU placement.
HubSpot never recorded them. **They carry no money — `account sold` is unpriced
by D51 — so this changes venue status and counts, not revenue.** Not created:
several would require creating venues too, which is a larger act than
reclassifying and belongs to the operator.

**And a consequence worth acting on.** There are now five `bottle_reorder` rows
on Dame Mas, and `bottle_reorder.is_reorder` is still unticked (D86) — so five
accounts that demonstrably bought again still read `placed`. Ticking that box on
the Activity types page is now worth considerably more than the 11 pairs it was
worth this morning.

---

**D94 — Dame Mas pays no per-case rate, and "unpriced" was hiding a decision
behind a gap.** ✅ operator-ruled 23 Aug 2026

> *"Dame Mas shouldn't have 1st case. All Dame Mas sales are paid out as a
> percentage of commission, there is no $25 on that."*

**He was right, and it was costing $325.00.** Dame Mas had no brand-specific
`1st case sale` line, so the shared `(all brands)` **pay** rate of $25.00 reached
its six case sales — $325.00 of contractor cost against **no charge at all**.
Exactly the cross-row pairing D90 was written to find, in a direction D90's
check does not look: there the brand line set the charge and the shared line set
the pay; here there is no brand line whatsoever.

**And the second half of the same question.** The operator was reading 60-odd
activities as "not costed" and asking why, having been told they were fine.
Both readings were correct, which is the problem: the rows are unpriced **by
design** (D51 — the commission carries the money), and the portal was flagging
that design as a fault. *Unpriced* and *deliberately free* looked identical.

**THE FIX IS ONE MECHANISM FOR BOTH: price them at an explicit 0.00 / 0.00.**
Two Dame Mas rate lines, `account sold` and `1st case sale`, doing three things
at once:

| | |
|---|---|
| overrides the shared pay line | the phantom $325.00 is gone |
| turns 56 rows from *unpriced* into *priced at zero* | Dame Mas 63 → **7**, portal-wide 152 → **96** |
| states the rule where the operator can reach it | D60 — no rule compiled into a script |

The same mechanism `account visit` has used since the beginning. The seven Dame
Mas rows still unpriced are genuinely no-charge admin types — `zoom call`,
`market favors n/c`, `tasting event n/c`, `drink development`.

Money unchanged where it should be, corrected where it was wrong: **charge stays
$5,872.43, cost falls $5,214.40 → $4,889.40, margin $983.03.** The placement
rows still earn nothing, which remains the point — the month's 10 percent is
already booked and the contractor's 8 percent with it, so paying per placement
would pay twice for one sale.

---

**THE NINE MISSING SALES ARE IN**, unpriced, with three venues created. **Three
are deliberately held back**: "Mullets" and "Mullets Sprots Bar" against an
existing "Mullets Cigar and Bar" (both Clermont), and "Fillin Station" against
both "Johnny's Filling Station" and "4th Street Fillin Station". D81 is explicit
that a matcher confident enough to fold those would fold `Executive Cigar` into
`Executive Cigar Sanford`, which are different premises forty miles apart. **A
skipped row costs a minute of attention; a wrong merge costs a venue's history
and does not come back.**

**Two faults, both found by running the loader a SECOND time** — which is the
only thing that would have found either:

1. **A shared ratio is not a shared identity.** "Cypress Liquor and Wine" scored
   0.62 against "Tony's Liquor and Lounge" and was held back as ambiguous. They
   have nothing to do with each other; they both sell liquor. Half the venues in
   this business share a word like that, so the raw ratio says almost nothing.
   Ambiguity now requires a shared **distinctive** word — which still catches
   "Fillin Station" against "Johnny's Filling Station" and no longer catches
   every liquor store in Florida.

2. **The duplicate check ran on the workbook's spelling, not the resolved
   venue.** "Eden Loung" was written to "Eden Lounge"; the next run looked for
   "Eden Loung", did not find it, and would have created it a second time.
   Resolve the venue first, then check whether the row exists. **A loader that
   has only ever been run once is not known to be idempotent** — the same shape
   as D62, and the reason the offline suite applies the schema twice.

**And a consequence on the Rate card page.** The D90 no-spread check counts
`charge_rate <= pay_rate`, and 0.00 ≤ 0.00 is true — so the new lines put 65
rows into a warning about work priced at a loss, burying the 58 that really are.
A line charging nothing and paying nothing is a no-op, not a leak, and is now
excluded.

---

**D95 — Two venue rulings, two operator rate entries, and where 23 Aug stopped.**
✅ operator-ruled 23 Aug 2026 · **PARTLY UNFINISHED, DELIBERATELY**

**RULING — "Mullets" is Mullets Sports Bar, Clermont.** The bare `Mullets` in
the workbook (30 Mar 2026) and `Mullets Sprots Bar` (15 Feb 2026, a reorder) are
the same premises, and the depletion summary's `MULLETS SPORTS BAR, CLERMONT`
is that venue's proper name.

**WHAT THE RULING DOES NOT SETTLE, and it must not be assumed:** the portal
holds **`Mullets Cigar and Bar` (Clermont)**, and the operator was asked whether
the cigar bar is the same premises or a second Mullets in one town. He named the
sports bar rather than agreeing they are one, and the workbook's own note for
the cigar bar reads *"New cigar bar in Clermont"* — which reads like a different
room. **Treat them as two venues until told otherwise.** D81 is the standing
warning: `Executive Cigar` and `Executive Cigar Sanford` are forty miles apart,
and a matcher confident enough to fold one pair folds the other.

**RULING — `Fillin Station` is probably its own venue**, distinct from
`Johnny's Filling Station` (Orlando) and `4th Street Fillin Station` (Cocoa
Beach). **Explicitly UNCONFIRMED** — the operator said he believes so but could
not check. Recorded as a belief, not a fact, so nobody later reads it as settled.

---

**OPERATOR RATE ENTRIES, made in the admin the same day**, and both are visible
in the numbers:

| line | charge | pay | effect |
|---|---|---|---|
| Aspen Green · `aspen green fresh market incentive` | $100.00 | **$100.00** | 9 activities, **zero margin** |
| Blue Run · `single barrel sale` | $1,000.00 | $800.00 | 1 activity, $200 margin |

Uncosted charge fell **$5,125.00 → $3,225.00**; contractor cost rose to
$26,890.90 and margin to $15,618.03.

**THE FRESH MARKET INCENTIVE NOW CHARGES AND PAYS THE SAME $100.00**, so it
earns nothing and will appear in the Rate card page's "priced at or below what
it pays" list alongside mileage. That is either a deliberate pass-through — the
same shape as mileage (D91), which would make it correct — or a slip where the
pay was meant to be lower. **Nobody has said which, and the page cannot tell.**
Worth one sentence from the operator, and it is in the handoff as such.

---

**WHERE THE SESSION STOPPED.** Three Dame Mas sale rows are still not created,
all waiting on the venue question above:

| date | workbook name | what it is |
|---|---|---|
| 15 Feb 2026 | Mullets Sprots Bar | a bottle **reorder** |
| 30 Mar 2026 | Mullets | a placement |
| 18 Feb 2026 | Fillin Station | a **case reorder** |

`load_missing_dame_mas.py` is idempotent and re-running it is safe — it reports
0 missing today and will pick these up once the venues exist. Note that creating
`Mullets Sports Bar` makes `Mullets Sprots Bar` match automatically at 0.92, but
the bare **`Mullets` will still read as ambiguous**, because it is then equally
close to both Mullets venues. That row needs an explicit assignment, which the
loader has no option for yet — roughly ten lines, and the shape is already there
in `_resolve_venue`.

---

**D96 — The staff Business page gained the figure the admin got today.**
✅ 23 Aug 2026

The operator asked for the website's staff pages to match the admin panel. They
already agreed on almost everything — `business.html` reads `v_brand_money` and
shows Charged, Contractor cost, Margin, Unpriced and Charged-not-costed, all the
same numbers the Analysis page shows.

**One thing was missing, and it was the one added today: work priced at or below
what it pays (D90).** The page showed Aspen Green's **$75.00 margin on $2,534.90
charged** and said nothing about why — which is the exact confusion that started
D90 in the first place. `unpriced` understates revenue and `uncosted` overstates
margin; this third case is neither, and **it has no flag on the activity because
it is not a data fault — it is a price** — so the page has to compute it.

Added as a stat card and a per-brand column, so a total can be traced to a row:
**−$1,295.00 across 58 activities**, led by Wodka's `1st case sale` at −$1,140.

Three things about the implementation are deliberate:

- **Compared in the browser, not in the query.** PostgREST cannot compare two
  columns to each other. Six small columns are fetched, only for rows carrying
  both rates.
- **Lines that are zero on BOTH sides are excluded**, exactly as the admin now
  excludes them (D94). Dame Mas prices its placements at an explicit 0.00 / 0.00
  because the money is billed as commission elsewhere; counting those would put
  65 rows in a warning about losing money and bury the 58 that are.
- **The card is scoped to the same brands the table shows**, so the active/all
  toggle cannot leave the two describing different populations — the D87 mistake,
  which was counting one thing in the cards and displaying another.

**Not verified: the page rendering while logged in.** It is staff-gated and
there was no session to hand. The module parses and redirects with no console
errors and every column it reads is confirmed present with the right values —
which D79 is explicit is NOT the same evidence as opening it.

---

**D97 — Mullets is one premises, the last three sales are in, and a percentage
row with no amount charges nothing.**
✅ operator-ruled and built 23 Aug 2026 (later session)

**RULING, and it REVERSES the hold D95 put on this.** The operator: *"Mullets
sports bar is also the cigar lounge."* So `Mullets Cigar and Bar` and
`Mullets Sports Bar` are ONE venue, not two. D95 had deliberately treated them
as two pending exactly this answer, and the answer went the other way.

That made the work a **RENAME, not a merge** — there was only ever one row.
`Mullets Cigar and Bar` (Clermont, HubSpot company `41047490817`, 3 activities)
became `Mullets Sports Bar`, keeping its city, its company id and its history.

**Done through the admin's "Edit a venue", not by hand**, because that path
stamps `hand_edited_at` and clears any pending city proposal (D84). A bare
UPDATE would have left the row undefended.

**The rename is safe from the sync, and this was checked rather than assumed**:
`sync_hubspot.apply()` skips any venue already resolved by company id
(`if identity in venue_ids: continue`) and its `on conflict` touches only
`updated_at`. **The sync cannot overwrite a venue NAME at all** — only the city
was ever overwritable (D84).

---

**`--assign` ON THE LOADER: how an operator ruling reaches a matcher that is
right to refuse.** `_resolve_venue` reports and skips anything it cannot
decide, which D81 requires and which must not be loosened. So the skipped rows
need a person, and `--assign "Mullets=Mullets Sports Bar"` is how the person
answers. `=new` is equally a ruling — "none of the candidates, create it" —
which is what `Fillin Station` needed against two Filling Stations it is not.

**Why a CLI option and not a table or a constant:** the ruling arrives at run
time and is recorded here, rather than compiled into the matcher where the
operator could not reach it (D60). Checked FIRST, before the three existing
answers, so a ruling can never be overruled by a similarity score.

**THE RENAME IMMEDIATELY BROKE SOMETHING, AND THAT IS THE INTERESTING PART.**
With the venue renamed, the workbook's own `Mullets Cigar and Bar` row stopped
matching — its key is `mullets cigar`, the venue's is now `mullets sports` —
so a sale ALREADY IN THE PORTAL since Oct 2025 reported as unresolved. Assigning
it too resolves it to the same venue, where the date check then finds it
present and correctly declines to create it again. **The ruling has to be
applied to the history as well as the new rows, or the loader re-reports old
work for ever.**

**RESULT: 1,262 → 1,265 activities, 339 → 340 venues, and the money did not
move — $42,277.85 charged and $26,729.04 cost, before and after.** The three
rows are `source_activity_type = 'account sold'`, which for Dame Mas carries
explicit 0.00 / 0.00 lines (D94), so the month's commission still carries the
money exactly once (D51). Re-running created 0 and 0.

**`unpriced` stayed at 96 across all three, which is D94 working**: they are
PRICED AT ZERO, not unpriced, so three deliberate decisions did not become
three new warnings.

`reordering` went 21 → 22: Fillin Station is a new pair and `recurring_case` is
a ticked reorder type. Mullets was already `placed` and stayed there — its pair
existed before. Effective status put Fillin Station straight into `dormant`
(Feb 2026 is over 180 days back), which is dormancy deriving itself (D86).

---

**D98 — A percentage-priced row with no `amount` charges nothing, and there was
nowhere to type the amount.**
✅ 23 Aug 2026, found by the operator

Reported as *"I changed it to a bottle sale. Now the problem is I cant add how
much we charged for it."* The answer is that **there is no "how much we
charged" to type** — and then that the field there IS to type could not be
reached.

**Dame Mas is billed as a PERCENTAGE (D94): 10 percent charged, 8 percent paid,
off the gross.** So for those rows `quantity` says how many bottles moved and
**`amount` says what they were worth, and the money comes from the second one.**
A per-case rate would be D94's exact mistake.

**THE FAILURE MODE IS THE DANGEROUS KIND: it looks priced.** The row is not
`unpriced`, it displays a rate of `10%`, and the charge reads `$0.00` as though
zero were the answer. It is a fourth way the rate card goes wrong, beside
`unpriced`, `uncosted` and charge-≤-pay (D78/D90) — and unlike those three
**nothing in the admin surfaced it**.

**WHAT IT COST: $21.08, and the Health canary is the only thing that saw it.**
June 2026 reads portal $388.05 against invoice $409.13. The gap is exactly
$21.08 of commission — 10 percent of **$210.80**, one bottle at Gleneagle
Country Club with no amount on it. The figure is not inferred from a per-bottle
average, which would be wrong: that night's sister rows price at $207.75,
$166.88 and $163.88 a bottle, because case discounting runs $123.00–$210.75
(D93). **It comes from the invoice's own arithmetic**, which is D56.

**The operator's reclassification did not cause the drift; it is what made the
row visible.** Before it, the row priced off `account sold`'s 0.00 / 0.00 line
and was excluded from the canary's percent-only comparison; after it, the row
is correctly in the commission population. June was short by $21.08 either way.
(The handoff recorded 13 months tying that morning and it now reads 12 tying,
1 drifted — the prior state cannot be reconstructed from here, and is recorded
as unexplained rather than papered over.)

**THE FIX: `amount` is now selected, shown and editable on Review and edit**,
with the preview pricing percentage rows off it — `charge_pct × amount`, so the
money is visible before saving rather than after (D91). The page previously
carried a caption apologising that it could not project those rows; that
caption is now a WARNING when a percentage row has no amount, because that is
not a display limitation, it is unbilled work.

**This also unblocks the five `is_expense` rows** (D78), which all carry NULL
`amount` and are why `reimbursements` reads $0.00 against $2,456.20 of expense
lines on the Dame Mas invoices alone. Same gap, same field, no way to enter it
until now.

---

**D99 — The `st.stop()` checker, and proof it sees what the other three could
not.**
✅ 23 Aug 2026

`test_admin_sql.py` gains a fourth source check: **`st.stop()` after
`st.tabs()`** (D89). `st.stop()` halts the whole script run, so every `with
tab:` below it renders blank, with no error and no log.

**Proven against the real fault, not a sample.** Run over the actual pre-fix
`5_Venues.py` from git (`39b9658^`), it flags **line 265** — the exact
`st.stop()` that had "Edit a venue" rendering blank from the day it was
written — while **all three existing checkers report that file clean.** That is
why D89 survived them for a month, and it is the evidence D62 asks for.

Deliberately flags ANY stop after the tabs are created, not only one lexically
inside a `with tab:` block: a stop between the `st.tabs()` call and the first
`with` is just as fatal and reads as more innocent, because the tab labels are
already on screen by then. A stop BEFORE `st.tabs()` — the guard every page
opens with — is correct and stays clean.

**What it cannot see:** a stop reached through a function call. Lexical, which
is how the rule is written and how a person reading the page reasons about it.

**118 → 134 tests.**

---

**D100 — The fresh market incentive is a pass-through, like mileage.**
✅ operator-ruled 23 Aug 2026

The question D95 left open is answered: `aspen green fresh market incentive` is
charged $100.00 and paid $100.00 **on purpose**. Every cent charged goes to the
contractor and iHospitality keeps none — the same shape as mileage (D91).

**So its $0.00 margin across 9 activities is the CORRECT answer, not a missing
pay rate**, and it belongs in the Rate card page's "priced at or below what it
pays" list rather than being hidden from it. Do not "fix" it, and do not read it
as a slip. Two of the entries in that list are now deliberate pass-throughs
(mileage, fresh market incentive) and the rest are prices worth arguing about.

---

**D101 — There is no case discounting. There are TWO SKUS, and this corrects
D93.**
✅ operator-ruled 23 Aug 2026

D93 recorded that the Dame Mas bottle price "runs $123.00 to $210.75 with case
discounting". **That is wrong, and the correction matters.** There is no
discounting. There are two different products:

| SKU | price |
|---|---|
| Reposado | **$123.00** |
| Extra Añejo | **$210.75** |

A blended per-bottle figure is therefore a MIX, not a discount — which is why
"$163.88 a bottle" is not a price anybody ever charged. **Never infer a unit
price from a row's average**, and never reason about a discount curve: ask which
SKUs were in the order.

**Checked against the data, and it holds where it can be checked.** Ten of the
venue-level rows decompose into whole bottles of the two SKUs exactly — 1 Añejo
at Mullets ($210.75), 2 + 2 at El Patron and Vineyard ($667.50), 3 Reposado at
City Dog ($369.00), and so on. The nine month-level rows (D93) carry a whole
month's gross and are not expected to decompose.

**TWO THINGS DO NOT FIT, and they are recorded rather than explained away:**

- **`Executive Cigar`, 31 Jul 2026, one bottle, `amount` = $210.80.** One bottle
  can only be one SKU, and neither is $210.80. **It should be $210.75** — five
  cents, and almost certainly the same rounding that made the June commission
  read $21.08 rather than $21.075.
- **Six multi-bottle rows do not decompose into whole bottles of the two
  prices** — London House (10 / $1,387.50), Barrel & Blend (24 / $3,933.00),
  Eden Lounge (13 / $2,458.50), Second Rodeo and Rachels (both 12 / $1,966.50)
  and Dancers Royale (6 / $1,246.50). These amounts came from the depletion
  report, so **the amounts are more likely right than the two-price model is
  complete** (D56). Either larger orders carry a different price, or there is a
  third SKU, or quantity is not counting what it appears to. **Ask before
  touching any of them.**

**AND THE GLENEAGLE FIGURE IS $210.75, NOT $210.80.** One Extra Añejo. Ten
percent of it is $21.075, which the invoice rounds to the $21.08 that D98
measured as missing — the two agree.

---

**D102 — `brand_product`: what the bottles sold for, which is not what we
charge.**
✅ operator-ruled and built 23 Aug 2026

The operator asked how to program the SKU prices in, and proposed four
entries: a Reposado case and an Extra Añejo case at six times the bottle, plus
a Reposado bottle at $123.00 and an Extra Añejo bottle at $210.75.

**TWO THINGS WERE CHANGED, and both are the point.**

**1. "Six times the bottle" would bake breakage into a case that has none.**
$123.00 and $210.75 are the LOOSE prices — they already include the $3.00. Six
of them is $738.00; a real case is **$720.00**. The base prices are **$120.00
and $207.75** and breakage is a **$3.00 surcharge on loose bottles only**, so a
loose Reposado is derived as $120.00 + $3.00 and never stored as $123.00 where
the two could drift apart.

**2. THESE ARE NOT RATE-CARD LINES, AND PUTTING THEM THERE MISBILLS BY THE SIZE
OF THE COMMISSION.** `rate_card` says what iHospitality charges a brand FOR ITS
WORK — for Dame Mas, ten percent of depletions (D94). A SKU price says what the
PRODUCT sold for: the gross that ten percent is taken OF. Enter a case of
Reposado as a $720.00 rate line and the next invoice bills Dame Mas $720.00 for
its own stock instead of the $72.00 earned — and nothing downstream would
notice, because the row would be fully priced, `unpriced` false, `uncosted`
false, and the margin magnificent.

So `brand_product` feeds `activities.amount` and NOTHING ELSE. `v_activity_money`
is untouched and still resolves charge as `charge_pct * amount`. There remains
ONE pricing implementation (D90).

**BREAKAGE IS PER SKU, and the operator's own wording said otherwise.** He
described it as "if they didn't get a 6 pack of each at the time of order",
which reads as a condition on the whole order. The data disagrees: **Eden
Lounge, 10 Añejo + 3 Reposado = $2,458.50**, which needs breakage on 4 + 3 = 7
bottles. Per order it would be $2,437.50, because the order does contain a full
case. He confirmed per SKU when asked.

**THE MODEL WAS CONFIRMED BEFORE IT WAS BUILT.** Every venue-level depletion on
file was tested against whole bottles of the two SKUs at these prices:
**16 of 17 resolve to exactly one composition**, including the full-case rows
that correctly pay nothing — Dancers Royale's 6 at $1,246.50, Rachels' and
Second Rodeo's 6+6 at $1,966.50, Barrel & Blend's 12+12 at $3,933.00. The
seventeenth is `Executive Cigar`'s five-cent typo (D101). After building, the
live `product_line_amount()` was asked to reproduce all ten distinct
compositions and matched every one.

**Prices are effective-dated from 2025-06-01**, the start of scope, because the
operator confirmed they have been the same all along. The admin form defaults
`effective_from` to TODAY, which for a stable price is the wrong answer and was
corrected on entry — a price dated today prices nothing that already happened.

**`10_brand_product_test.sql` asserts the rule and, more importantly,
DISCRIMINATES.** Three wrong implementations were checked against the assertions:
breakage on every bottle differs on 4 of 5 cases, breakage on none-if-a-case-is-
present on 2 of 5, and **breakage per ORDER on exactly ONE — Eden Lounge**.
Without that row in the test, the variant the operator's own wording suggested
would pass silently. That is why real compositions were used rather than
invented ones.

**WHAT IT FIXED:** the Gleneagle bottle is one loose Extra Añejo at $210.75,
entered through the calculator, and **June 2026 now ties exactly — $409.13
against $409.13.** Portal charge rose $21.08 and contractor cost $16.86; nothing
else moved.

---

**D103 — A constant `key` on a writing button, and the row it destroyed.**
❌ caused, found and fixed 23 Aug 2026

**THE WORST FAULT OF THE SESSION, and it was mine.** The bottle calculator saved
its result to the activity chosen in a selectbox, behind
`st.button(..., key="calc_save")`. A constant key.

**A STREAMLIT RERUN CAN REPLAY A BARE BUTTON PRESS.** Saving Gleneagle's one
bottle called `st.rerun()`; the target selectbox fell back to the FIRST row in
its list; the bottle counts survived in session state; and the replayed press
wrote that composition onto a different activity. **Dancers Royale's six bottles
at $1,246.50 silently became one at $210.75.** Both writes reported success.

**IT WAS CAUGHT BY THE CANARY, NOT BY LOOKING.** June went from $21.08 short to
**$103.57 short** — the drift got worse after a fix that was supposed to close
it, which is the only reason anybody looked. Restored from the invoice, which is
D56 earning its place: the billing is the truth and the truth was recoverable.

**THE LESSON WAS ALREADY WRITTEN DOWN AND THAT WAS NOT ENOUGH.**
`lib.confirm_and_run`'s docstring has said "a rerun can replay one" since it was
created, and the promote button repeats the warning beside itself. Both were
read during this session. Neither was applied, because nothing checked.

**THE FIX IS THE KEY, NOT THE CHECKBOX.** A checkbox resets on rerun and helps;
a key carrying the target id makes the widget a DIFFERENT WIDGET the instant the
selection changes, so a press belonging to one row cannot be delivered to
another. Both are now used; only the key is structural.

**`test_admin_sql.py` gains a fifth check** — a constant-keyed `st.button` whose
body writes using a value a SELECTOR produced. Deliberately narrow: a constant
key is only dangerous when the write is aimed at something that has a fallback.
Verified to flag the exact shape that shipped, and to clear the fix, a
redraw-only button, and a button that writes values typed beside it.

**118 → 148 tests.**

**And a note for the next person, because this is the fifth of its family:**
every one of D89, D92, D99 and D103 was invisible to a person reading the code
and obvious within a minute of a person USING it. This one went further — it was
invisible while USING it too, because the page did exactly what it said. Only
the reconciliation caught it.

---

**D104 — Finished work kept coming back, and a short dropdown that was right.**
✅ both reported by the operator, 23 Aug 2026

**THE 11 UNDECIDED DAME MAS ROWS WERE NOT UNDECIDED. All 60 had been
classified** — 46 from the workbook notes (D93), the rest by hand and by the
loader — and **zero remain typed `account_sold`.**

The Account sold page re-derived a verdict from the NOTE on every load and put
every row into a queue regardless. Eleven of them read "cannot be decided"
because their notes carry neither a sale word nor a visit word and never will:
*"Dame Mas backbar"*, *"Dame Mas xAnejo at Ember & Oak"*, *"New Dame Mas Repo
placement"*. Every one of those is a real placement. The reader simply has no
phrase to match, and no amount of rule-editing will change that.

**THE PAGE WAS ASKING THE WRONG COLUMN.** `source_activity_type` stays
`'account sold'` for ever — it is the raw string HubSpot sent and D74 forbids
rewriting it, because the rate card keys on it. So it can never say whether the
work is done. `activity_type_id` can, and it is what every other path on this
page writes. The queue is now rows STILL TYPED `account_sold`; the rest move to
an *Already classified* tab, listed with both what they were classified as and
what the reader thought, so the reasoning stays auditable (D80).

**THE OPERATOR'S WORRY WAS DOUBLE-COUNTING, AND IT WAS CHECKED RATHER THAN
REASONED ABOUT.** His premise — that the invoices already tie, so these must
not be new sales — is correct. His conclusion, that none of the 11 are sales,
does not follow, and the data settles it three ways:

- **All 60 charge $0.00 and cost $0.00.** `account sold` carries Dame Mas's
  explicit 0.00 / 0.00 lines (D94), so none of them can move money whatever
  they are typed as. The commission lives in the monthly rows and the
  venue-level depletions.
- **No venue holds two depletions on one date.** There is no double entry to
  find — the specific thing he asked to be checked for.
- **The canary reads 13 months tying, 0 billed-but-missing, 0 drifted.**

So the 11 ARE sales, they are ALREADY recorded as sales, and they are worth
nothing — which is exactly D94's design: these rows change the ACCOUNT LIST,
not the accounts.

---

**THE HEALTH PAGE'S BRAND DROPDOWN OFFERS ONE BRAND, AND THAT IS CORRECT.**
Reported as "only dame mas appears in the drop down". The list is
`distinct brand_name from invoice_recap`, and only Dame Mas has ever been
loaded (13 months) — so the canary, which compares the portal to WHAT WAS
INVOICED, has nothing to compare the others against. That is open item 10, not
a fault.

**But a control that silently offers one option and does not say why is a
broken-looking page**, which is what the operator correctly reported. It now
names the brands with no recap — computed from `brands`, so the message cannot
go stale the moment a second one is loaded.

---

**D105 — Venue ownership, from the CSV exports rather than the API.**
✅ operator-ruled and built 23 Aug 2026

**I WAS WRONG THAT THE DEAL OWNER WAS UNAVAILABLE, and the correction matters
because it changed the whole shape of the job.** The handoff records that
`hubspot_owner_id` is not in `DEAL_PROPERTIES`, so who owns a deal is not in
Postgres — the stored payloads carry no properties at all. That is true, and I
concluded from it that this needed a sync change and a live re-sync (item 12,
never run with the staging code).

The operator pointed at his own extraction script, and the answer was in the
file it reads: **the HubSpot UI exports carry a "Deal owner" column.** 25 CSVs
on disk, **953 distinct deals, every single one naming an owner.** No API call,
no sync run, no risk.

**The lesson is not about HubSpot.** "Not in the database" was treated as "not
available", and the operator's own working files were never looked at. The data
was already on the same disk.

**NOT WHO CREATED THE VENUE** (the operator was explicit): he imported hundreds
of companies from Google Drive when HubSpot was set up, so creator is
meaningless. The question is whose DEALS happen there.

**MAJORITY WITH A THRESHOLD, AND A REFUSAL.** A venue goes to the owner holding
more than 60 percent of its deals, or its only owner. Closer than that is
reported and skipped, the same shape as `_resolve_venue` (D81). Deals are mapped
through `activities.hubspot_deal_id` — the portal's own resolution — so the
merges of D81/D82 are respected; going back to the raw company id would split a
merged venue's deals across two rows.

**RULING — ALAN MERRICK'S ACCOUNTS GO TO PHIL KING.** A fourth owner nobody had
mentioned held 30 venues; he no longer works for iHospitality and Phil took them
on. Passed as `--reassign "Alan Merrick=Phil King"` rather than compiled in
(D60), and the note on each venue records the transfer so a row reading "Phil"
can still explain that it was Alan's. **He is deliberately NOT added to
`contractors`** — nothing points at him, and a person nobody owns anything for
would only clutter the owner dropdown.

**THE CSV DATA CONFIRMED THE OPERATOR'S OWN DESCRIPTION, INDEPENDENTLY:**

| region | Phil | Eric | Alan | Nick |
|---|---|---|---|---|
| Palm Beach County | 1 | **39** | 0 | 0 |
| Orlando metro | **105** | 0 | 0 | 10 |
| Space Coast | 31 | 0 | **27** | 7 |
| Tampa / Jacksonville | **27** | 0 | 0 | 0 |

He described Eric as Palm Beach, Phil as Orlando plus Tampa/Jax/Miami, and
himself as mostly liquor stores. All three hold. **And it explains the gap the
geography could not**: the Space Coast — 66 venues, bigger than Eric's whole
territory and mentioned in none of the rules — was half Alan's. Folding him
into Phil closes it, and resolved two of the four tied venues on its own.

**RESULT: 296 of 337 active venues have an owner** — Phil 234, Eric 40, Nick 22.
Contractors went from one to three. **No grade was written**: `venue_grading`
holds both and a blank grade means NOT GRADED YET (D88), so a default here would
turn "nobody has looked" into a judgement. Re-running writes the same 296.

**LEFT FOR THE OPERATOR, deliberately:**
- **2 venues tied 1–1 between Nick and Phil** — `Bronson Liquors 192`
  (Kissimmee) and `Orlando Whiskey Fest`. Both are the liquor-store-versus-
  geography question in miniature, which is his to settle.
- **41 venues have activity and no deal owner at all**, led by
  `Bronson Liquors 192` (8 activities), `In and Out psl` (4) and four with 3.
  Several are not venues (`Cypress Liquor and Wine`, `Fillin Station` and
  `WINE BAR GEORGE` have no city because the workbook loader created them).
