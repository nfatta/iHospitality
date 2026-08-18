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
