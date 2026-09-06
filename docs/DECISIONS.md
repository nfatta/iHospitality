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

---

**D107 — The bottom-line check, and three things that had to be true before it
meant anything.**
✅ operator-framed and built 23 Aug 2026

The operator's own framing, and the right one: *"each invoice has a total at the
bottom … just make sure each brand month to month matches that total."* An
invoice states one number, it was sent and paid, and everything the portal holds
for that brand and month has to add up to it. Line-by-line finds WHERE a
difference is; **the total says WHETHER there is one**, and it cannot be fooled
by a mapping mistake, a mis-split line, or a billing name this code has never
seen. If the totals tie, nothing else can be hiding.

`check_invoice_totals.py` compares **invoice total less itemised expenses**
against **activity charge + retainer + reimbursements**. Read-only. Expenses
come off the invoice side on the operator's instruction — the portal holds none
of them (D78/D98), so leaving them in makes every month differ by exactly its
pass-throughs and say nothing about the work.

**THREE STRUCTURAL FAULTS HAD TO BE FIXED FIRST, and each one alone made the
comparison meaningless:**

1. **A billing name can cover SEVERAL brands.** `Coors Whiskey Company` bills
   Five Trail, Barmen 1873 **and its own retainer** on one invoice and splits
   them nowhere. Modelled as a NULL brand — "deliberately unmapped" — which is
   true and useless: it said the invoice belonged to nobody, so $21,880 of real
   billing sat outside every total while Five Trail and Barmen read as work
   that was never invoiced. `brand_billing_member` says what is true, and that
   line went from **−$13,806 to −$81.09.**
2. **A name identifying ONE brand beats a shared payer.** Blue Run's invoices
   are headed *"Blue Run Whiskey c/o Park Street Imports / Coors Whiskey Co"*,
   so a longest-match handed all ten to the Coors pool and left Blue Run
   reading **$0 invoiced against $18,228** of real billing. Same fault, twice,
   in two different functions.
3. **A structural charge is told from a pass-through by SHAPE, not
   vocabulary.** On the nested invoices the retainer line is bare —
   `1 1,450.00 1,450.00`, its name on a line the item scanner never sees — so
   `startswith("retainer")` missed it and **$1,450 a month fell into expenses
   for every brand except Dame Mas**. An itemised expense is a description and
   ONE amount; anything carrying QTY, RATE and AMOUNT is priced work.

**And an invoice whose `ACTIVITY DATE` is unusable now falls back to the month
before its issue date**, because billing is in arrears (D93). 3123 says "2024"
and 3178 contains a UPS tracking number; both dropped out of every total in
silence, which is worse than being a month wrong.

**WHERE IT STANDS — 38 of 83 brand-months tie to the cent.**

| brand | months | tie | invoiced | portal | gap |
|---|---|---|---|---|---|
| Starr Rum | 7 | **7** | 4,440.00 | 4,440.00 | **0.00** |
| Dame Mas | 15 | 10 | 15,929.73 | 16,372.43 | +442.70 |
| Barmen + Coors + Five Trail | 10 | 1 | 19,276.09 | 19,195.00 | −81.09 |
| Blue Run | 10 | 5 | 16,479.31 | 16,832.50 | +353.19 |
| 44 North | 15 | 7 | 31,967.10 | 35,967.10 | +4,000.00 |
| Aspen Green | 7 | 0 | 2,129.90 | 7,034.90 | +4,905.00 |
| Wodka | 10 | 1 | 16,543.03 | 15,062.00 | −1,481.03 |
| Heavens Door | 3 | 1 | 5,794.50 | 4,945.00 | −849.50 |
| **TOTAL** | **83** | **38** | **112,559.66** | **119,848.93** | **+7,289.27** |

**THE RESULT IS SAVED AS DATA**, at
`portal_seed/reconciliation/invoice_vs_portal_2026-08-23.csv`, so nobody has to
re-derive it. It is in the PYTHON repo and never the website one — that root is
the Netlify publish directory and this is every client's billing (D12).

**RULING — THE INVOICE WINS, AND THE PORTAL GETS CHANGED.** The operator: *"the
portal is new and is currently being built, it is not active yet. The invoices
are already sent out and done. If there is something different the invoice is
correct."* This sharpens D56 rather than replacing it: D56 said investigate the
portal, and this says the portal is what gets corrected — **without creating
duplicate deals**, which was his other instruction.

**NOTHING HAS BEEN CHANGED YET, deliberately.** The remaining $7,289 is four
different problems wanting four different treatments, and three of them must
NOT be closed:

- **Months with no invoice**: Aug 2026 everywhere is current-month work, not
  yet billed, and correct as it stands. Aspen Green Feb–May 2026 is
  `source='uninvoiced'` on purpose (D71) — deleting it destroys $2,000 of real
  revenue and has nearly happened once already.
- **Wodka is consistently about −$450 a month across eight months.** That
  regularity is one wrong or missing rate, not scattered data errors — the
  cheapest thing on the list and probably a single rate-card line.
- **44 North: seven months tie exactly**, the rest differ by 10, 20, 50, 210,
  250 and 300, plus one outlier of $1,260 in Dec 2025. Small, specific,
  individually checkable.
- **Invoice 3210, $1,235.33, Jul 2026, billed to "Chris Nicolas"** — brand
  unknown. One row in `brand_billing_name` once the operator says which.

---

**D108 — THE `Invoice-derived` BATCH: 63 SYNTHETIC ROWS, $7,035, NINE BRANDS — AND THEY ARE NOT ALL WRONG.** ✅ operator-confirmed 24 Aug 2026

Every one was written in a single pass at `2026-08-21 17:54:22`, each carrying a
note of the form *"The invoices bill N x `<type>` for `<month>`; the portal held
M. This row is the N−M difference."* None has a venue, a HubSpot deal or a
photo. The operator spotted the pattern before the data did: *"I think in the
past activities were added and left old ones so we had duplicates. That just
clutters."*

He was right about the cause and wrong about the scope, and the difference
matters more than either. **The premise — that the work was billed but never
entered — is TRUE for some brands and FALSE for others**, so there is no bulk
action here, only a test:

> **Does the work already exist elsewhere in the portal?** If yes, the synthetic
> row is a duplicate and goes. If no, it is the only record of billed work and
> must stay.

Applied:

- **Wodka — DUPLICATES, all ten deleted.** The operator's `Wodka Report
  2026.xlsx` and the invoices agree on 150 cases across Dec 2025 – Jul 2026,
  month for month, and the portal already held them against real venues. The
  batch had compared the invoice's single combined `Case Sale, Mix/match, all
  SKUs` line against the portal's `recurring case` ALONE, ignoring every
  `1st case sale` on file. Same error as the 44 North `tap cocktail` row.
- **Starr Rum — DUPLICATES, all sixteen deleted, but only after CLASSIFYING the
  real rows.** See D111.
- **Blue Run — LEGITIMATE, left alone.** Its June 2025 rows stand in for
  barrels, barrel prep, a printed feature and half cases that are on the invoice
  AND in the workbook but genuinely never reached the portal. Deleting them
  would break a month that ties.
- **44 North, Five Trail, Barmen 1873, Heaven's Door, Aspen Green, Dame Mas —
  UNTESTED.** $3,030 across 26 rows. 44 North's June 2025 ties at exactly 0.00
  and holds $660 of them; deleting on Wodka's evidence would break it.

**The alternative was to trust the notes and delete the lot.** That would have
removed $7,035 of charge, most of it correct, and broken several months that
currently reconcile. The rows are not a fault to be swept — they are an
unanswered question per brand, and the workbook is what answers it.

---

**D109 — WODKA'S $500 `Expense Spend` RIDES ON THE RETAINER, AND ITS COST IS NOT MODELLED.** ✅ operator-confirmed 24 Aug 2026

Wodka's invoices from Jan 2026 carry a flat monthly line, `Promotions:Expense
Spend`, described *"Accumulated monthly expenses"*, at $500.00 every month. The
portal held nothing for it: **$3,500 across seven months**, and it was most of
why Wodka read roughly −$450 a month. December 2025 has no such line, which is
exactly why December was the one month running the other way.

**It is NOT a pass-through.** What makes mileage one (D91) is that its pay rate
is set FROM its charge rate so the two cannot drift, making a $0.00 margin true
by construction. The operator's own account rules that out: the actual spend
varies, and — his correction, and it settles it — *"we never actually have
exceded"*. So the $500 always covers, and whatever is left is kept. That is
revenue with a variable cost, not a pass-through.

**It rides on `brand_retainer` because a second row is structurally impossible.**
`brand_retainer_no_overlap` is a GIST exclusion constraint forbidding a brand two
overlapping periods. Wodka is therefore $1,725.00 from 2026-01-01: the $1,225
retainer plus the $500. The operator chose this over a schema change.

**THE COST OF THAT, RECORDED SO IT IS NOT REDISCOVERED:** the Retainer page now
shows Wodka at $1,725.00, which is **not what the contract says** — the invoice
states Retainer $1,225.00 and Expense Spend $500.00 as separate lines and always
has. If the two ever need telling apart — a rate change to one and not the
other, or a brand with one and not the other — the row must be split, and that
means relaxing the exclusion constraint first.

**`QB_RETAINER_TOTAL` was raised $3,500 to $74,625**, and NOT to make anything
agree. QuickBooks bills the money under `Promotions:Expense Spend`, an item the
constant's original `Sales:Retainer` reading did not cover; the figure is read
from invoices 3179, 3184, 3189, 3192, 3195, 3200 and 3209, $500.00 on every one.
Deriving that target from the rows it checks would be D62 exactly. The portal's
invoiced retainer for Jun 2025 – Jul 2026 is now $74,625.00, matching to the
dollar.

**NO COST IS MODELLED AGAINST THE $500**, so Wodka's margin is overstated by
whatever was actually spent. Same class as the uncosted charge on the Rate card
page: a known gap someone can act on, not a wrong number that looks right.

---

**D110 — QUICKBOOKS IS THE CHECK ON THE WORKBOOK, AND THE WORKBOOK IS NOT THE TRUTH.** ✅ operator-confirmed 24 Aug 2026

The operator's method, and it is the right one: *"just ensuring the months from
the pdf lineup with what you can pull from quickbooks... you couldnt see line
items thats why I got the pdf, so lets just put that in there so we dont have
any errors."* QuickBooks BLANKS service lines (D70) but its TOTALS are complete,
so it is the independent check that the PDF parse caught every invoice and read
each total correctly. Line-level reasoning is worthless if an invoice is missing.

Run three ways — QuickBooks totals, PDF line detail, operator workbook — the
workbook loses more often than anything else:

- **Wodka**: 8 of 8 QB totals match the PDFs to the cent. Parse sound.
- **Starr Rum**: 4 of 4 match, all paid. **The workbook's NOV row (900/380/1280)
  is a template leftover copied from October — QuickBooks has no fifth invoice
  for this customer at all.**
- **Blue Run**: **the workbook disagrees on 6 of 14 invoices** — a mileage figure
  typed 78.40 for 75.04, a $25 fee counted twice, $775 of 5L barrels missing,
  $240 of promo specialist plus 422 miles missing, a $205 10L barrel missing,
  $42.06 of expenses missing. It also **omits invoice 3159 entirely** ($618.04).
- **Coors pool**: the workbook disagrees on 3 of 9, and its September expenses
  include $69.56 that belongs to Blue Run's barrel invoice — **booked to the
  wrong brand**.
- **44 North**: four transcription slips, found the same way (D107 follow-on).

**Two splits the workbook gets wrong WITHOUT changing a total**, and a
totals-only check would never have seen either: Blue Run June 2025 books
consulting 1,175 + commission 885 where the invoice says 975 + 1,085 (same
$2,060 subtotal — this nearly became a wrong `brand_retainer` edit), and Blue Run
September books 100.00 commission and 37.10 mileage where the invoice folds both
into a commission line of 137.10.

**The barrels are the systematic omission.** The operator: *"barrells werent put
into the workbook. But the activites in teh workbook minus barrels will be
good."* That is exactly what the data shows, and it makes the workbook reliable
for ACTIVITY and unreliable for TOTALS.

---

**D111 — STARR RUM'S MONEY SAT ON PLACEHOLDERS BECAUSE `source_activity_type` WAS NULL.** ✅ operator-confirmed 24 Aug 2026

Starr Rum tied 7 of 7 at $4,440.00 — **on rows with no venue**. Its real
activities were all on file with venues, dates and HubSpot deals, but **63 of its
84 rows carried no `source_activity_type`**, and that is the column the rate card
keys on (D74). Every one priced at $0.00. The `Invoice-derived` batch then wrote
sixteen rows, one per invoice line per month, to carry money the real rows could
not.

**So the fix was CLASSIFICATION, not deletion.** Give the real rows their source
string and they price themselves; only then are the synthetic rows pure
duplication. 46 rows classified, 16 deleted, and **the brand total did not move
by a cent** — which is the check that proves the synthetic rows were a copy.

Two rows were mis-typed, both caught by the workbook:

- **Cigarz on the Ave, 2 Jul** — Account Visit in the portal, `1-2case sales`
  qty 1 in the workbook. Invoice 3125 bills 2 cases and the portal held only
  Spirited Spin; this was the other.
- **Root+Branch, 9 Sep** — Case Sale qty 2 in the portal, `account sold` in the
  workbook. See D112.

**`Case Sale` maps to source `recurring case` for this brand**, because $20.00 is
what every invoice bills for *"Case Sale — 1st and second case sold into
account"* and `recurring case` is the only $20.00 line Starr Rum has. The label
is a little off; the money is right. Inventing a `1st case sale` rate would have
been a rate the operator did not set (D60).

**NOVEMBER AND DECEMBER 2025 ARE DELIBERATELY LEFT UNCLASSIFIED.** Both hold real
activity — 10 account visits and a tasting event; 9 cases — and **no invoice
exists for either**; the retainer ended with the October work month and
QuickBooks has nothing after 3166. The operator: *"we were trying somethign with
Starr and wont be doing that again."* Classifying that work would book roughly
$360 of revenue nobody was billed. Both months read 0.00 against 0.00 and must
stay that way.

---

**D112 — `account sold` IS DECIDED BY THE INVOICE, NEVER BY THE LABEL.** ✅ operator-confirmed 24 Aug 2026

The operator: *"Account sold could be either account visit or case sale... we had
a contractor who put them in wrong."* And then the test, which is the useful
part: *"look at what was invoiced. If you see cases invoiced tha tyou cant find
then it is the acount sold, if not there then it is account visit."*

That is a rule the data can be run against, and it decided four rows:

| Brand / month | Invoice bills | Already accounted for | Verdict |
|---|---|---|---|
| 44 North Aug 2025 | 5 cases | `1st case sale` 5 | Ember & Oak, Wildflower → VISITS |
| Wodka May 2026 | 15 cases | 5 + 10 | Second Rodeo → VISIT |
| Starr Rum Sep 2025 | 2 cases | Chatham's + Levee | Root+Branch → VISIT |

Starr Rum's is confirmed in words by the workbook: *"Partial case for
development — Ordered 3b for DL development"*. Three bottles, never billed.

**No money moved.** All four were `unpriced`, contributing NULL; as account
visits they contribute an explicit $0.00. That is the point — D94's distinction
between "priced at zero" and "unpriced" is what stops a deliberate non-charge
sitting in the admin's warnings for ever pretending to be a missing rate.

**Five rows are deliberately undecided** — Barmen 1873 (24 Middleton, Feb 2026)
and Blue Run (four). Both brands still carry load-bearing synthetic rows, so
"the billed cases are already accounted for" cannot be tested honestly there yet.

**There is no `account_sold` activity TYPE and one must not be created.**
`account sold` is a raw SOURCE string; across the database it sits under Bottle
Sale, Case Sale, Case Reorder and Account Visit depending on the brand. The type
records what happened; the source string records what the contractor typed.

---

**D113 — THE QUANTITY MULTIPLIER IS THE MOST EXPENSIVE SINGLE FAULT CLASS FOUND SO FAR.** ✅ operator-confirmed 24 Aug 2026

Four instances, **$1,110 between them**, all the same shape: a real activity with
a real HubSpot deal, carrying a quantity that multiplies a rate into money nobody
was billed. Since D65 the quantity is always the activity multiplier, so a wrong
quantity is wrong money — silently, on a row that looks perfectly ordinary.

| Venue | Date | Portal | Truth | Cost |
|---|---|---|---|---|
| Pourhouse Lounge (Wodka) | 16 Dec 2025 | `1st case sale` qty **12** | Account Visit qty 1 | $120 |
| Debauchery (Wodka) | 14 Jan 2026 | `1st case sale` qty **3** | Account Visit qty 1 | $30 |
| Executive Cigar (Blue Run) | 16 Dec 2025 | `tasting event` qty **6** | qty 1 | **$800** |
| Meg O'Malley's (44 North) | — | drink list qty **6** | qty 1 | outstanding |

Two of the four are ALSO a case sale filed as a visit, and a third — Cigarz on
the Ave (D111) — is a visit that should have been a case sale. **The type and the
quantity go wrong together**, which is why the workbook decides both at once.

**Every one was corrected, never deleted.** All carry photos or HubSpot deals,
and a delete cascades photos away (D85). **The HubSpot deal still holds the wrong
quantity in each case**, so a future promote could revert the fix; each row's
note names its deal id for that reason.

**Where a venue's only depletion was one of these, the status had to be walked
back BY HAND.** `Case Sale` is a depletion and `Account Visit` is not, and the
trigger only ever ADVANCES (D86) — it will not undo `placed` on its own.
Pourhouse Lounge, Debauchery and Root+Branch went back to `pitched` with
`first_placed_on` cleared.

---

**D114 — THE CANARY'S INVOICE SIDE WAS CIRCULAR, AND IT IS STILL PER-BRAND.** ✅ operator-confirmed 24 Aug 2026

`canary()` — the Health page's reconciliation, the first thing the admin shows —
compares the portal against `invoice_recap`, which is **typed by hand**. Where
the operator transcribed a figure from the same belief the portal holds, the
check ties by construction and cannot fail.

It produced one false green and one false red on the same brand in one morning:
44 North June 2026 read 0.00 because both sides said $2,200 while invoice 3199
bills **$2,150** (a case pulled off the invoice, never removed from the portal);
and September 2025 read +$302.10 against a month that reconciles to the cent,
because the typed commission was $610.00 where the invoice says **$912.10**.

**Widened, not fixed.** The invoice side is now `commission + billable +
mileage`, all coalesced. `billable` had been missing entirely and the row that
exposed it was 44 North Sept 2025, whose invoice bills a Daily Labor "Day Buy Out
Split" at $115.00 — work that IS in the portal and IS in the portal side of the
sum. `consulting` is deliberately excluded: the retainer is not modelled as
activity, so adding it would put every month four figures out.

**The circularity itself is NOT fixed.** The real repair is for the invoice side
to come from the parsed PDFs rather than typed numbers — then it could not agree
with the portal by accident.

**AND IT CANNOT SHOW THE COORS POOL AT ALL.** `invoice_recap` is keyed on
`brand_name` and `canary()` compares one brand's recap against that same brand's
activity. The Coors invoices belong to no single brand — `brand_billing_name`
has both "coors whiskey" and "five trail/barmen" deliberately unmapped, covering
Barmen 1873 + Five Trail + Coors Whiskey (D107). Loading them under "Coors
Whiskey" would compare $19,276 of billing against that brand's activity, which is
zero, and fabricate a gap on a pool that ties to **−$81.09**. So the pool's
invoices are NOT in `invoice_recap`, and cannot be until `canary()` pools brands
the way `check_invoice_totals.py` already does via `brand_billing_member`.

---

**D115 — BILLING MECHANICS THE PORTAL DOES NOT MODEL, AND MOSTLY SHOULD NOT.** ⚠️ needs a ruling on barrels

Once the activity reconciles, what is left is not work. Four kinds, all real
money on real invoices, none of it representable as an activity today:

- **Card and processing fees.** Wodka carries $43.48 (Dec, 3% credit card) and
  $62.55 (Jan, 3% online). Blue Run's Feb–May 2025 invoices carry $25.00 each.
- **Early-payment discounts.** The Coors pool takes one on every invoice —
  $30.71, $21.90, $23.42, $31.44, $16.51, $27.95, $19.04, $28.94, $8.99. **Four
  of its nine months differ from the portal by EXACTLY their discount and by
  nothing else.** Wodka's Feb 2026 fee of $56.44 was charged and then written
  off in the same document.
- **Balance carried forward.** Wodka's April 2026 discount of $90.00 reappears on
  June's invoice as *"Balance from Previous Invoice"*. Across the two it nets to
  zero; in neither month alone does it tie.
- **Work billed a month late, stated as such.** Invoice 3195 bills a TAP Cocktail
  described *"New Cocktail on tap From April but not on previous invoice."* The
  portal holds it in April where the work happened. **April reads +$150 and May
  −$150 for ever, and that is correct** — do not move the row.

**THE BARRELS ARE THE OPEN ONE.** The operator has ruled that barrel sales SHOULD
be portal activities, and the machinery exists (`5l barrel` at $155 for Blue Run,
Five Trail and Barmen; Barmen has a `cwc 10l barrel` at $150). But **Blue Run has
no 10L rate line**, and two barrel-only invoices sit outside the monthly
programme entirely:

- **3159, Blue Run, $618.04** — 2 × 5L + 1 × 10L + UPS shipping, billed to a
  Molson Coors address rather than Park Street, stamped with the malformed
  ACTIVITY DATE *"September 11"* that D106 had to work around.
- **3178, Coors pool, $757.23** — 2 × 5L + 2 × 10L, *"Fred Fisher requested
  barrels"*, no work month at all.

`invoice_recap` is unique on `(brand_name, month)`, so neither can sit beside the
programme invoice for its month. Blue Run's Jan 2026 is $205 short for exactly
this reason: invoice 3177 bills a 10L barrel for Black Hawk Bistro that the
portal does not hold. **This wants a rate line and an activity, both of which are
the operator's data (D60).**

---

**D116 — BASE PAY IS NOW SHOWN PER BRAND, AND D67 STILL GOVERNS WHERE IT LIVES.**
✅ operator-requested 24 Aug 2026

D67 ruled that base pay is a company cost and must not be pushed into per-brand
margin, because doing so means *"inventing an allocation nobody agreed to."* The
operator has now agreed to one, and asked for it on the Analysis page.

**Both things are true, and the split is deliberate.** The allocation is computed
in `1_Analysis.py`, in the page, and is **not** in any view. `v_month_business`
still holds base pay one level up against the business as a whole; every other
tab, every other page and every stored margin figure is unchanged by this. So
D67 still describes the DATABASE, and D116 describes one screen that draws on it.
Nothing downstream inherits the allocation by accident — which was D67's actual
fear, and it remains guarded.

**The method: each contractor's own monthly base pay, split across the brands
THEY worked that month, by their own share of activities.** Not an even split
and not one pooled rate — Phil's salary follows Phil's route. Month by month, so
a mid-window raise or a new hire lands in the right months instead of being
smeared across the whole range. Attribution runs through
`venue_grading.owner_contractor_id` (D88), which is the only person-to-work link
that exists.

**Four ways it is weak, all stated on the page rather than left to be found:**

- It counts **activities, not hours**. A three-hour tasting weighs the same as a
  twenty-minute account visit, so a brand carrying the project work is
  UNDER-charged. 44 North is the brand this understates.
- Attribution is who owns the venue **now**, not who made the visit.
- Rows with no venue — the month-level commission rows — have no owner and are
  excluded, counted, and reported.
- **Serving a brand less makes it look more profitable.** Dame Mas reads −$11 on
  a six-month window and **+$18** on the same window allocated month by month,
  and **+$368** on Jun–Jul alone, because its activity fell by a third. The sign
  flips on method and window. The honest statement about Dame Mas is *"it is at
  break-even"*, never *"it loses money"*.

**A CONTRACTOR-MONTH WITH NO ATTRIBUTED ACTIVITY HAS NOWHERE TO LAND, AND THAT
GAP HAD TO BE MADE VISIBLE.** The first version of the page claimed each column
summed to that person's full pay. Over a fourteen-month window it did not:
$15,841 of $53,720 had no brand to sit against. Dropping it silently would
understate payroll and flatter every brand on the table, so the page now measures
and reports it. It is not a fault — it is real pay for a real month that no brand
caused, which is D67's point arriving from the other direction.

**The page carries a spread selector**, and it is the difference between two
legitimate answers. *"The brands selected above"* assumes the ones you did not
select are gone, so their share of payroll lands on the ones you kept — the
forward-looking view, and the one that says 44 North's $1,450 retainer does not
cover the $1,510 of payroll on it. *"Every brand they worked"* leaves departed
brands carrying their share, which is what actually happened at the time. On the
same window those two differ by $10,141 of allocated pay and change which brands
appear in the retainer warning.

**Nothing is hardcoded (D60).** Contractors, pay rates, pay frequency and the
brand list are all read from tables. Adding a contractor on the Contractors page,
or giving a venue an owner on the Venues page, changes this table with no edit to
Python.

---

**D117 — THE VENUE GRADING SYSTEM AND THE ROUTED WEEK.**
⚠️ designed 24 Aug 2026 — **NOT agreed with Phil, and nothing is applied.**
Serves open item 9.

The operator asked for a grading system: contractors grade their own venues
A/B/C/D, and the grade sets a visit cadence. What follows is what the data
supports. **It has not been put to Phil, no venue has been graded, and no route
exists.** `venue_grading` holds 339 rows, **339 with an owning contractor and
ZERO with a grade.**

**THE CONSTRAINT THAT DECIDES EVERYTHING, AND IT IS NOT THE CADENCE.**
Phil owns **260 venues** and records **62 visits a month** (Feb–Jul; 66 on a
trailing twelve months). At the cheapest tier
in the proposed scheme — D, every two months — those 260 venues cost **130
visits**. He is 2× over capacity *even if every venue is graded D.* And **132 of
his 260 have never bought anything.**

So the first job of grading is not to set a cadence. **It is to decide which
venues stop being visited on a schedule.** Everything else follows from that.

| | Phil | Eric | Nick |
|---|---|---|---|
| Venues owned | 260 | 50 | 29 |
| Visits/month | 61 | 21 | 8 |
| Ever sold | 128 | 12 | 13 |
| Never sold | 132 | 38 | 16 |

**THE CADENCE, AND WHAT EACH TIER COSTS.** A is not slightly dearer than D, it
is **thirteen times** dearer. That ratio is why a flat cap fails.

| Grade | Cadence | Visits/month |
|---|---|---|
| A | Weekly | 4.33 |
| B | Twice a month | 2.00 |
| C | Monthly | 1.00 |
| D | Every two months | 0.50 |

**CAP A AS A SHARE OF CAPACITY, NEVER AS A FLAT NUMBER.** The operator's first
instinct was "cap A at 10". Ten A's is **43.3 visits a month — 71 percent of
Phil on ten venues**, leaving 17.7 for the other 250. And Eric has only about 25
visits in total, so he **could not hold 10 A's under any circumstance.** At 25
percent of capacity: Phil 3, Eric 1, Nick 0.

**A IS A CAMPAIGN, NOT A STATUS.** Three permanent A's is three venues a year.
Three A *slots* run as six-to-eight week campaigns around a menu change or a
competitor switch is roughly **26 conversion attempts a year** on the same
capacity. Weekly presence is for while a decision is being made, not for ever.

**THE 90-DAY FLOOR IS WHAT MAKES IT AFFORDABLE**, and it came from the operator.
A floor is cheap and intensity is expensive: covering 153 venues at 0.33
visits/month costs 51 visits, while lifting ONE venue from floor to A costs 4 —
as much as twelve venues on the floor. So budget it as a base plus upgrades:

| | Venues | Visits |
|---|---|---|
| 90-day floor, every venue that has ever bought | 153 | 51.0 |
| Upgrade to A (+4.0 each) | 3 | +12.0 |
| Upgrade to B (+1.67 each) | 10 | +16.7 |
| Upgrade to C (+0.67 each) | 20 | +13.4 |
| **Total, against 94 visits/month of capacity** | **153** | **93.1** |

A universal 90-day floor across all 340 venues is **113 visits** and does not
fit. Restricted to venues that have ever bought, it does — and it covers **153
venues instead of the 83** a pure tiered scheme reaches.

**THE CRITERIA — TWO QUESTIONS, NOT FOUR.** The operator proposed BANT (budget,
authority, need, timeline). **Authority and fit survive; budget and timeline do
not.** Every bar has a liquor budget and spends it weekly, so budget returns
"yes" 340 times and discriminates nothing. And an account that reorders for
years has no "timeline" — it has a rhythm. Four axes will also not survive one
person scoring 128 venues; two is the realistic ceiling.

But BANT catches something a pure behaviour rule gets wrong: **a venue that
opened last month has bought nothing, grades D, gets a visit every two months,
and therefore never buys.** Potential has to count somewhere. Hence:

| Grade | Test |
|---|---|
| **A** | Buys every month **and** the contact can change the back bar or the menu. Buys monthly but you only know a bartender? That is a B. |
| **B** | Buys most months — **or** the programme fits and you have the decision-maker. **The only grade where potential counts.** |
| **C** | Has bought, reorders sometimes, no obvious lever. |
| **D** | Placed once, no reorder. Or a good venue with no access past the bartender. |
| **—** | Never bought and no access, ghosting, or nothing in 180 days. |

**THE RULE THAT STOPS OPTIMISM EATING THE CALENDAR:** a venue graded B on
POTENTIAL rather than purchases **drops to D after 90 days without a sale.**
BANT ends when a deal closes or dies; a cadence system has no ending, so the
grade and the spending behind it persist for ever unless something retires them.
That is the most important line in this entry.

**UNSCHEDULED VENUES PROMOTE THEMSELVES, AND IT IS FREE.** Anything showing
cases on the monthly depletion sheet returns to a route next month. Nobody has
to notice; the data notices. **Do not sweep the unscheduled list** — 257 venues
touched once a year is 21 visits a month, a fifth of total capacity spent on
venues that by definition are not buying.

**THE ROUTED WEEK: FOUR DAYS ROUTED, ONE THE CONTRACTOR'S.** The operator's idea,
and the arithmetic says the fifth day is free. Phil averages **2.8 visits/day
across five unrouted days.** Four geographically clustered days at **3.5/day is
61 a month — exactly his current output**, so the discretionary day costs
nothing. At 4/day he is **ahead by eight visits a month** and still gets the day
back. **Break-even is 3.5 visits per routed day**, and that is the number to put
to him.

Phil's 128 ever-sold venues cluster as: **Orlando core 44** (too big for one
day — split it, or let the low-volume half sit on the floor), **Orlando south
13**, **Sanford/Lake 17**, **Brevard 18**, **Tampa/west 12** (ninety minutes each
way, so a monthly day rather than a weekly route), and **24 that are not routable
at all** — Jacksonville, St Augustine, Daytona, Miami, Pensacola, Inlet Beach,
The Villages, and 44 North's head office in **Boise**. Four have no city
recorded. **That last group is NOT a drop list** — Serafina Miami (14 cases) and
Sable (12) are real volume; they are quarterly, not weekly.

**THE FLAG NO GRADE WOULD CATCH:** eight or more visits and one case or fewer in
twelve months. By activity count these look like the most engaged accounts on the
book. **Hollerbach is the worst and does not even appear on the flag list** — 16
visits, zero depletions ever recorded, receiving monthly keg builds. Also
flagged: Debauchery (14 visits, 1 case), Florida Cork & Bottle (10, 1), The
Brevardian (10, 1), Root+Branch (10, 0).

**Where this is soft.** Eric's 25-visit budget is a projection from six months
(recent average 21, best month 33) — if he settles at 21 he carries 18 venues,
not 22. And **186 of 187 44 North venues have a NULL `market`**, so none of this
could be filtered to the two real markets; the clustering is by city string and
should be re-done once markets are populated.

**Reference:** the routes with every venue named are in
`Ihospitality/iHospitality_Field_Routes_Phil.docx`.

---

**D118 — 44 NORTH IS BILLED ON 63 OF 291 CASES, AND THE FEE MODEL THAT FOLLOWS.**
⚠️ analysed 24 Aug 2026 — **nothing agreed, nothing changed in the portal.**

Matching the distributor's depletion sheet
(`Ihospitality/44 North/07_2026EOMFlash.xlsx - Customer Performance.csv`) against
the portal's venues: **291 cases moved at accounts iHospitality services between
Jan and Jul 2026. 63 were billed.** Theme parks excluded (Universal 58 + 22,
Disney 41 — operator-confirmed not ours).

**The cause is structural, not clerical.** The rate card charges $50 for a case
sale and **$0.00 with a $5.00 pay rate for `recurring case`** — so a reorder
*costs* $5 and earns nothing. **In the entire history of 44 North, exactly ONE
reorder has ever been recorded** (Eric's, July 2026). Reorders reach the venue
through the distributor's own rep without an iHospitality visit, so there is
nothing to log: the gap is real work that was never billable by design, not a
recording failure.

| | Cases | Revenue/month |
|---|---|---|
| Today — $50/case, first case only | 63 | $464 |
| 10 percent of every case, at $252/case | 291 | $1,048 |

**A FLAT PERCENTAGE IS NOT A PRICE CUT ONCE IT REACHES THE REORDERS**, and the
first pass at this got it backwards. $50 on a $252 case is **19.8 percent**, so
10 percent looks like halving the rate — but it applies to 4.6× the volume.
Wodka is already effectively 10 percent ($10 on a $100 case) and Aspen Green
about 8 percent, so **44 North is the only brand with the placement-only hole.**

**THE REFERENCE PRICE MUST BE FIXED IN THE CONTRACT, NOT TAKEN FROM THE INVOICE**
(the operator's own instinct). $21/bottle × 12 = $252, chosen conservatively so
discounting cannot erode the fee, reviewed annually. **It is unverified** — every
dollar of it is worth about $12/month. And if 44 North argues the base should be
their own FOB rather than a wholesale figure, **let them win that and ask for
double the rate**: 10 percent of $252 and 20 percent of $126 are the same $25.20
a case. Decide the walk-away in dollars per case, never in percent.

**THE RISK, AND IT IS REAL:** 44 North's Florida business is **down 26.5 percent
year over year (687 cases FYTD against 934), and points of distribution have
fallen from 1,501 to 633.** A percentage model on that trajectory is a scheduled
pay cut, which is why it needs a monthly floor — $400 was the figure proposed.

**TAP AND KEG WORK IS BEING GIVEN AWAY BY CLASSIFICATION.** 51 tap/keg
activities are logged as Market Favor (26), Account Visit (19) or Drink
Development (5) — **all rate-carded at $0.00** — against 9 billed as tap work.
There is a `tap cocktail` line at **$200** for 44 North and $150 for Wodka.
Nobody decided to give it away; the wrong bucket was picked 26 times. The rule
that follows: **build where it moves cases, bill it as a tap cocktail, and stop
where it does not.** The Whiskey is 14 cases on 12 visits and earns its keg
build; Hollerbach is 0 cases on 16 visits and does not.

**WODKA'S CASE SALES LOSE $15 EACH AND NEED NO CLIENT CONVERSATION.** Wodka has
no pay rate of its own for `1st case sale`, so it falls through to the shared
`(all brands)` $25.00 line while charging $10: **61 cases, $610 charged, $1,525
paid, −$915.** Its *reorders* are correct at $10/$5. Setting a Wodka pay rate of
$5 turns −$915 into +$305. Same failure shape as D94, and it is the rate card,
not the contract.

**Reference:** the fee argument, per-brand detail and objection handling are in
`Ihospitality/iHospitality_Rate_Talking_Points.docx`.

---

**D119 — THE COORS POOL TIES 9 OF 9, AND THE DISCOUNT WAS MOST OF THE "GAP".**
✅ operator-ruled 24 Aug 2026 (second session)

Open item 2 called pooling "one query change". It was — but the change was not
the interesting part. **The Coors pool never had the gap it was recorded as
having.** What it had was a comparison against the wrong number.

**AN EARLY-PAYMENT DISCOUNT IS NOT WORK, AND NEITHER IS A CARD FEE.**
`check_invoice_totals.py` compared the invoice **TOTAL**. But

    TOTAL = SUBTOTAL − DISCOUNT + TAX

and all three adjustments are payment mechanics. Molson Coors pays early, so
**every Coors invoice carries a discount** — $8.99 to $31.44 — and those nine
discounts are *exactly* the **−$81.09** D115 recorded as a reconciliation gap.
It never was one.

The mirror image is a **fee**. Wodka's 3184 charges a $56.44 processing fee and
takes $56.44 straight back off at the bottom; Dame Mas 3186 does the same with
$15.00 ACH. Compare against the TOTAL and that pair nets away correctly but a
real discount is wrongly netted too; compare against the SUBTOTAL and the
discount is handled but the fee is left in. **Neither figure is the work.**
The work is

    SUBTOTAL − expenses − payment fees

and the discount never enters. One definition, both shapes of invoice.

**IT MOVED SEVEN MONTHS AND BROKE NONE.** Three of them had been sitting in the
handoff as open gaps and were never gaps at all: **Wodka's "$106.03 of
card-processing fees"** (3175 and 3179, the two charged and *not* discounted)
and **Dame Mas's $112.51** (3181's ACH fee). Two Coors months read *wider*
afterwards and are *truer* for it — the discount had been masking a real
barrel-prep difference and a real timing pair.

**KEYWORDS ARE BANNED HERE (D93) AND FEE LINES ARE THE ONE EXCEPTION.** The ban
exists because venue descriptions are hand-typed monthly. Fee lines are not —
they come from QuickBooks' own product catalogue, where "Processing fee" is item
1010000071 — so they are boilerplate and stable. Everything written freehand is
still matched by shape. Five fee lines across 65 invoices; two more, on 3122 and
3148, were already safe because written bare they had always landed in
`expenses`.

**THE POOL, AND WHY IT COULD NOT BE LOADED.** `invoice_recap` is keyed on one
`brand_name`; a Coors invoice covers Barmen 1873, Five Trail **and** Coors
Whiskey's retainer and splits them nowhere (D107). `canary()` now derives a
**label** for every brand — the pool it bills in, or its own name — and applies
the same expression to **both sides** of the comparison. Pool one side only and
the two do not meet. Nine months are loaded under
`Barmen 1873 + Coors Whiskey + Five Trail`: roughly a third of the billing,
previously invisible.

**ONE BRAND MUST RESOLVE TO ONE LABEL, AND NOTHING ENFORCED IT.** The join is on
the brand, so two labels for one brand adds its activity in twice — silently, on
the page whose whole job is to be trusted. It holds today only because the two
billing names reaching these three brands name the *same* three. A third naming
a different subset would break it with no error. `verify_live.py` asserts it now.

**`load_pool_recap.py` WRITES THE RECAP, NOT `parse_invoices.py --apply`**
(D108) — that guard only recognises percentage-priced months and duplicates any
per-unit brand. The new script derives every figure from the PDFs, takes
`consulting` from `brand_retainer` (on the nested layout the retainer line is
bare and the parser cannot name it), **checks the five buckets add back to the
invoice's own stated subtotal before writing anything**, and refuses outright if
two invoices share a month.

**HOW THE LAST FIVE MONTHS WERE CLOSED — 4 of 9 → 9 of 9:**

*September, −$40.* Barmen's `barrel prep` rate was **$0.00** while the invoice
charged **$40** — the figure Five Trail and Blue Run already carried. Set to $40.
February's barrel prep uses a different raw source string, `barrel prep charge`,
still $0.00 and correctly so: that invoice bills no barrel prep. The rate card
keys on the raw string on purpose (D74) and this is what that buys.

*January +$310 / February −$310.* Invoice 3187 bills 2× 5L barrel **"For
Executive cigar and Copper Shaker"** in FEBRUARY; the portal had them dated
31 Jan. Moved to the invoiced month, with the original date and HubSpot deal
`55433915493` recorded in the row's note — HubSpot still holds January and a
promote could revert it (D113).

*Before that, a synthetic row that duplicated real work.* The portal held
**$620** of those barrels against $310 billed: the real row above *and* an
`Invoice-derived` row whose own note claimed *"the portal held 0"* — **written
without looking at the adjacent month.** D108's test came back positive; deleted.

*August +$50 and October +$150.* Real work, correctly recorded, never invoiced:
two Hollerbach tap maintenances ($50 each, both in the workbook) and a fourth
Clermont Brewing printed feature ($100, its own deal and its own photo with a
distinct content hash — checked, and not a duplicate).

**THE OPERATOR'S RULING, AND IT IS A GENERAL ONE:** *"If it is in the workbook
it's to be there, but if it isn't on the invoice then it wasn't billed. The
invoices are the dues — whatever it says is true, so I want the portal to copy
that."*

So the work **stays on file** and **bills nothing**. The mechanism was already
in the data and did not need inventing: **quantity 0**. Since D65 the quantity
is the activity's multiplier, and 44 North already carried two unbilled tap
maintenances at quantity 0 — at Hollerbach, of all places. The row, its venue,
its photo and its HubSpot deal all survive; only the multiplier is zero.

**`quantity = 0` IS NOW THE HOUSE WAY TO SAY "THIS HAPPENED AND WAS NOT
BILLED".** Reach for it before considering a deletion. It satisfies D85 (never
delete a row with photos or a deal) and D107 (the invoice is the authority on
money) at the same time, and it is reversible. Neither type touched here is a
depletion, so no account status moved (D86).

**ONLY DATA BACK TO THE PORTAL.** ⚠️ operator ruling. QuickBooks holds **16**
Coors invoices going back to **Dec 2024**; the PDFs hold 10, from Jun 2025. The
six before that — **$17,036.02** — are older than the portal's first activity
(2025-06-06) and are **not a gap**: there is no activity to compare them against
and never will be. `check_invoice_totals.py` reads the horizon from
`min(activity_date)`, never hardcoded (D60), and reports such invoices
separately. D115's "11 invoices Jun 2025 – Feb 2026" was a miscount of the 10
that exist plus the barrel order.

**THE WORKBOOK IS WRONG ON TWO OF NINE, AND D110 PREDICTED ONE.** August 2025 is
recorded with **$0.00 commission against a real $205**, and February 2026 is
**$310 light because barrels were never entered in the workbooks at all**.
QuickBooks and the PDFs agree to the cent on all ten invoices, so the workbook is
the odd one out. D115's guess that August was "$205 light, a 10L barrel" was
wrong twice: not a barrel, and it is the *workbook* that is light, not the
billing.

**STILL OPEN: invoice 3178** — $720 of barrels, *"Fred Fisher requested
barrels"*, UPS tracking, no work month — reads as a product shipment rather than
field work and sits outside `invoice_recap`'s `(brand_name, month)` key either
way. Barmen's `cwc 10l barrel` rate says **$150** against that invoice's
**$205**, the same disagreement item 3 flags for Blue Run.

**Portal-wide: 49 → 60 of 83 brand-months tie.** 148 tests pass; offline suite
green; 0 anon grants, 0 write grants to `authenticated`. All nine admin pages
and every tab opened in a browser, and the Health page driven to the pool and
read back at 9 / 0 / 0 (D79/D89).

**D119 (continued) — THREE MORE THINGS ON AN INVOICE THAT ARE NOT WORK.**
The same session went on to reconcile the rest, 60 → 64 of 83, and every one
of the four was the same mistake in a new costume: **something on the invoice
that is not field work was being compared against field work.**

**A GOODS INVOICE IS NOT A MONTH OF WORK.** Two invoices carry no commission,
no retainer, and SALES TAX — 3159 (Blue Run, $584.56: two 5L, one 10L, UPS
shipping) and 3178 (Coors, $720.00: two 5L and two 10L to Fred Fisher). Both
are barrels shipped to the brand, which the operator confirmed were "done
separately". Folded into a work month they made **$1,304.56** of phantom gaps
in two months that otherwise tie. **Tax is the discriminator**, and it has to
be: services are not taxed and goods are.

**BUT NOT EVERY ONE-OFF IS GOODS**, which is why the tax test earns its keep.
Invoice **3203** also has no commission and no retainer — and it is **two
tasting events, real field work, separately invoiced**. Operator: *"Dame Mas
has us charge for activities separately but they are logged."* It is untaxed,
so it stays in its month.

**AN ACTIVITY DATE EQUAL TO THE ISSUE DATE SAYS NOTHING.** 3203 reads
"7/8/2026" against an issue date of 07/08/2026 — the day it was typed. Taken
literally it put $455.00 into July, where it made a month that ties read
−$455, while June — which holds the actual work — read **+$455.20**. The work
is the 25 Jun Festival of Speed tasting at $180 and the 11 Jun River & Post
trip, whose **$200.20 of mileage and $75.00 of staff training the invoice
bills as one round $275.00 "Tasting Event"**. Both months now tie but for
**$0.20 of rounding**, which is the whole of it. It is the only invoice in the
file with a slashed activity date, so the rule costs nothing and it is
shape-based: a date that equals the issue date carries no information.

**A BALANCE CARRIED FORWARD IS MONEY ALREADY COUNTED.** Wodka's 3200 bills
*"Remaining Balance — Balance from Previous Invoice — $90.00"*. It was first
billed in an earlier month, so counting it again made June read −$90 against a
month that otherwise ties. Folded into the same not-work bucket as the payment
fees. One invoice in the file does this.

**WHAT IS LEFT, AND MOST OF IT MUST NOT BE TOUCHED.** 19 rows differ, and
**eight are protected**: August 2026 for four brands (arrears, $5,525) and
Aspen Green Feb–May (uninvoiced on purpose, D71). Starr Rum's deliberately
unbilled Nov–Dec 2025, the third protected category, does not appear at all —
Starr Rum ties 4 of 4. Two more are
explained and correct as they stand — Wodka's ±$150 April/May pair, which
**the invoice itself explains** (*"New Cocktail on tap From April but not on
previous invoice"*), and Dame Mas June's $0.20 of rounding.

**The genuinely open ones, with their causes already found:**

| | | |
|---|---|---|
| Heaven's Door | −$539.50, −$310 | **It bills ACCOUNT VISITS at $20** inside the consulting block, where every other brand's invoice says "no charge" — and the rate card prices `account visit` at $0.00 for all eight brands including this one. Its commission ties EXACTLY in both months (280, 965), so the visits and a "Smoke Tops" line are the whole difference. Needs a full pass. |
| Blue Run 2026-01 | −$205 | A `CWC 10L Barrel` for **Black Hawk Bistro** — a venue, so a placed barrel and real activity, unlike 3159's shipment. Three judgement calls stacked: the venue on file is **Black Hawk Social**, there is **no `cwc 10l barrel` activity type at all**, and Barmen's rate says $150 against this invoice's $205. Operator's, not mine (D60/D81). |
| Dame Mas 2025-07 | −$300 | A **`KPIs`** line. A service charge with no venue and no counterpart in the portal — closer to a retainer add-on than an activity. Needs a ruling on where it lives. |
| Aspen Green 2026-06 | +$20 | The portal holds **79 cases** against 75 billed — four extra as `1st case sale`. There is no Aspen Green workbook to arbitrate, and handoff item 12 says explicitly: investigate, do not delete to make it tie. |
| Blue Run 2026-03 | +$160 | A tasting event in a month with **no invoice at all** — Blue Run's invoices stop at 2026-02. |
| Aspen Green 2026-07 | +$1,720 | No invoice in the PDFs, while 44 North and Dame Mas both have July ones. Either a later extension of D71 or a missing invoice — worth a QuickBooks check. |

---

**D118 CORRECTION — WODKA'S $25 CASE PAY IS CORRECT AND MUST NOT BE CHANGED.**
✅ operator-ruled 24 Aug 2026

D118 above, and handoff item A, said to add a Wodka `1st case sale` pay row at
**$5.00**. **Do not.** The operator's ruling: *"Wodka reorder is $5, initial is
$25."* The $25.00 reaching Wodka through the shared `(all brands)` line is the
right number, and the five-minute "fix" would have cut real contractor pay by
$915.

The −$915 is real, but it is the **charge** side: Wodka pays $25 to place a
first case and bills $10 for it. That is a **priced decision, not a data
fault** — the third failure mode in CLAUDE.md's list, which by definition
carries no flag and cannot. It is the operator's to change, not the rate card's
to correct (D60).

This inverts the lesson D94 taught: **a brand falling through to the shared pay
line is a fact to check, not a fault to fix.** Sometimes the shared line is
simply right, and only the operator knows which.

---

**D120 — THE ADMIN PORTAL IS THE `staff` ROLE RELABELLED. THERE IS NO NEW ROLE,
AND ADDING ONE WOULD HAVE FAILED SILENTLY.**
✅ built 25 Aug 2026

The operator asked for an admin surface on the website for himself and Phil —
all brands, all analytics, the rate card, salaries — *"not to be confused with
the admin panel on the back end."* The instinct was that this needed a new role.
It did not, and reaching for one would have been the expensive mistake.

`is_staff()` (`schema.sql:929`) is:

```sql
select coalesce((select role = 'staff' from profiles
                 where user_id = auth.uid() and is_active), false)
```

**It tests one literal string, and `profile_role_enum` has exactly two values.**
That function appears in roughly fifteen RLS policies. A third value —
`'admin'` — would make `is_staff()` return **false**, and every staff-gated
table would return **zero rows with no error at all**. Not a permission message,
not an exception: an empty result set, on a page that renders perfectly. That is
the same shape of failure as D89's blank tab and D92's permanently-disabled
fields, and it would have been blamed on the queries.

**So both admin logins stay `role = 'staff'` and the word "Admin" is a UI
label.** `isStaff()` in `portal.js` tests the same string, and the comment there
says why the two spellings must stay married.

**This is deferred, not dodged.** A real `contractor` role is still coming and
it IS an enum change plus every one of those policies, deliberately, one at a
time. The useful property is the failure direction: `is_staff()` returns false
for any value it does not recognise, so a new role sees **less** by default,
never more.

**Salaries: one tier, both admins, operator-ruled.** The question was put
because Phil is on the contractor list at $619/week and the fee conversation is
still pending. Operator: *"Phil is also the owner of the company so he is
already well aware."* No second gate, no owner tier.

---

**D121 — THE PORTAL NAVIGATES FROM A LEFT RAIL, AND `css/site.css` MUST NOT
MOVE.**
✅ built 25 Aug 2026

The nav went from four items to six and is heading for eight once the rate card
and salaries land. A horizontal bar stops working around six — `site.css`
already gives up at 1024px and swaps to a hamburger.

**The trap is that the portal and the PUBLIC SITE share one stylesheet.**
`css/site.css` owns `nav`, `.nav-logo`, `.nav-links`, `.hamburger` and
`.mobile-nav`, and `index.html` and `gallery.html` use every one of them. A
sidebar written there would have redesigned the marketing site as a side effect.

So the rail is **portal-only**: new class names (`.portal-sidebar`,
`.side-links`, `.portal-topbar`, `.portal-scrim`) defined in `portal.css`, and
`renderShell()` sets `.portal-sidebar` on the `<nav>` element itself, which
outranks `site.css`'s bare `nav` selector. **`css/site.css` was not touched.**
Verified afterwards: both public pages still render a 76px horizontal bar with
six links and no sideways scroll, and no portal class name appears in
`site.css`.

Below 1100px the same element becomes a drawer — off-canvas, a slim top bar to
open it, a scrim, body scroll locked, closing on scrim tap, on a nav link, and
on Escape.

**One measurement trap worth recording, because it cost twenty minutes.** A CSS
*transition* does not advance in a browser pane that is not compositing frames,
and `getComputedStyle` returns the frozen start value — so the drawer read as
permanently shut while working correctly. **Set `transition: none` before
asserting on a transform in a headless or hidden pane**, or the test lies.

---

**D122 — THE GALLERY IS BOUNDED. PHOTOS ARE THE ONLY TABLE HERE THAT GROWS
WITHOUT LIMIT.**
✅ built 25 Aug 2026

Operator: *"Photos will increase as time goes on so I don't want to do something
that could become load bearing in the long run."* Correct, and it changed the
design.

Brands, venues, activity types and rate lines are effectively fixed. **Photos are
not** — every activation adds more, for ever. At 412 today the old page could
load everything; that is exactly the reasoning that ages badly, and the old page
already showed the strain by defaulting to the newest month only, to avoid
signing 400 URLs at once.

The gallery now:

- **asks Postgres to order and slice** — `.order(activity_date desc,
  activity_id desc, id desc).range(from, from + 59)`. The order must be TOTAL or
  a page boundary can repeat or drop a row; verified 0 duplicate keys across all
  412, and a simulated seven-page walk returned 412 distinct rows.
- **applies the filters IN POSTGRES**, not after the page arrives. Filtering a
  page client-side would silently show 60 rows drawn from the wrong set.
- **builds the dropdowns from three SMALL tables** — months from
  `v_brand_monthly_summary` where `photo_count > 0`, brands from `brands`, types
  from `v_activity_mix`. Building them from the photo rows would mean reading
  every photo to populate a control, which is the whole thing being avoided.
- **signs only what has arrived**, cached, so changing a filter never re-signs.

Grouping (month / brand / activity, default month) applies to what is LOADED.
That is deliberate: a grouping that reached across the whole table would undo
all of the above.

**The description on a photo is `summary`, never `caption`.** `photos.caption`
is NULL by design and must stay so — filling it from the HubSpot note body would
publish internal writing (D17/D24). `v_brand_photos.summary` is already
`coalesce(brand_visible_summary, title)`.

---

**D123 — THE ANALYTICS STAY LIVE. THERE IS NO SNAPSHOT PIPELINE, AND THE
ALLOCATION STAYS OUT OF THE DATABASE.**
✅ ruled 25 Aug 2026

The operator's opening preference was to do deep analysis in Streamlit and
**push** chosen tables to the website — *"anything I deem necessary I can then
push to the admin portal on the website so Phil can see for himself"* — while
adding *"I would rather it be live if possible."*

**It can all be live, so nothing is pushed.** Everything asked for is already a
view. The one exception was Cost to serve (D116), which is a pandas allocation
living in the Streamlit page and in no view — and CLAUDE.md forbids promoting it
into one, because D67's fear was other views inheriting base pay silently.

That rule protects the *database*, not the *page*. The allocation can be
computed **in the browser** from `v_contractor_month_cost`,
`v_brand_month_revenue` and an activities-by-owning-contractor read — page-only,
exactly as D116 requires, with no view involved. **Deferred rather than built**,
and with its cost stated: that would be a SECOND implementation of the
allocation which can drift from the pandas one, and it must carry its four
render-time caveats (unallocated payroll, retainer below payroll, unattributed
activities, and the "where this is weak" note) or the grid silently flatters
some brands and penalises others.

**Two premises were corrected on the way.**

**The "site is slow" report came from DYNADOT, and it is worth taking half
seriously.** (First recorded here as GoDaddy; the operator corrected it —
*"it wasn't godaddy it was Dynadot."*) Dynadot **is** in the stack, as registrar
only, so it cannot see the hosting path and can only probe the public site from
outside like any other visitor. Two things follow, and they point opposite ways:

- **It cannot have measured the portal.** Every portal page is behind a Supabase
  login and marked `noindex, nofollow`. No external scanner reaches it. So the
  report says nothing about anything built in this session.
- **It could legitimately have measured the PUBLIC site**, and that is a real
  external probe. So it was measured rather than dismissed:

| | requests | total | images | DOM ready |
|---|---|---|---|---|
| `index.html` | 6 | 636 KB | 3 loaded, **24 of 26 lazy** | 120 ms |
| `gallery.html` | 20 | 785 KB | 15 loaded, **33 of 35 lazy** | 15 ms |

**The structure is sound** — lazy loading throughout, few requests, small HTML
and CSS, and `preconnect` already on both font hosts. The timings are localhost
and mean nothing about the real world. **Two things are genuinely worth fixing,
and both are what an external scanner flags:**

1. **`Hero.jpg` is 401 KB and is the homepage's largest-contentful-paint
   image**; `market.jpeg` adds another 168 KB eagerly. Those two are **569 KB of
   the homepage's 636 KB**. WebP or AVIF would cut them roughly 60–70 percent.
2. **The Google Fonts stylesheet is RENDER-BLOCKING from a third-party origin**
   (`renderBlockingStatus: "blocking"`). Preconnect softens the handshake but
   the blocking request remains. Self-hosting the two families — `woff2` files
   plus `@font-face` in `css/site.css` — removes it entirely and needs no build
   step, so it does not touch the locked no-npm decision.

Neither is urgent and neither was done this session. **Designing the gallery for
load is still right for D122's reason** — unbounded growth — not for this one.

**"Only clean data, not staged" was already true, and is stronger than
assumed.** The operator asked that the portal show only promoted data. The entire
`staging` schema is revoked from `anon` AND `authenticated`
(`schema.sql:2493-2495`), so no browser can reach it at all, and
`sync_hubspot.py` writes only to `staging.hubspot_deals`. Nothing to build.
**The one exception is venue ATTRIBUTES** — `apply()` upserts `brands` and
`venues` directly, before the staging zone (D83), which is why `Crown Lounge`
still carries a venue name in its city column.

---

**D124 — A PORTAL PAGE MISSING FROM `login.html`'s ALLOWLIST IS SILENTLY
REDIRECTED, NOT BLOCKED — AND `business.html` HAD NEVER BEEN IN IT.**
✅ found and fixed 25 Aug 2026

`login.html` keeps an allowlist so a crafted `?next=` cannot bounce someone off
site. Anything not on the list falls through to `index.html`. The list read:

```js
const ALLOWED = ['index.html', 'activity.html', 'venues.html', 'photos.html'];
```

**`business.html` was never added.** So a staff member who followed a link to it
while logged out signed in successfully and landed on the dashboard, with no
error and no explanation — since the day that page was written. Nobody noticed
because the nav link works once you are already in.

**Every new portal page must be added to that list.** All four new ones are, and
so is `business.html`.

`requireAuth()` also dropped the query string, so `brand.html?slug=44-north`
came back as a bare `brand.html`. It now carries the search string through and
`login.html` matches **only the filename half** against the allowlist. Confirmed
that `//evil.com`, `https://evil.com`, `../../etc/passwd` and
`index.html/../../out.html` all still fall through to the dashboard.

---

**D125 — RLS IS VERIFIED BY IMPERSONATION IN POSTGRES, AND THE TEST MUST BE ABLE
TO FAIL.**
✅ 25 Aug 2026

The operator was away from the machine and asked whether a login could be created
for testing and deleted afterwards. It cannot — accounts and passwords are not
ours to create. **The better test needed no login at all.**

RLS is enforced in Postgres, and `auth.uid()` reads
`request.jwt.claims->>'sub'`. So each account can be impersonated inside a
transaction that is rolled back:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<user_id>"}', true);
-- probe every table, then rollback
```

**The result, and it is the isolation proof the plan asked for:**

| probe | service_role | test-bluerun | test-wodka | phil (staff) |
|---|---|---|---|---|
| activities | 1236 | 119 | 205 | 1236 |
| brands | 12 | 1 | 1 | 12 |
| photos | 412 | 46 | 45 | 412 |
| **priced money rows** | 1185 | **0** | **0** | 1185 |
| rate_card | 253 | **0** | **0** | 253 |
| contractor_pay | 3 | **0** | **0** | 3 |
| venue_grading | 339 | **0** | **0** | 339 |
| invoice_recap | 56 | **0** | **0** | 56 |
| brand_retainer | 13 | **0** | **0** | 13 |

A brand login gets its own rows with the money columns NULL — which is the
`security_invoker` design working — and cannot read one row of any staff table.

**THE CRITICAL PART IS THE CONTROL.** If the connecting role bypassed RLS, every
column of that table would equal the baseline and the check would pass while
proving nothing — D114's lesson, that a check whose two sides share a source
cannot fail. So the script asserts `is_superuser = off` and asserts that the
impersonated counts DIFFER from the baseline. Both hold.

**What this does NOT cover is rendering**, and no amount of SQL will. D79
stands: a person still has to open every page.

---

**D126 — 44 NORTH'S REORDERS ARE BEING PAID FOR AND ARE NOT IN THE PORTAL, SO
ITS MARGIN IS OVERSTATED TODAY.**
⚠️ analysed 26 Aug 2026 — **nothing written to the database.**

**This CORRECTS the framing in D118.** That entry read the 228 unbilled cases as
revenue never captured, and treated the cost as a future problem. It is not.

⚠️ **operator ruling, 26 Aug 2026:** *"we have started paying on reorders for
44 North this started when we brought Eric on. he came on in March of this year.
so we're paying him and we get depletion reports from the distributor so that's
how we check."*

So the cost is **real, being paid, and invisible**. The portal holds **exactly
one** 44 North `recurring case` row in its entire history — one row, July 2026,
$5.00.

| 44 North, Mar 2026 onward | charged | paid | margin | |
|---|---|---|---|---|
| as the portal reports it | $5,580 | $2,960 | **$2,620** | 47.0% |
| + 150 unrecorded reorders | $5,580 | $3,710 | $1,870 | 33.5% |
| + 223 unrecorded reorders | $5,580 | $4,075 | **$1,505** | **27.0%** |

**44 NORTH IS NOT THE BEST ACTIVITY MARGIN, AND THAT WAS THE WHOLE BASIS OF THE
QUESTION.** All-time it reads 45.4 percent, which ranks it fourth. Corrected for
reorder pay it lands near **36–39 percent**, behind Barmen 1873 (55.7),
Blue Run (49.5), Five Trail (46.8) and Starr Rum (44.0). It looked best because
its largest cost is not in the system.

**DO NOT COPY THE WODKA MODEL FLAT.** Wodka is 10 percent ($10 on a ~$100 case);
44 North is $50 on a ~$252 case, which is **19.8 percent**. A flat 10 percent
would charge **$25.20** to place a case that pays **$25.00** — recreating, at
44 North, the exact initial-case loss the change was meant to fix. Modelled per
month on D118's volumes:

| | charge | pay | margin |
|---|---|---|---|
| today, reorders invisible | $450 | $225 | $225 |
| record reorders, still charge $0 | $450 | $388 | **$62** |
| flat 10% of every case | $1,048 | $388 | $660 |
| **$50 placement + 10% on reorders** | $1,271 | $388 | **$883** |

Placement is the work; reorders are the annuity. **Pricing them identically is
what creates the initial-case problem**, so keep the placement fee.

**The $252 reference price is still unverified** and the answer swings roughly
±50 percent across $200–$300 a case (D118 item D stands).

---

**D127 — MATCHING THE DEPLETION SHEET: SIX OPERATOR RULINGS, AND A NAME IS NOT
AN ACCOUNT.**
✅ 26 Aug 2026. Read-only; the decision sheet is
`Ihospitality/44North_depletion_rulings_2026-08-26.csv`.

44 North's state-wide sheet (`07_2026EOMFlash`) carries **342 customers and 678
cases FYTD** against a stated total of 687 — nine cases sit in rows with no
account number, so **the file does not fully reconcile to itself**.

⚠️ **THE SHEET IS A ROSTER, NOT A CHANGE REPORT.** Its title says *"Customer
Performance Declining / Gained"*, which reads as movers-only. Operator: *"it's
anyone who has ordered in 2 years."* That matters in both directions and the
second one is the valuable half — **152 of the venues we service for 44 North
are absent from the sheet entirely, so they have not bought 44 North in two
years.** That is a **grading input** (D117), not a billing one.

**The rulings, each of which the matcher could not have inferred:**

1. **Maggie McFly's is NOT ours** — two locations, 12 cases, excluded.
   ⚠️ **CORRECTED later the same day, 26 Aug: "not our account" does NOT make
   the one billed case sale fake.** The ruling above STANDS for the depletion
   sheet — both accounts (700439549, 662 SE Becker Rd, Port St Lucie; and
   700349851, 6000 Glades Rd, Boca Raton) stay out of the reorder pool, all 12
   cases. But an earlier reading of it produced a data correction — *"Maggie
   McFly PSL, 18 Mar 2026 — reclassify to an account visit"* — and **that
   correction is WITHDRAWN and must not be applied.** Operator: *"That case
   sale we billed shouldn't have happened, but the brand was ok with it
   because we did open a relationship there."* The row is a real depletion, it
   was really billed at $50.00, and it stays a **Case Sale** — it is already
   counted correctly as one of the eight billed cases sitting legitimately
   outside the sheet. **The two facts are not in tension: the premises is not
   an account we service for REORDER purposes, and the single placement we
   made there is real.** Nothing was ever written to the database from either
   reading, so there is nothing to undo — only a correction not to make.
   `NOT_OURS = {"maggiemcflys"}` in `match_depletion.py` and
   `build_ruling_sheet.py` is therefore correct and stays. Note it is keyed on
   the normalised NAME, which collides both premises into one key — harmless
   while both are excluded, and the reason to re-key it on the account number
   if either is ever ruled back in.
2. **STARDUST LOUNGE is the portal's "Aku Aku"** — one premises, two names, at
   431 E Central Blvd. The DB has no Stardust and the sheet has no Aku Aku.
   Same shape as the Mullets ruling. **Rename or alias it or this recurs
   monthly.**
3. **Every Spirits2U location is one account** — *"we just normally meet at
   their head office."* Three stores in the sheet, one venue in the portal.
4. **Nine accounts ruled ours that are NOT venues yet** — The Station,
   Rachel's, The Drinkery, Tony's Liquor, both Yarderys, Burtons, The Roasted
   Spirit and FM Pizza Oven. **50 cases between them.** (The operator wrote
   "buttons"; BURTONS, Orlando, is the only candidate that fits — confirm before
   creating the venue.)
5. **Territory is not the distributor's market column** — *"there might be a few
   locations out of Jacksonville, Tampa and Pensacola that are on our sheet."*
6. And the roster ruling above.

**A CHAIN CUTS BOTH WAYS, AND ONLY A PERSON KNOWS WHICH.** Spirits2U's three
stores are one account; Total Wine's nineteen may not be. Name-matching alone
would have handed all three Spirits2U stores' cases to one venue, and a city
guard would have wrongly split them. **Both behaviours are correct in different
cases**, which is why each chain is a listed ruling rather than a rule the
matcher infers (D81/D97).

**Also: the distributor's "Miramar" market is NOT Palm Beach County.** It is the
South Florida warehouse and spans Broward and Dade — the sheet puts Miami,
Ft Lauderdale and Plantation in it, alongside Treasure Coast towns. Filtering on
it overstates the candidate pool. Two markets only, and the enum's vocabulary
does not map onto the distributor's.

**Where it stands: 194 of ~223 cases accounted for** across 47 accounts — 123
matched to venues on file, 21 Stardust, 50 newly ruled. **287 rows are undecided but only 120 carry
any cases at all**; the other 167 are zeroes and can be skipped. The largest
open ones are Pensacola: Blend 21, Shades at the Loop 20, Casino Beach 11. The decision sheet is keyed on the
**distributor's account number, never the name** — the venue-grading round
trip's rule, and Stardust is exactly why.

---

**D128 — ALL THREE CONTRACTORS SHARE ONE PAY START DATE, AND IT IS THE PORTAL'S
OWN HORIZON.**
⚠️ raised 26 Aug 2026 — **unresolved, needs operator data (D60).**

`contractor_pay` gives Phil, Nick and Eric an `effective_from` of **2025-06-01**
— the same day for all three, and the same month the portal's activity history
begins (`min(activity_date)` is 2025-06-06). Three identical dates landing on
the data's own horizon is the signature of a **seeded default, not three hire
dates**.

The operator said in passing that **Eric came on in March 2026**. If so the
portal carries **$6,300 of base pay Eric was never paid** — nine months at $700
— out of the $10,500 recorded against him.

**What it contaminates:** the $4,132.33/month figure on the new Contractor pay
page, `v_contractor_month_cost` for fifteen months, and the **Cost to serve**
allocation (D116) — which is the analysis that concluded 44 North's $1,450
retainer does not cover its $1,510 of payroll. That conclusion is not safe until
the dates are right.

**Ask for each person's real start date before touching anything.** A pay period
is add-only and effective-dated for a reason: editing one in place silently
restates every month before it.

---

**D129 — THE VENUE PAGE IS KEYED ON `venue_id`, AND `v_brand_activity_log`
GAINED THE COLUMN TO MAKE THAT POSSIBLE.**
26 Aug 2026. Operator: *"if I click on a venue it pulls up the venue page with
all the activities and then I can click on the individual activities."*

`venues.html` had never been clickable and there was no venue page at all. There
is now: **`portal/venue.html`**, opened from a venues row and opening an
activity in turn, so the chain is venues → venue → activity.

**THE LINK IS AN ID, AND THAT WAS A DELIBERATE COST.** `v_brand_activity_log`
carried `venue_name` and no `venue_id`, so the page could have been built with
no schema change by matching on the name. It would have worked on the day it was
written — 340 venues, 340 distinct names, zero collisions — and it is the wrong
foundation. **The Venues admin exists BECAUSE one premises turns up under two
names**; a chain is the same fault reversed, two premises under one name. A name
match would then blend two accounts into one history with every figure on the
page wrong and nothing on screen to say so. Operator, asked which way to go:
*"I am not really looking for the easiest… I want reliability."*

So the view gained `a.venue_id`, **appended at the tail** — `create or replace
view` can only ADD columns at the end, and inserting one mid-list fails with
'cannot change name of view column'. The column is nullable on purpose: 97
activities have no venue and are absent from every venue page by definition.

**A SHARED VENUE IS THE WHOLE RISK, AND POSTGRES CARRIES IT.** A venue is not
one brand's — Levee Liquors holds **8 brands across 31 activities** — so a page
that filtered in the browser would be a disclosure. The query carries no brand
filter (the house rule) and RLS scopes it. Verified by impersonation rather than
by logging in (D125), which is also the only way to check both sides at once:

| viewer | activities at Levee | brands |
|---|---|---|
| service_role | 31 | 8 |
| Phil (staff) | 31 | 8 |
| Blue Run | **2** | Blue Run only |
| Wodka | **1** | Wodka only |

`is_superuser=off` asserted and the impersonated counts asserted to DIFFER from
the baseline, or the probe could not fail (D114). Confirmed in a browser as well
— as a brand the page drops the Brand column, drops every money column, and
shows no other brand's status. **Opening another brand's venue gives "Nothing to
show for this venue", and does NOT distinguish "not on file" from "not yours":**
telling those apart would leak the existence of other brands' accounts.

Internal notes cannot reach the page: it reads `v_brand_activity_log`, whose
whole point is that `activities.notes` is not in it. And `venue.html` went into
`login.html`'s ALLOWED list, or it would have been silently redirected to the
dashboard after a successful sign-in (D124).

---

**D130 — BUSINESS IS THE BUSINESS; BRANDS IS PER BRAND. THE BUSINESS PAGE NOW
OWNS BASE PAY AND NET, WHICH NOTHING ELSE IN THE PORTAL HAS EVER SHOWN.**
26 Aug 2026, after the operator asked a question nobody had answered: *"What is
the difference between the business tab and the brands tab? Like purpose wise.
It is a genuine question."*

**The honest answer was that there mostly wasn't one.** `business.html` was
built 23 Aug on `v_brand_money` — all-time, activity charge only, no retainer.
`brands.html` was built 25 Aug on `v_brand_month_revenue`, which has the
retainer in it and a month window, and does the same job better. The per-brand
money table on Business was a strictly worse copy of the table next door:
$37,963.93 charged against $119,513.93 of revenue, because **the retainer is
$81,550, about two thirds of what iHospitality sells** — exactly the understatement
the standing rule against `v_brand_money` warns about.

So the page changed job rather than gaining a date filter. It now reads
**`v_month_business`** over a From/To range and shows **revenue, activity cost,
contractor base pay and NET** — and base pay and net had never appeared anywhere
in this portal. Every other margin figure in the app is *before* base pay, on
purpose, because base pay is a company cost and pushing it down onto brands is a
page-level allocation that must not become a view (D67/D116). `v_month_business`
holds it one level up, which is the level this page reads. **That is what keeps
D116 intact while still showing the number.** The duplicate per-brand table is
gone; the two pricing-fault panels stay and are now windowed by month.

**TWO FIGURES ON IT WOULD READ AS BANK FIGURES AND ARE NOT, SO THE PAGE SAYS SO.**
Base pay is `sum(monthly_equivalent)` — an **annualised spread**, exact for the
monthly and semimonthly contractors and an average for weekly and biweekly. And
all three contractors still share one pay start date of 2025-06-01 (D128), so if
any of them started later the base pay is too high and net too low. Both caveats
are printed under the table rather than left in a comment, because the numbers
they qualify are on the screen.

---

**D131 — THE MONTH PICKERS RUN OLDEST-FIRST, AND REORDERING THEM MUST NOT MOVE
THE DEFAULT.**
26 Aug 2026, operator request: oldest at the top, newest at the bottom.

`monthRange()` in `portal.js` is the single definition behind every From/To pair
in the portal, so the change is one line there and reaches `brand.html`,
`brands.html` and the rebuilt `business.html` at once.

**The reversal happens at RENDER time, on a copy.** The caller hands `months`
newest-first and it is the same array the function indexes to pick defaults, so
reversing it in place would have moved the opening range as a side effect. It
does not: `[...months].reverse()` builds the options, while `from.value` and
`to.value` still index the original descending array. **A `<select>` takes its
value BY VALUE, not by position**, so reordering the options moves nothing —
every page still opens on the last twelve months. Confirmed in a browser on all
three pages: options run June 2025 → August 2026, selection stays September 2025
→ August 2026.

---

**D132 — AN ACTIVITY CAN BE ADDED IN THE ADMIN, WITHOUT A HUBSPOT DEAL. IT IS
THE FIRST ROW-CREATING WRITE PATH AND IT IS DELIBERATE.**
26 Aug 2026. Operator: *"I would rather not go through HubSpot. Let's make that
I can add it in the review and edit tab."*

Until now every activity reached the portal through HubSpot — it lands in
staging and a person promotes it (D64). That is still right for work a
contractor logged. **It is wrong for work nobody logged**, which is a real and
growing category: a reorder that came through the distributor's rep with no
visit (D118), or a line found on an invoice months later (D108). Making the
operator invent a HubSpot deal to record something that was never a deal is a
worse lie than recording it here.

**A ROW ADDED HERE HAS NO `hubspot_deal_id`, AND THAT IS THE POINT.** The sync
joins on the deal id, so it can neither revert this row nor duplicate it — the
row exists in the portal only. That is D84 exactly: the portal is the source of
record and HubSpot is an input. `hand_edited_by` is stamped so provenance is
readable.

**WHAT IT REFUSES TO DO.** It does not create venues — `_resolve_venue` refuses
to guess for good reasons (D81) and the Venues page is where a venue is made; a
row can be saved with no venue, but says out loud that money on a venue-less row
is D111's signature. And it does not let the operator type a
`source_activity_type` freehand: that raw string is what pricing keys on (D74),
so the picker offers only strings the rate card already knows, each labelled
with what it charges, and marked when the price comes from the shared
`(all brands)` line rather than a brand line — which is a fact to check, not a
fault (D119). The vocabulary is queried, never hardcoded (D60).

**IT PRICES THE ROW BEFORE SAVING, BY INSERTING IT AND ROLLING BACK.** Same
method the Rate card uses to price an edit (D91): apply it, ask
`v_activity_money`, roll back. Never by recomputing pricing in Python, because a
charge and a pay for one job need not sit on the same `rate_card` row and any
second implementation drifts (D90). So the operator sees charge, cost, margin
and the resolved type before committing — and a `recurring case` for 44 North
shows its $0.00 charge against $5.00 of pay on screen, which is D118's
structural gap made visible at the moment of entry.

**AN EXACT DUPLICATE IS REFUSED, AND THAT IS DOMAIN-CORRECT, NOT DEFENSIVE.**
Since D65 the quantity is the multiplier, so two identical case sales at one
venue on one day are ONE row with quantity 2. The check also closes the replay
hole: a Streamlit rerun can repeat a button press, and for an INSERT a repeated
press is a duplicate row rather than a misdirected write (D103).

**TWO BUGS THE BROWSER FOUND, BOTH OF WHICH LOOKED FINE IN THE CODE.**

1. **`activities_date_not_future` is a CHECK constraint**, and the date defaulted
   to the last day of the selected month. For the month you are IN that is a
   future date — August 31 against a real date of August 26 — so the insert was
   refused with a raw constraint error. The default is capped at today and the
   picker's `max_value` is today.
2. **THE DATE DID NOT FOLLOW THE MONTH PICKER.** A Streamlit widget keyed on a
   constant keeps the value it already holds, so selecting June left the date
   sitting in August and the row would have filed itself into the wrong month
   **silently**. The key now interpolates the month, so it is a different widget
   per month and the default re-derives. Same reasoning as D103: the key carries
   what it refers to.

Not an `st.form`: a form does not rerun until submit, so `disabled=` against
another widget in it can never change (D92). Live widgets in a fragment.

**The status trigger still only ever ADVANCES (D86)**, so a backdated depletion
moves a venue to `placed`/`reordering` without regard to chronology. The page
says so after saving rather than letting it be discovered.

---

**D133 — THE INTERNAL DOCUMENTS WERE PUBLIC ON THE DEPLOY PREVIEW. THEY LIVE IN
`docs/` NOW, FORCE-404'd.**
⚠️ found and fixed 26 Aug 2026.

`https://deploy-preview-1--cool-dusk-e84d8f.netlify.app/DECISIONS.md` returned
**200**. So did `CLAUDE.md`, `HANDOFF.md`, `PROGRESS.md`, `PORTAL_PLAN.md`,
`BUILD-PLAYBOOK.md`, `GALLERY_PLAN.md` and `WORK_LOG_2026-07-27.md` —
**305 KB of DECISIONS.md alone**, 290 of its lines mentioning contractor pay,
margins or invoices. Every brand's rates, the base pay figures, the invoice
reconciliation, revenue. No login in front of any of it.

**THIS IS D12's RULE, AND D12 ONLY EVER COVERED HALF OF IT.** The repo root IS
the Netlify publish directory, so every committed file is served; D12 worked
that out for `*.sql` and concluded the schema must live in the other repo. The
markdown was never considered, because it is *documentation* and documentation
does not feel like a servable asset. It is one.

**PRODUCTION WAS SPARED BY AN ACCIDENT OF BRANCHING, NOT BY ANY CONTROL.**
`ihospitality.vip` returned 404 for all of them only because they sat on
`portal-v1` and had never reached `main`. **Merging PR #1 would have published
every one of them.**

**The fix is a directory, not a pattern, and the distinction is D12's own.**
Netlify's `*` is a TRAILING splat, not a filename glob — which is exactly why
`/portal/*.sql` does not match and would have served the schema while looking
blocked. `/docs/*` is a directory prefix, the one shape the splat really does
cover. So the documents moved into `docs/` rather than being blocked where they
lay.

**The `!` is not decoration.** Netlify serves a matching static file IN
PREFERENCE to a redirect unless the rule is forced, so `404` without the bang
would have left every file readable while the rule sat in `_redirects` looking
like it had closed them — the same class of fault as the rule it replaces.

`CLAUDE.md` cannot move: Claude Code reads it from the project root. It carries
the same commercial detail, so it is force-404'd by exact path. An exact literal
path works where a pattern does not.

**Verify by fetching, never by reading the rule.** That is the whole lesson of
D12 and of this entry: both times the rule looked right and the file was served
anyway.

---

**D134 — `activities.notes` WAS READABLE BY A BRAND LOGIN. THE GRANT IS PER
COLUMN NOW.**
⚠️ found and fixed 26 Aug 2026, while designing D135.

The standing rule says internal notes are never brand-facing, and every
brand-facing view honours it — omitting `a.notes` is the stated purpose of
`v_brand_activity_log`. **The rule was true of the views and false of the
table.** `grant select on ... activities ... to authenticated` was table-wide,
so `select notes from activities` returned a brand's own rows: candid internal
commentary about their accounts, the kind D17/D24 decided not to publish.

**NOTHING LOOKED WRONG, WHICH IS WHY IT LASTED.** RLS was doing its job — a
brand still saw only their own rows — and no portal page reads the table, so
nothing exercised the hole. It needed someone to go and ask.

**THE FIX IS A NARROWER GRANT, NOT NO GRANT.** The brand-facing views are
`security_invoker`, so they execute with the CALLER's privileges and the caller
must hold SELECT on the base table. Revoking outright blanks every brand page.
So `activities` is granted column by column, and `notes` is not one of them.

**THE OMISSION IS THE MECHANISM, so the list is written out in full** rather
than as "everything except". A column added later is not granted, and a view
selecting it fails loudly for brand users on their next page load instead of
quietly publishing it. That is the failure direction worth having (D120).

Verified by impersonation inside a rolled-back transaction BEFORE applying: all
thirteen brand-readable views returned identical row counts, and
`select notes from activities` moved from 119 rows to permission denied. Then
verified again on live after applying.

**`db/test/run.sh` asserts it now, and the first two attempts at that assertion
were both broken** — instructive, so they are recorded. The first tested the raw
ACL string for `authenticated=...r` and matched the **`r` in "postgres"**, so it
could never pass. The second counted any privilege on `notes` and so counted
REFERENCES, which grants no read at all. A check that cannot pass is as useless
as one that cannot fail (D114). There is a third assertion as the control: at
least fifteen columns must still be granted, or the check would pass simply by
locking everyone out of everything.

**The grant block is the LAST thing in `schema.sql`**, because `hand_edited_at`
and `hand_edited_by` are added by `ALTER` far below the grant section and you
cannot grant a column that does not exist yet. The throwaway cluster caught
that on the first run, which is what that harness is for.

---

**D135 — WHO DID THE WORK LIVES IN `activity_contractor`, STAFF ONLY. NOT A
COLUMN ON `activities`.**
26 Aug 2026, operator request: *"I need to be able to assign a contractor to the
activity."*

There was no contractor link on an activity at all. The only attribution was
`venue_grading.owner_contractor_id` — who owns the venue NOW — which is the
weakness D116 already names in Cost to serve.

**A SEPARATE TABLE, FOR THE SAME REASON `venue_grading` IS ONE (D88).** A brand
login holds SELECT on `activities`, because the brand-facing views are
`security_invoker` and run with the caller's privileges. So a `contractor_id`
column there is a column a brand can read, and it would publish our staffing of
every one of their accounts. The policy on the new table is `is_staff()`.

Proved with real data, not with an empty table: a Blue Run activity assigned to
a contractor inside a rolled-back transaction reads **1 row as service_role, 1
as Phil, 0 as Blue Run**, with `is_superuser=off` throughout. Two empty tables
comparing equal would have proved nothing (D114).

**BLANK MEANS NOT RECORDED, NEVER "NOBODY"** — the same reading as a blank venue
grade. The 1,236 activities already on file are deliberately NOT backfilled from
whoever owns the venue today: that is precisely the assumption D116 flags as its
weakest part, and freezing it into data would stop it looking like an
assumption. **Cost to serve is deliberately unchanged and does not read this
table yet** — with almost every row blank it would reattribute the business to
nobody. Revisit when the field is populated.

One contractor per activity: the activity id is the primary key. Shared work
would need a composite key and a rule for splitting it — not a change to make
speculatively.

Settable in two places: the grid on Review and edit (so existing rows can be
assigned) and the "Add a missing activity" form (D132). In the grid it is the
one editable column that does not live on `activities`, so the save
special-cases it — and skips the `update activities` entirely when the
contractor was the only edit, because `update ... set where id = ...` is a
syntax error rather than a no-op, and stamping `hand_edited_at` would wrongly
tell the sync the activity itself had changed (D84).

---

**D136 — A PAY PERIOD CAN BE CORRECTED IN PLACE. THE PAGE WAS ONLY EVER HALF
FINISHED.**
26 Aug 2026. Operator: *"Eric, I need to change his start date but I can't seem
to be able to just change it without deleting him and starting over."*

He was right, and the page was right too. "Set or change pay" is add-only on
purpose: a RISE is a new period, because editing the amount in place restates
every month before it. **That is correct for a change and wrong for a mistake.**

D91 drew this exact line for the rate card — *"Correcting a rate that was always
wrong should reach back; changing a price from a date forward must not"* — and
the rate card got both halves. The Contractors page got one. So the only route
to a wrong start date was delete-and-recreate: losing the note, the id and any
history hanging off it, to fix a typo.

**"Correct a pay period" edits in place and says so loudly.** It restates
history by design, and the impact is measured before saving the same way the
rate card measures a rate edit: apply it, ask the views, roll back (D91). Never
by recomputing pay in Python — `monthly_equivalent` spreads annual cost across
months and a second implementation would drift.

**THIS IS THE CONTROL D128 NEEDS.** Moving Eric Anderson's `effective_from` from
2025-06-01 to April 2026 shows, before saving: his recorded base pay
**−$7,000.00**, the months it covers 15 → 5, company base pay −$7,000.00 and
**company net +$7,000.00**. D128 estimated $6,300–$7,000 of base pay he was
never paid; the page now puts the exact figure on screen and asks for a
confirmation that says *the old record was wrong* rather than *save*.

It keyed its impact query on `contractor_id` at first and failed —
`v_contractor_month_cost` exposes `contractor`, the NAME, and has no id column.
The page caught it and showed the operator "Refused, and nothing was changed",
which is the behaviour to keep: a preview that cannot compute must refuse, not
guess.

---

**D137 — THE CONTRACTOR ROLE. A FIELD REP READS EVERY VENUE AND EVERY ACTIVITY,
AND NO MONEY BUT THEIR OWN.**
✅ built 27 Aug 2026. D120's enum change, done deliberately.

The operator's statement of purpose: *"a central location of information and use
for the contractor"* — a place to see the work they have done, organised. **Three
versions, and only V1 is built:** V1 is read-only (field reference, worklist, pay
statement, with the Brand and Training tabs present and saying "Coming soon");
V2 fills those two in; **V3 is logging, where the contractor enters their own
work and HubSpot stops being the input** — the direction D84 already points, and
the point at which D61 has to be reopened on purpose rather than by accident.

`profile_role_enum` gains `contractor`. `is_internal()` = `is_staff() or
is_contractor()` and it is **the line for data that is internal but not
financial**: venues, activities, photos, notes, grades, who did what. It is NOT
the line for money — `rate_card`, `contractor_pay`, `brand_retainer`,
`brand_product`, `invoice_recap` and the billing tables stay `is_staff()`,
because a contractor holding their own pay rate AND the charge for the same row
holds iHospitality's margin on their own work.

**`activities.notes` COULD NOT BE GRANTED, AND THAT IS WHY THERE ARE DEFINER
VIEWS.** The grant on `activities` is a written-out column list precisely so a
new column is not published (D134) — and it is granted to `authenticated`,
which is brand users *and* contractors alike. Widening it would have handed
`notes` straight back to every brand and undone D134 the day after it landed. So
`v_internal_activity` is a **SECURITY DEFINER view** that selects `notes` and
gates on `is_internal()` in its own WHERE clause. Same for `v_contractor_names`,
because `contractors.note` is internal writing about a person (D88).

⚠️ **WHICH MAKES THE `where` CLAUSE THE ENTIRE BOUNDARY.** There is no policy
underneath a definer view. `db/test/11_contractor_test.sql` asserts a brand login
reads **zero** rows from both, and that assertion was proved able to fail: with
the gate removed it reports *"A BRAND LOGIN READ 4 ROW(S) OF v_internal_activity
— internal notes are published"*.

**THE PAY VIEWS NEEDED DEFINER *FUNCTIONS*, NOT DEFINER VIEWS, AND THE
DIFFERENCE COST AN HOUR.** `v_my_pay` and `v_my_activity_pay` read
`v_contractor_month_cost` and `v_activity_money`, both `security_invoker = true`
— and `security_invoker` keys off `current_user`, which **a definer VIEW does
not change**. The inner views therefore still ran as the contractor, RLS still
hid `rate_card` and `contractor_pay`, and the result was an empty pay page and a
table of NULL money. A SECURITY DEFINER **function** does change `current_user`.
Written that way rather than by recomputing either figure: the monthly spread has
one definition (D136) and pricing has one definition (D90).

**A CONTRACTOR READING `v_activity_money` GETS THE ROWS AND NOT THE MONEY.** It
does not return zero rows — the rate-card join simply yields NULL, exactly as it
does for a brand login. So contractor pages must never read it: it renders a full
activity list with every figure blank, which looks like broken data rather than a
boundary. The test asserts the part that matters — that no charge and no cost
escape through it.

Verified on live by impersonation in a rolled-back transaction (D125), with the
control (D114): contractor reads **0** from all five money tables against
service_role baselines of 253 / 3 / 13 / 2 / 56, and reads all 1,238 activities,
340 venues and 632 internal notes.


---

**D138 — TWO VENUE SURFACES, AND THE SPLIT IS THE DESIGN. WHAT IS WITHHELD FROM
A COLLEAGUE'S ACCOUNT IS THE JUDGEMENT, NOT THE FACT.**
✅ operator ruling, 27 Aug 2026.

*"While contractors can see all the venues and click on them and see what
activities, I don't want them to see the money, but also don't want them to see
days since last touched. I would want all the venues a separate tab from their
venues and in their venues they see all the information, days, money, activities
everything."*

**My accounts** (`my-venues.html`, and the dashboard worklist) — the venues they
own: days since, volume, their own earnings, status, grade. **All accounts**
(`venues.html`) — every account in the business, for walking into one you do not
own: activities, who did them, notes, grade and owner, and **no money and no
days-since**.

⚠️ **THE QUIET COUNT IS NOT CONCEALED, AND THE CODE SAYS SO.** The dated activity
list is on the venue page, so anyone can subtract. What is removed is the column,
the dormant badge and the sort — because a page that ranks a colleague's accounts
by how long they have been neglected is passing judgement on that colleague, and
this page is for looking an account up. **Do not "fix the leak" by hiding the
dates**: that would gut the one thing the tab is for, to conceal a number that
was never concealed. A comment claiming otherwise would be false and would invite
exactly that change.

**Money on your own accounts means YOUR EARNINGS and VOLUME** — never the charge
side, which with your own pay in hand *is* the margin. And the earnings are
scoped through `activity_contractor`, so **a venue you own where a colleague
worked lists the activity with nothing against it**. That is correct, and the
page says so rather than hiding the row.

**The inference leak is accepted for now**: a contractor who knows their own
rates can price a colleague's visible activities. Operator — Phil owns the
business and Nicholas does the books, so both already know every rate; Eric does
not know what either of them is paid, and base pay stays private.


---

**D139 — WHO DID THE WORK CAME FROM THE HUBSPOT DEAL OWNER. IT WAS NEVER A
GUESS, AND IT WAS SITTING THERE ALL ALONG.**
✅ 27 Aug 2026. 1,057 rows written.

`activity_contractor` was added on 26 Aug (D135) and deliberately left empty:
1,236 rows could not be assigned by hand, and inferring from who owns the venue
NOW would have attributed a colleague's work — and, once `v_my_activity_pay`
existed, a colleague's MONEY — to the wrong person. That is D116's named weakness
applied to somebody's pay record.

**HubSpot already held the answer.** Operator: *"All the deals pulled from
hubspot has a contractor name attached, let's use that to match it."* Checked
live before writing anything: all **1,057** activities carrying a
`hubspot_deal_id` resolve, **every one with an owner**, and the distribution is
genuinely spread rather than sitting on whoever ran the imports — **Phil King
773, Eric Anderson 145, Nick Fatta 80, Alan Merrick 59**.

**ALAN MERRICK OWNS 59 DEALS AND WAS NOT IN `contractors`.** Created **INACTIVE**
(operator ruling): his history attributes correctly, and he gets no login and no
pay record. That is what `contractors.is_active` is for — the table keeps people
rather than deleting them, because their work is part of what last year cost.

**The 179 rows with no deal id stay blank.** Nothing to read an owner from, and
BLANK MEANS NOT RECORDED, NEVER "NOBODY" (D135).

**THE DRY RUN HAD TO BE A REAL PREVIEW, SO IT RUNS AND ROLLS BACK (D91).** The
first version computed the preview *before* creating Alan and created him only on
`--apply`, so the dry run reported his 59 as unattributable and the real run
attributed them. A preview that does not match what the run does is worse than no
preview. `backfill_activity_contractor.py` now does all its work in one
transaction and rolls it back unless `--apply`.

⚠️ **THIS CHANGES D116'S PREMISE.** Cost to serve does not read
`activity_contractor` because it was blank; it is now **1,059 of 1,238 (86%)**.
Whether to switch the allocation from venue-ownership to actual attribution is a
real decision and has NOT been made.


---

**D140 — AN ADMIN IS A SUPERSET OF A CONTRACTOR, AND `auth_contractor_id()`
THEREFORE DOES NOT TEST THE ROLE.**
✅ operator ruling, 27 Aug 2026.

*"As an admin though we should still be able to see our venues too the same way
contractors can. Basically an admin should do everything a contractor can plus
what it already could."* And, correcting an earlier misunderstanding of the
question: **Phil and Nicholas are both admins; Eric is the only contractor.**

Nicholas and Phil run the business AND work accounts. Keyed on
`role = 'contractor'`, `auth_contractor_id()` returned NULL for them — so "My
accounts" defaulted to a colleague and "My pay" was blank for the two people who
own the company. It now reads the caller's own `contractor_id` **whatever their
role**, and a `staff` profile may carry one, meaning *"this login is also this
person in the field"*.

**It grants nothing.** Staff already read every row of `contractor_pay` and
`rate_card`, so scoping a view to their own `contractor_id` shows them strictly
LESS than they can already see. For a contractor it is unchanged and still the
whole of the boundary. A new CHECK keeps a **brand user** from ever carrying a
`contractor_id`, which is the one direction where relaxing the role test would
have mattered.

**"Mine" is about the PERSON, not the role** — every ownership test on
`venue.html` keys on `contractor_id`, so an admin who owns an account sees it as
theirs.


---

**D141 — A USERS PAGE THAT CAN CREATE BUT NOT RE-SCOPE IS HALF FINISHED. THE
SAME SHAPE AS D136.**
✅ 27 Aug 2026, found by getting it wrong within the hour.

The Users page shipped with create, deactivate and delete. Then the operator
corrected who should be an admin, and the only route to fixing a role picked
wrongly was **delete the account and make another** — destroying the auth user,
its id and its sign-in history to correct a dropdown. That is exactly D136's
finding about contractor pay, arrived at again from the other end.

**Unlike a pay rise, a role is not effective-dated and has no history to
restate.** It is a statement about what this person may read RIGHT NOW, so
editing in place is the right shape here and the only correct one. `set_role()`
REPLACES the mapping rather than merging it: a login moving from contractor to
staff keeps neither a stale `contractor_id` nor a `brand_id`, because a stale one
reads as a real answer long after it stopped being true.

**The implementation lives in `create_portal_user.py` and the page is a second
caller** — the `promote.py` arrangement (D64). Two copies of "how an account is
made" drift, and the copy that drifts is the one nobody runs often enough to
notice.

**Deactivating is the one to reach for, not deleting.** `is_staff()`,
`is_contractor()` and `auth_brand_id()` all test `is_active`, so a deactivated
profile reads as no role at all and sees nothing — while the row, its mapping and
its name survive for whoever asks in six months why the account existed. Same
instinct as `contractors.is_active` and D119's `quantity = 0`: keep the record,
remove the effect.


---

**D142 — THE ENUM VALUE HAD TO BE APPLIED IN ITS OWN TRANSACTION, AND THE SCHEMA
FILE COULD NOT DO IT ALONE.**
⚠️ found 27 Aug 2026, before it bit.

Two separate traps, and they compound.

**First, D91's rule in its enum form.** The `do $$ create type profile_role_enum
... exception when duplicate_object then null` block only covers a FRESH
database. On an existing one it raises and does nothing — so a value added to
that list **never reaches Supabase**, passes every local test, and the failure is
silent in the D120 way.

**Second, Postgres refuses to USE a new enum value in the transaction that ADDED
it** — *"unsafe use of new value of enum type"*. `apply_schema.py` sends the
whole file as ONE implicit transaction, so an `alter type ... add value` and the
CHECK constraint on `profiles` that reads the literal would have landed together
and the constraint would have failed — on a database that does not have the value
yet, and never again afterwards. The worst kind of intermittent.

`schema.sql` now marks its `add value` statements between two markers;
`apply_schema.py` extracts them, runs and COMMITS them first, **strips them**,
and applies the remainder whole. Stripped rather than left to run twice: `add
value if not exists` is a no-op the second time, but a no-op inside the very
transaction that also uses the value is not worth relying on.

**A related one, same session:** `auth_contractor_id()` was first defined beside
`is_staff()` and the schema failed to apply — a SQL function body is validated at
CREATE time, and it reads `profiles.contractor_id`, which the ALTER adds 2,000
lines further down. It lives in SECTION 11 now, after the column exists.

---

**D143 — NO CONTRACTOR NAME IS COMPILED INTO THE BACKFILL. THE OPERATOR ASKED
WHETHER THE PAGES HAD BEEN MADE TO PASS, AND THE AUDIT FOUND ONE.**
✅ 27 Aug 2026, asked for and found.

*"I want to ensure nothing that should be a variable is hardcoded... I just want
to ensure we are not creating false fixes and passing them as fixes."* A fair
challenge, and it found something.

`backfill_activity_contractor.py` carried
`SEED_CONTRACTORS_INACTIVE = ["Alan Merrick"]` — a business fact compiled into a
script, which is precisely what D60 forbids: a rule the operator cannot reach. It
would not have survived contact with reality either. The second time a new rep
appeared in HubSpot the script would have skipped them and said so in a line
nobody reads.

**An owner HubSpot knows and `contractors` does not is now REPORTED and left
alone.** Creating them is an operator ruling on the command line,
`--create-contractor "Name"` — the same shape as D97's `--assign`, where a
person answers the question rather than a threshold being lowered until the
machine guesses. **A name HubSpot has never seen is REFUSED**, in a sentence,
with the real owner list — rather than creating a contractor nothing ever
attributes to, which would look perfectly fine for ever.

The flag also had to work when there is nothing left to attribute. It did not at
first: the early "nothing to do" return skipped it, so a second run would have
silently done nothing and reported success.

**THE REST OF THE AUDIT CAME BACK CLEAN, AND WAS PROVED RATHER THAN ASSERTED.**
Every ownership read in `portal/` is `profile.contractor_id` or
`venue_grading.owner_contractor_id` from the database; the only names in the
directory are in comments. Demonstrated by reassigning a venue inside a
rolled-back transaction and watching the counts move (Nick 29→28, Eric 50→51),
and by a brand-new contractor being picked up with no code change at all.

**What the operator actually saw was D137's real bug**, since fixed: before it,
`venue.html` read "Owned by: nobody yet" on *every* venue including his own,
because `contractors` is staff-only and the PostgREST embed came back null. The
present ownership is simply what the data says — **Phil 260, Eric 50, Nick 29,
and one venue with no grading row at all.** If that split is wrong it is a data
fix, not a code one.


---

**D144 — A USER CAN RESET THEIR OWN PASSWORD, AND `reset.html` IS THE ONE PAGE
THAT MUST NOT CALL `requireAuth()`.**
✅ 27 Aug 2026.

Operator: *"if Eric wants to reset the password and I not know it how can he do
it?"* — he could not. There was no reset path at all, and the only recovery was
deleting the account and making another.

`reset.html` is reached from a recovery link **without a session**. Calling
`requireAuth()` there would bounce the person straight back to the login page
they cannot get past, which is the whole reason they are there. **It is therefore
also NOT in `login.html`'s `ALLOWED` list, and that is correct** — `ALLOWED` is
the set of places a SUCCESSFUL sign-in may land, and this is not one of them.
Adding it there is the obvious instinct and the wrong one.

**THIS DOES NOT WEAKEN D61.** Password changes go through GoTrue
(`/auth/v1/…`), not PostgREST. They touch only the caller's own auth record and
add no write grant on any table in `public`. "The portal can now write" sounds
like it should be a problem and is not.

**The reply is identical whether or not the account exists**, for the same
reason the sign-in error is deliberately generic: distinguishing them turns the
box into a way to test which client email addresses are real.

**THE PAGE HANDLES BOTH SHAPES OF LINK SUPABASE CAN SEND**, and which arrives
depends on the email template rather than on anything in the code.
`{{ .ConfirmationURL }}` — the default — lands with tokens in the URL hash and
supabase-js consumes them; a template edited to use `{{ .TokenHash }}` lands with
`?token_hash=` and the app must exchange it itself. Handling only the first works
until somebody edits the template in the dashboard, and then a perfectly good
link reads "expired".

⚠️ **AND IT IS PROVEN BROKEN ON CONFIG RIGHT NOW.** Asking Supabase for a
recovery link redirecting to the portal comes back pointing at
**`http://localhost:3000`** — the requested redirect is silently overridden by
the project's **Site URL**, still the default. Until the Site URL is
`https://ihospitality.vip` and the reset page is in the **Redirect URLs**
allow-list, a reset link sends people nowhere. The built-in mailer is also
rate-limited per address (`over_email_send_rate_limit` on a second request inside
a minute), so real use needs custom SMTP. **None of that is code, and the happy
path could not be verified end to end because of it.**


---

**D145 — GOOGLE SIGN-IN, AND THE BUTTON ASKS WHETHER IT IS ENABLED RATHER THAN
ASSUMING.**
✅ 27 Aug 2026. Operator: *"ideally I would like to build it where we can just
log in with our ihospitality email... but we would need password options for
brands."*

Google for iHospitality addresses, password for brands, and both work on the
same account.

**THE BUTTON IS NOT SHOWN UNLESS THE PROVIDER IS ACTUALLY ENABLED.** GoTrue
publishes that at `/auth/v1/settings`, readable with the publishable key, so the
page asks rather than carrying a provider list of its own (D60). Enable Google in
the dashboard and the button appears by itself; a dead button that errors on
click never exists. Verified both ways in a browser — hidden while `google` is
false, rendering correctly when the settings response says true.

**ACCOUNTS ARE STILL MADE ONCE, IN THE ADMIN**, with a role and a mapping.
Signing in with Google **attaches** that identity to the existing account with
the same address, because Google's emails are verified. So nothing about the
Users page changes and **no invite table is needed** — the alternative design,
considered and rejected as disproportionate for three people and a handful of
brands. It becomes the right answer if accounts ever outgrow being made by hand.

⚠️ **WHAT STOPS A STRANGER IS NOT THIS PAGE.** Accounts are pre-created and
signups are disabled at the project level, so a Google account nobody created is
refused by GoTrue and never becomes a row. **`hd` only narrows Google's own
account chooser** to the workspace — it is a hint to Google, not a control, and
must never be relied on as one.

⚠️ **`disable_signup` WAS FALSE**, found while checking this. The publishable key
ships in `portal.js` by design, so the API would accept a signup from anyone
holding it. The damage is bounded — an auth user with no `profiles` row reads as
no role and sees nothing, the D120 safe direction — but it fills `auth.users`
with strangers, and the Users page flags them as orphans. Turning it off is a
dashboard setting and there is no Management API token in `.env`, so it is the
operator's to do.

---

**D146 — THE USERS TABLE IS THE EDIT SURFACE, AND ROLE AND MAPPING ARE ONE
COLUMN.**
✅ 27 Aug 2026. Operator: *"if I wanted to add phil's last name or such right
now I cant — ideally if we can just make that table editable that would be
great."*

Name, scope and active are edited in the grid and saved together. The standalone
"change what a login can see" block and the separate Deactivate button are gone:
**two controls doing one job is how they drift apart.**

**ROLE AND MAPPING ARE A SINGLE COLUMN**, whose options are every combination
that is actually legal — "Admin", "Admin, and works accounts as X",
"Contractor — X", "Brand — Y". Two columns would let "brand user / Eric
Anderson" be saved and the database would refuse it with a constraint violation
at the very end of the run. Same instinct as the CHECK constraints on
`profiles`: **make the invalid state unrepresentable** rather than validating it
afterwards.

`set_role()` is an UPSERT, so it also **repairs a login with no profile row** —
the most confusing state an account can be in, where the person signs in
successfully and sees a perfectly rendered portal with nothing in it (D120). An
UPDATE hitting zero rows would have refused to fix the one case that most needs
fixing.

⚠️ **A BUG THE BROWSER FOUND, AND IT MISREPORTED A WORKING ACCOUNT AS BROKEN.**
The options were filtered to `is_active`. **Seven of the twelve brands are
inactive**, Blue Run among them, so `test-bluerun@example.com` — a perfectly
good brand login — had no option to display as and fell through to "not set up
yet". The rule now: **an existing mapping is a FACT and must always be
displayable** (inactive ones are shown and marked); **a new mapping is a CHOICE**,
so the Add form still offers only live ones.

⚠️ **EDITING `create_portal_user.py` NEEDS STREAMLIT RESTARTED.** It sits above
the app directory, outside the tree Streamlit watches, so a reload keeps the old
module and the page dies with a stale-cache ImportError. The instance found
running had been up since **24 Aug**.


---

**D147 — THE PUBLIC SITE GETS A LOG IN LINK, AND IT IS DELIBERATELY QUIETER THAN
THE CTA.**
✅ 27 Aug 2026. There was no way to reach the portal from the website at all —
you had to know the URL.

Top right on desktop, bottom of the drawer on mobile, on `index.html` and
`gallery.html`.

**"Partner With Us" is what this site is for** and stays the loudest thing in
the bar. A second gold button beside it would split the eye between winning a
client and serving one. So Log In is muted until hovered, with a hairline
separating it — a different *kind* of action, not a lesser version of the same
one. In the mobile drawer it is gold, because there is no competing CTA there to
lose it against.

**Repeated in the drawer on purpose:** `.nav-links` is `display:none` below
900px, so a link only in the desktop bar disappears exactly where a contractor
standing in a bar would look for it.

It touches `css/site.css`, which is **shared with the portal** (D121). Both new
classes exist only in the public nav, and the portal reports
`controlledBySW: false` with its worker scoped to `/portal/` — so neither the
CSS nor the service worker can cross over.


---

**D148 — THE PORTAL IS INSTALLABLE, AND `beforeinstallprompt` MUST BE CAUGHT AT
MODULE SCOPE.**
✅ 27 Aug 2026.

**The event fires ONCE, and EARLY** — before a page waiting on its data has
finished rendering. A listener registered inside `renderShell()` would miss it
on a slow connection and the button would never appear, **on a portal that was
perfectly installable**. It is captured at module scope in the shared client and
the button asks for it later.

**iOS fires nothing at all**: Safari has no install API, only Share → Add to
Home Screen. So on iOS the button shows **instructions** rather than hiding,
which would leave the people most likely to want this — reps on iPhones — with
no idea it was possible.

**`_headers` was needed too, and the manifest fault is the instructive one.**
Netlify has no mapping for `.webmanifest`, so it served
`application/octet-stream`. Chrome is forgiving and installed the portal anyway
— **which is exactly why it was worth fixing**: it worked, so nothing
complained, and the first stricter browser or audit tool would have rejected it
with no obvious cause. The file also stops `sw.js` being cached (a stale worker
is the one thing shipping a new version cannot fix, because the old worker keeps
serving the old shell) and adds `X-Robots-Tag` to `/portal/*` — the pages
already say `noindex` in markup, but a crawler that never renders the HTML reads
the header.


---

**D149 — `hd` LOCKED OUT THE BRANDS. A COMMENT THAT WAS RIGHT ABOUT SECURITY AND
WRONG ABOUT BEHAVIOUR.**
⚠️ shipped and fixed the same day, 27 Aug 2026.

`signInWithOAuth` passed `hd: 'ihospitality.vip'`, which **locks Google's account
chooser to that workspace** — so a brand on Google Workspace could not sign in
at all. Brands are most of who that button is for.

**The comment beside it is the actual lesson.** It called `hd` *"a hint to
Google, not a control"*. That is true of its **security** value and quite wrong
about its **behaviour** — and the wrong half is the half that mattered. It
really does force the domain in the browser flow. A caveat that is accurate
about one axis and silent about another reads as reassurance on both.

**Domain was never that page's job.** Pre-created accounts plus disabled signups
already decide who gets in, and they do it for password logins too — so removing
`hd` lost no protection.

**The consent screen is EXTERNAL, not Internal**, for the same reason. Internal
restricts to the Workspace and would have shut brands out permanently. External
is safe here because signups are closed: a Google account nobody created is
refused by GoTrue and never becomes a row. **Verified by the operator** — his
personal Gmail was refused, and Eric's contractor login worked.

Only non-sensitive scopes (`email`, `profile`, `openid`), so there is no Google
review — but the app must be **published to Production**, or External sits in
Testing and rejects anyone not on a manual list.


---

**D150 — TWO REPORTS FROM A PHONE, AND THE ANSWER TO BOTH WAS A STALE CACHE.**
⚠️ 27 Aug 2026, and worth reading before chasing the next one.

The operator reported, from his phone: the rail could not be scrolled to reach
Sign out and Install app, and the icon showed the old round mark rather than the
new blue square.

**The first was a real bug and the fix was real.** `height: 100vh` on the rail:
`vh` is the LARGE viewport — the height the page would have if the address bar
were hidden — so with the bar showing, the bottom of the rail sat below the
fold. Retracting the bar by scrolling was what brought it back, which is exactly
what he described. `100dvh` tracks the visible area and fixed it.

Two things had to change with it, and the second is the one that looks fine and
is not. `.side-scroll` needed **`min-height: 0`**: a flex item defaults to
`min-height: auto` and refuses to shrink below its content, so the links pushed
the footer off the bottom instead of scrolling — *whatever height the rail had*.
Fixing only the unit would have left the bug on any short screen. And
`.side-foot` is `flex-shrink: 0`, because it holds Sign out.

**But he was still seeing it after the fix shipped, and it was his phone being
behind.** A second attempt was written — `top: 0; bottom: 0`, which needs no
viewport unit at all — and then **dropped**, because `100dvh` had reached his
phone by then and worked. Changing a live site again for a problem that had gone
would have been churn.

**The icon was never broken.** Android masks every home-screen icon to the
launcher's shape, so a blue square arrives as a blue squircle. The operator's
brief settled it: *"I am ok with rounded corners if it defaults to that, I just
want it to be a solid base color with iH thats it."* A hard-edged square cannot
survive an Android home screen and there is no point fighting it.

**One real icon fault remained**, in the install dialog rather than on the home
screen: offering `any` and `maskable` as **separate entries** let Chrome pick the
`any` one and give it the legacy treatment — shrunk onto a white square. One
artwork declared `"any maskable"` fixes it, and a solid colour field with centred
letters is the one design that needs no separate versions. Measured rather than
guessed: the furthest white pixel sits **164px from centre against a maskable
safe radius of 205px**.

⚠️ **THE STANDING LESSON: BEFORE DEBUGGING A PHONE REPORT, CONFIRM THE PHONE HAS
THE DEPLOY.** Two reports, two rounds of investigation, and one of them was
entirely a cache. The portal is a PWA with a service worker, so it caches the
shell by design — which makes this failure mode permanent, not incidental.


---

**D151 — TOOLING THAT REPORTS ITS OWN BUG AS SOMEONE ELSE'S FAULT.**
⚠️ 27 Aug 2026. Happened twice in one afternoon, so it is a class rather than an
incident.

`check_auth_settings.py` reported *"a reset link lands on
https://ihospitality.vip"* and told the operator to fix his Redirect URLs. **The
Redirect URLs were already correct.** He changed Supabase settings twice chasing
a fault that was entirely in the checker: `redirect_to` goes at the **top level**
of an `admin/generate_link` body, and nested under `options` it is **silently
ignored** — so the link came back pointing at the Site URL, which is
indistinguishable from a target that is not allow-listed.

The same file also probed with an address that does not exist, got a 404, and
blamed rate limiting; and read the action link only from `properties` when this
GoTrue returns it at the top level, so a perfectly good 200 reported "could not
read a link back".

**What separates a real finding from this**: check the thing the APPLICATION
actually calls, not a convenient admin equivalent. `/auth/v1/recover` — the
endpoint `resetPasswordForEmail` uses, with the publishable key — returns 200,
and a disallowed redirect there is a 400. One call would have settled it at the
start.

A checker that cannot be wrong is worth more than a checker that is usually
right, because the operator cannot tell the difference from the output.

---

**D152 — WHO TO ASK FOR AT A VENUE. INTERNAL ONLY, AND KEYED ON THE HUBSPOT ID
BECAUSE THE NAMES COLLIDE.**
✅ 27 Aug 2026. 344 contacts, 355 venue links, 914 notes, 273 venue blurbs.

Operator: *"Some of the venues have contacts attached along with notes about
when best to reach them... I want us to be wary since it's a lot of first names
there might be two of the same names for two different accounts."*

**HE WAS RIGHT, AND IT WAS MEASURED BEFORE ANYTHING WAS BUILT.** 234 of 344
contacts have only a FIRST name, and **32 of those first names repeat** — there
are four separate people called **Dan**, at Clermont Brewing, Christner's,
Tuffy's and Permanent Vacation. Matching on the name would have merged four
people into one and put one person's job title on three premises that never
employed them. Every contact is keyed on `hubspot_contact_id`. Same rule as
D129 for venues, arrived at from the other direction — by the operator, before
the code existed.

**THE LINK IS MANY-TO-MANY**, also measured: 10 contacts are attached to more
than one venue and one is on three. A foreign key on the contact would have
silently dropped the rest.

⚠️ **NONE OF IT IS A COLUMN ON `venues`** — D88's rule, and the whole reason
these are separate tables. `venues_select` lets a BRAND read any venue row it
relates to and the grant is table-wide, so a `contact_name` column there would
be a contact list a brand could `select *`. Do not move it, however convenient
a join looks.

**The notes live on the COMPANY, not the contact**, and that was checked rather
than assumed: 968 hang off venues and **5** off contacts across 300 sampled. So
there is one place to look, not two. Their HTML is stripped on the way IN, so
nothing downstream has to decide whether to trust it.

**WHAT HUBSPOT DOES NOT HAVE, so nothing was built expecting it:** street
address **0%** of 330 venues, zip 12%, company phone **0%**. Contact email
(**7%**) and phone (**9%**) are pulled and are mostly empty — `v_venue_contact`
carries a `reachable_remotely` flag that is usually false, which is the honest
answer rather than a gap to chase. What you reliably get is a **first name and
a job title** — "ask for Brittany, GM" — on 88% of venues.

**And the timing notes are real but rare.** The operator asked about "when best
to reach them"; the notes are short (median 61 characters) and only **5%**
mention timing — *"Off on Tues/Sunday"*, *"AM session at Tampa GSM"*. A feature
built specifically around that would render blank most of the time; surfacing
the notes generally carries those along with everything else.

Verified by impersonation with the control (D125/D114): a contractor reads all
344 contacts, 914 note bodies and 343 names; **a brand user reads ZERO** from
every table and from the view.

---

**D153 — A CONTRACTOR CAN OPEN AN ACTIVITY. TWO POLICIES HAD TO AGREE AND ONLY
ONE HAD BEEN MOVED.**
⚠️ found by the operator, 27 Aug 2026: *"Eric cannot click the individual
activity and see the details and photos for his stuff."*

`activity-detail.html` was in `STAFF_ONLY_PAGES` because it shows charge, cost
and margin — so **the whole page was blocked to protect three numbers on it**.
It now shows the DETAIL to anyone internal and the MONEY only to staff, which is
the split every other page already uses.

**THE MONEY PANEL IS GATED ON `staff`, NOT ON WHETHER THE COLUMNS ARRIVED.** It
tested `m.charge != null || m.cost != null || m.unpriced`, which was correct
while only brands and staff existed. A contractor breaks it: `unpriced` means
"no rate-card line matched", `rate_card` is invisible to them, so the join
misses and **the flag reads TRUE on every activity**. They would have been shown
a panel of warnings about work that is priced perfectly well. The warnings block
returns early for the same reason. *A null column is not the same question as
who is asking.*

⚠️ **AND THE PHOTOS RENDERED EMPTY RATHER THAN ERRORING.** `photos_select` was
moved to `is_internal()` with everything else in D137. `photos_storage_select`
on `storage.objects` — the policy that decides whether a signed URL can be
issued — was left on `is_staff()`. So a contractor could read the photo ROWS and
not sign the FILES: `createSignedUrls` returned nothing usable, `usable` was
empty, and the grid drew zero tiles with no error anywhere.

**IF A PAGE READS ROWS FROM ONE PLACE AND BYTES FROM ANOTHER, BOTH HAVE TO KNOW
ABOUT THE ROLE.** The photos are the only thing in this portal split that way,
and the split is invisible from the page — which is exactly why it survived the
D137 sweep and the impersonation probe, both of which counted rows.

Verified as a contractor rather than as staff: two photos load, the internal
note and "Done by" render, "You earned" shows, and no money panel appears.


---

**D154 — A GUARD ADDED TO PROTECT ONE ROLE CAN ONLY BE TESTED BY THE ROLE IT
DOES NOT PROTECT. D153'S OWN GUARD BROKE THE PAGE FOR ADMINS ONLY.**
⚠️ found by the operator on a phone, 28 Aug 2026, 1:47 am: *"When I click on the
activities I don't see the details. Before I could see the details and any pics
attached."* Fixed the same night; **not yet verified in a browser.**

`flags()` reads `staff`. `staff` is declared `const` inside the `else` block
that renders the row; the function is declared OUTSIDE that block. **`staff` is
therefore not on its scope chain**, and the call threw
`ReferenceError: staff is not defined`.

**IT THREW WHILE BUILDING `moneyPanel`, WHICH IS COMPUTED BEFORE
`el.innerHTML`** — so the entire body was lost and `drawPhotos()` never ran. The
heading, breadcrumb, venue name and date are set earlier, which is why the
screenshot showed a page that looked half-finished rather than broken: title,
`Jun 26, 2026 · Aspen Green Fresh Market Incentive`, then nothing at all above
the footer.

**THE LINE THAT THREW WAS THE ONE PROTECTING CONTRACTORS.** `if (!staff) return
out;` was added in D153 so a contractor is not shown rate-card warnings they
cannot verify (`unpriced` reads TRUE for them because `rate_card` is invisible).
That guard is correct and stays. It was simply written where **only staff ever
execute it** — `flags(m)` is called from inside the `moneyPanel` template, and
D153 had just changed `hasMoney` to `staff && (…)`, so a brand or a contractor
never evaluates the call at all.

**The operator's own first theory was the right instinct, inverted.** He asked
whether "I don't want contractors to see other people's details" had been
applied to everything. Nothing leaked: RLS was never involved, every row arrived,
and Eric's page was fine throughout. The contractor protection did not spread to
everyone — **it landed in the one branch it was not meant for.**

**AND THIS IS WHY D153 DID NOT CATCH IT.** Its commit message says, correctly and
as a virtue, *"Verified as a contractor rather than as staff."* That is exactly
the branch that skips this line. **A guard that says "not you" can never be
exercised by the role it excludes** — the only way to test it is to be the role
it lets through, which is the role nobody thinks to re-check because the feature
was not for them. D79 already says open every page; this sharpens it:
**open it as the role the change was NOT about.**

Fixed by making `staff` a parameter — `flags(m, staff)` — with the trap written
beside it. The early exit now returns `''` rather than `out`; every other exit
from the function returns a string, and the array only ever worked because
`${[]}` interpolates to empty.

**Proved, and the limits of the proof stated.** The failure reproduces in node
before the change and does not after; both touched page modules pass
`node --check`; and a scan of every portal page finds no other function
declaration reading `staff` from outside its block — `activity-detail.html` was
the only one, and `venue.html` declares its `staff` at the top of the auth block
where it belongs. ⚠️ **Rendering is NOT proved.** That needs the page opened as
an ADMIN on the deploy preview, and no login was created to do it (D125). Until
someone clicks one activity as themselves, this is a fix that type-checks.

**A stale service worker would have served the OLD file, which worked.** The page
being broken is itself proof the phone had the deploy — D150 read backwards, and
worth remembering as the one case where the cache exonerates rather than
accuses.


---

**D155 — MY PAY'S BASE IS A SENTENCE, THE RANGE OPENS ON YEAR TO DATE, AND THE
TWO MONTH BOXES SAY WHICH IS WHICH.**
Three operator asks, 28 Aug 2026, all on the same sitting.

**A TABLE THAT SAYS ONE THING FIFTEEN TIMES IS NOT A TABLE.** `v_my_pay` returns
one row per month, so My pay rendered fifteen identical rows — `$375.00`,
`semimonthly`, `$812.50` — because **the base does not vary by month.** It varies
only when it CHANGES, and a change is a new row with a later `effective_from`
(D136), never an edit. So the only fact the table carried that a sentence cannot
is a RISE, and the sentence names a rise when there is one. It sits under the
stat cards now.

**Dropping the table is not a licence to drop D130's sentence.** "Monthly
equivalent is an annualised spread, not a payment" is what stops the figure
reading as a bank balance, and it survives in full.

**AND WHERE A RISE FALLS INSIDE THE RANGE, THE LINE SAYS WHICH MONTHS EACH RATE
COVERS — NEVER WHEN IT STARTED.** The view is filtered to the chosen range, so
the earliest month present is the earliest month ON SCREEN, which is not the
`effective_from` unless the range happens to reach back that far. *"from June"*
would be a claim about the raise; *"for June – December"* is only a claim about
this table. The first would be wrong roughly whenever anyone narrows the range.

**THE EARNED ROWS OPEN THE ACTIVITY**, the same `onRowClick` the venue page and
the activity log already use. Anyone internal can open an activity (D153) and the
detail page decides for itself what to show — photos and the internal note to
anyone internal, the money to staff only — so there was nothing here to redirect
a contractor away from. Guarded on the id, because a row with none would land on
"Not found", which reads as a broken link rather than as a row with nowhere to go.

**YEAR TO DATE, NOT A ROLLING TWELVE MONTHS** (`monthRange()`, so all four pages
that carry the range: brand, brands, business, my-pay). A trailing year straddles
two of them and answers neither *"how is this year going"* nor *"how did last
year end"* — and the first is the question a page is usually opened with. This
supersedes the opening range D131 left in place.

⚠️ **THE YEAR COMES FROM THE NEWEST MONTH ON RECORD, NEVER FROM `new Date()`.**
The data lags the calendar — a month is not complete until it is over and the
invoices land later still — so anchoring on today's date would open **every
January on an empty range**, on a portal with plenty in it, and the failure would
arrive on a date rather than on a deploy. It also keeps the business fact (which
months exist) in the query rather than compiled into the page, which is D60.

**THE MONTH SELECTS WERE THE ONLY FILTER THAT DID NOT NAME ITSELF.** Every other
control in `.filters` carries its own noun — "All brands", "All markets", "Search
accounts…" — but a month select reads "January", and two side by side do not
announce themselves as a range. They are "Start date" and "End date" now.

**The `aria-label` came OFF rather than being left in place.** Three of these
selects carried `aria-label="From month"`, which overrides the accessible name —
so a screen reader would have said "From month" while the screen said "Start
date". A visible label and an aria-label saying different things is the one thing
a label must never do. The styling is in `portal.css`, never `site.css` (D121),
and reuses `.fld label`'s size so the portal keeps one field-label style.

**Proved without spending a deploy**, which was the constraint — Netlify build
credits are finite and the operator asked for no new preview until everything was
in. The real `monthRange` was run in node over seven month lists, including a
newest-month-is-January edge that correctly opens Jan–Jan rather than empty; the
page module was run across five cases (admin with a contractor mapping,
contractor, admin with none, a rise in range, no base pay); every one of Eric's
147 rows and all 80 of Nick's were checked to resolve in `v_brand_activity_log`
by impersonation with `is_superuser = off` (D125), so no row is a dead link, and
the two counts DIFFER, which is the control (D114). ⚠️ **Rendering is still not
proved** — that needs the page opened, and D154 is why that sentence keeps
appearing.


---

**D156 — THE INTERNAL ACCOUNT LIST IS ONE ROW PER VENUE, NOT ONE PER BRAND, AND
ITS STATUS IS THE FURTHEST ANY BRAND HAS REACHED.**
⚠️ Reported by the operator, 28 Aug 2026: *"it says dormant since August of last
year but we have had activities there since then… the dormant was with Dame Mas.
So it seems like the brands is the initial filter then the venue. I want it the
opposite."* He is right, and the fix is a display grain, not a data change.

`v_venue_performance` joins activities on **`brand_id` AND `venue_id`**, so every
figure on a row — activities, units, last visit, days quiet — is that brand's
slice of that venue. **For a brand that is exactly right**: their row IS their
relationship with that bar, and it must stay that way. Read internally it is
wrong twice over.

**BIG C LIQUORS APPEARS FIVE TIMES, AND FOUR OF THEM SAY DORMANT** — Aspen Green
198 days, 44 North 226, Blue Run 255, Dame Mas 375 — while somebody was standing
in that bar **121 days ago** for iHospitality. Across the estate: **693 rows for
340 venues**, 142 venues listed more than once (Levee Liquors nine times), and
**125 rows reading dormant for a venue visited inside the 180 days, over 49
venues.**

**STATUS IS THE FURTHEST ALONG, NOT THE MOST RECENT** (operator ruling, offered
against the alternative). `my-venues.html` already folded to one row per venue
and took the status from the most recently visited brand — which **understated 23
venues and understated every single one of them**: Big C read `pitched` with two
brands placed in it, The Office Cigar read `pitched` while it was reordering. A
venue where we have placed product is a venue where we have placed product,
whoever we happened to see last. 19 venues change status under the new rule, all
upward, none down.

⚠️ **DORMANCY IS BORROWED FROM POSTGRES, NEVER RECOMPUTED IN JAVASCRIPT.** The
180 days lives in `account_status_effective()` and must stay in exactly one place
(D86) — a second implementation in a page is precisely how the two come to
disagree. `foldVenuesByVenue()` therefore does not know the number: it takes the
MOST RECENTLY VISITED row, whose `days_since` already IS the venue-wide one, and
asks whether Postgres called that row dormant. `lost` passes through for the same
reason it does in SQL. `status_stored` stays the furthest-along STORED value so
the counting cards still read what the trigger set (D87).

**ONE DEFINITION, TWO CALLERS** — the fold moved out of `my-venues.html` into
`portal.js`, the `promote.py` arrangement. Folding in the page rather than in a
new view is deliberate: a venue-grain view aggregating every brand would need a
`security definer` gate whose `where` clause is the entire boundary (D137), and
RLS already delivers exactly the right rows to each caller. **No schema change,
no new grant, no new way to leak one brand's activity to another.**

⚠️ **"STOCKING" NOW COUNTS VENUES, NOT RELATIONSHIPS: 220 becomes 163.** Both
numbers are true and they answer different questions. The card is on the internal
list, where "how many bars stock us" is the question being asked; a brand's copy
of the page is untouched and still counts their own relationships.

**Proved against all 693 live rows**, not a fixture: 693 folds to 340, matching
the distinct venue count exactly; activities (1,141), first-case sales (168),
reorders (63) and units (442.16) are all conserved through the fold; every one of
the 340 `last_touched` values equals the venue-wide maximum; and **zero venues
remain dormant that were visited inside 180 days**, against 125 rows before. Both
pages were then run across staff, contractor and brand — the brand user still
gets 59 unfolded rows at brand grain with "Stocking your brand", and the
contractor still has no Quiet column (D138). ⚠️ Rendering is not proved; that
needs the page opened.

---

**D157 — THE VENUE LIST WAS NOT MISSING ANYTHING SOMEBODY DELETED. IT WAS
MISSING 108 PLACES THAT HAD NEVER BEEN CREATED, BECAUSE A COMPANY ONLY BECOMES A
VENUE WHEN IT LANDS ON A DEAL.**
Asked for by the operator, 31 Aug 2026: *"I have a list of venues I would like to
upload… I think its a mess. At first there were too many duplicates and I think
when we cleaned it we took out too many."*

**The premise was wrong in the way that mattered, and checking it first is what
made the session useful.** The 22 Aug cleanup is on disk in
`Hubspot/venue_merge_backup_20260822-104820.json` (15 merges) and `…-110159.json`
(2). Seventeen rows were deleted, **not one of them carrying a single activity**,
and every one of the seventeen names still resolves to a surviving venue today.
Nothing was lost and nothing needed restoring. Zero venue names collided after
normalisation either — there were no duplicates left to find.

**THE GAP RAN THE OTHER WAY.** `apply()` in `sync_hubspot.py` and
`_resolve_venue()` in `promote.py` only ever create a venue when a HubSpot
company turns up **on a deal**. A company nobody has logged work against has
never had a row at all. So the venue list has always meant *"places we have
worked"*, while the operator was reading it as *"places we know"*. Against a
412-row company export: **298 matched, 108 absent, 6 conflicting, 38 held here
and not in HubSpot.**

**THE RECORD ID WAS WORTH ASKING FOR BEFORE BUILDING ANYTHING.** The first export
carried only `Company name` and `City`. Matching on names that carry trailing
spaces and inconsistent case is guesswork, and a venue created without a company
id is one the next sync cannot recognise — it would create a second copy the
first time the place appeared on a deal, which is the exact duplicate this work
exists to prevent. One re-export turned every match exact.

**SIX VENUES WHERE THE NAME AGREES AND THE RECORD ID DOES NOT** — Coasters Pub,
Double Tapp Grill, Hemingway's Tavern, Live! Hospitality, Morning Glory, The
District. That is HubSpot holding two company records for one place while the
portal is bound to whichever was on the deal. **The fix is an alias, not a
merge**: `venue_hubspot_alias` makes both ids resolve to the one venue, which is
what that table already exists for (D81). A name match with no id on our side is
NOT this case — a venue created in the field carries no id to disagree with, and
treating it as a conflict would put every field-created venue in a warning list
for ever.

**THE MATCHING LIVES IN `normalize.py`, NOT IN THE PAGE.** A rule inside a
Streamlit page cannot be tested without running Streamlit, and this one is the
difference between creating 108 venues and creating 108 duplicates.
`bucket_export()` and `venue_match_key()` sit in the file whose own docstring
says it exists so the messy rules are testable without Postgres, and
`test_normalize.py` holds them to these counts. `5_Venues.py` now imports
`venue_match_key` rather than keeping its own copy, so the duplicate-suggestion
tab and the comparison fold names identically.

⚠️ **AN AD-HOC SCRIPT AND THE REAL MATCHER DISAGREED BY ONE, AND THE MATCHER WAS
RIGHT.** A throwaway check matched names independently of ids and reported 37
extras; `bucket_export` reports 38. The extra one is
**`Neighbors/DOMU East End`** — an orphan with no company id and no activity,
sitting beside the real `Neighbors East End`, whose export row resolves BY ID
onto the real venue. The duplicates tab cannot see it because the two names fold
differently. It is now a test.

**THE PAGE REPORTED HUBSPOT'S OWN DUPLICATES AND THEN CREATED THEM ANYWAY** —
found by running it, not by reading it. `Malabar Liquors` appears twice in the
export in one city, and `Maggie McFly` twice in two different cities; creating
all four made two duplicate pairs the duplicates tab immediately asked somebody
to merge, a fault the page had manufactured one section after warning about it.
Companies duplicated inside the export are now **held back from the create
grid** and listed for fixing at source. Nothing here can tell one place entered
twice from two premises sharing a name, and that is exactly why it stops (D81).

**LIFECYCLE IS A THIRD AXIS AND MUST NEVER BE CONFUSED WITH THE ACCOUNT STATUS**
(D86/D87). `venue_grading.lifecycle` is `null` (active), `prospect` (known, never
worked) or `retired` (worked, no longer called on). `brand_venue_status` is per
BRAND and advance-only; `dormant` is 180 days quiet, derived at read time in
`account_status_effective()` and deliberately never stored. Lifecycle is per
VENUE, is a person's decision, and says nothing about recency. It lives on
`venue_grading` because a column on `venues` is a column a brand can
`select *` (D88), and it is `text` with a CHECK rather than an enum so it needs
none of D142's marker dance.

**20 FRESH MARKET STORES ARE `retired`, AND THE HISTORY STAYS.** Operator: *"so
freshmarket and win dixies are only for Aspen green but we are moving away from
that. So It would be nice to have that data but also they will not be called on
again anytime soon."* Every one of the twenty is Aspen Green and nothing else.
**One row per store, not folded into a chain** — each is a separate premises with
its own buyer, and folding twenty histories into one is D129's trap.

**SIX ROWS WERE NEVER VENUES**: 44° North Vodka, Dame Mas Tequila, Tequila Dame
Más, Breakthru Beverage, Mexcor International, Southern Glazer. Operator ruling:
keep the work, drop the venue. **`activities.venue_id` is `ON DELETE RESTRICT`,
so the order is forced** — 17 activities freed first, then the rows deleted;
money asserted identical before each commit and unchanged to the cent
($37,963.93 / $24,370.90 / 1,238). ⚠️ Two of the seventeen are the Breakthru
`Day Buy-Out` pair of 2025-09-06, which is billed work at a real address — the
"Day Buy Out Split" `lib.canary()` cites — and is worth a second look.

**Verified by running it, not by reasoning about it**: 298/6/108/38 on screen
matching the headless run, 108 created carrying their Record IDs, and the two
mutations of the matcher each caught by exactly the test written for them.

---

**D158 — AN IMPORT MUST NEVER ERASE A VENUE. "NO COMPANY ON THE DEAL" MEANS "NO
INFORMATION", NEVER "THIS HAPPENED NOWHERE".**
Found by running the new Pull button against live HubSpot and comparing row
counts before and after — **not by any test, and not by anything on screen.**

Somebody deleted the `Secrets Resort` company in HubSpot. The three deals
attached to it lost their company association, `staging.hubspot_deals` recorded
`venue_name` and `venue_company_id` as NULL, those rows became state `auto` (a
change HubSpot made to a row nobody had hand-edited), and `promote()` carried it
through as a bare `venue_id = %s`. **Three real activities that had a venue
silently stopped having one**, on a run whose output was nothing but success.
`activities` count unchanged, money unchanged, no error anywhere — only
`count(*) where venue_id is null` going 114 → 117 showed it.

**THE PORTAL IS THE SOURCE OF RECORD AND HUBSPOT IS AN INPUT** (D84), so an
association a person established has to survive the CRM forgetting it. The same
rule already governs the city one function away: `set_venue_city_from_hubspot()`
refuses to blank a city HubSpot has stopped sending, and `apply()`'s own comment
says *"coalesce keeps a city already on the row when HubSpot has none, so a value
entered by hand is never blanked by an empty CRM field."* The venue had no such
protection. It does now, in both of `promote()`'s branches.

**Clearing a venue is a human action, taken in the admin.** The sync can set one
and can change one; it can no longer remove one.

⚠️ **THIS IS NOT NEW AND IT IS NOT MINE.** The same line has been in `promote()`
since D64, so any earlier `--apply` run hit it too — 52 staged deals currently
carry no venue name, and **not one of them is attached to an activity that still
has a venue**, which is consistent with this having quietly happened before.
Worth a look at the 114 venue-less activities before assuming they were always
that way.

**PROVED BY REPETITION, WHICH IS THE ONLY PROOF THAT COUNTS HERE.** The three
were restored, then the *identical* sync that had destroyed them was run again:
all three survived, 114 stayed 114, money unchanged. And
`test_admin_sql.py::test_promote_never_blanks_an_existing_venue` fails on the
real pre-fix text of `promote.py` and passes on the fixed one — a checker that
cannot fail proves nothing (D114).

**WHAT THIS SAYS ABOUT THE BUTTON.** Nothing about the fault was caused by
putting a front door on the sync; the CLI would have done exactly the same. But
the button will be pressed far more often than the CLI ever was, so a
once-a-month silent erasure becomes a weekly one. **Before-and-after row counts
are the check that found it, and they are worth running around any import.**

---

**D159 — AN ACCOUNT THAT SHUT DOWN IS `closed`, AND IT IS NOT `retired`.**
Operator ruling, 2 Sep 2026: *"I just want a way to say this account closed down.
So it doesn't keep showing up under venues but we keep a record of it."*

`venue_grading.lifecycle` now holds FOUR values: `null` (active), `prospect`
(known, never worked), `retired` (worked, we stopped calling on it) and
**`closed`** (the premises is out of business).

**THE TWO ARE NOT THE SAME FACT AND MUST NOT BE FOLDED TOGETHER.** `retired` is
OUR decision, it is reversible, and the place is still trading — the 20 Fresh
Market stores are open shops we chose to stop calling on (D157). `closed` is a
fact about the world and it does not reverse. Fold them and the "who should we
go back to?" list quietly fills with bars that no longer exist. The operator was
explicit that Fresh Market is **not** to be swept into this: it stays `retired`.

`lifecycle` is `text` with a CHECK rather than an enum, so adding a value needs
none of D142's marker dance — but D91 still applies with full force: a CHECK on
an existing table must be restated as an `ALTER`, never edited inside a
`create table if not exists`, or it will pass every test while never existing on
Supabase. The migration is in `docs/HANDOFF.md`, and it asserts BOTH directions —
that `closed` is accepted AND that a junk value is still refused — because a
check that cannot fail proves nothing (D114).

**THE WRITE SURFACE IS THE ADMIN, NOT THE PORTAL** — operator: *"We are going to
use the app to edit all the data, the online portal just reads said data."* That
is D61 restated by the person who owns the consequence, and it settles the
question for every future editing feature.

⚠️ **"DOES NOT KEEP SHOWING UP UNDER VENUES" IS TWO SURFACES, NOT ONE.** The
admin Venues page is a Streamlit filter and costs nothing. The portal's *All
accounts* and *My accounts* tabs read `v_venue_performance`, which is a VIEW
change and a website deploy. Check whether `retired` currently drops out of the
portal list before building — if it does not, Fresh Market is still showing there
and both should be handled in one pass.

---

**D160 — THE BRAND SCORECARD'S STRONGEST FIGURE COMPUTES TO $0.00, AND RATES DO
NOT TRANSFER BETWEEN BRANDS.**
Analysed 2 Sep 2026 against the real July 2026 44 North billing sheet.
⚠️ **Nothing built, nothing changed in the portal. The mockup is a mockup.**

`docs/BRAND_SCORECARD_SPEC.md` calls `uncharged_value` *"the single strongest
price justification available"* — the dollar value of no-charge work, valued at
rate card. Against July 2026 for 44 North it is **$0.00**, and the reason is
structural rather than a data fault.

July's free work was 16 account visits, 7 drink developments and one market
favor. All three are carded at **$0.00 for 44 North**, so "value it at rate card"
returns nothing. **The rate card records what a brand is CHARGED. A list price is
a different field and no such field exists** — not in the sheet, not in
`rate_card`. This is the fourth way the rate card goes quiet about real work,
beside `unpriced`, `uncosted` and charge-≤-pay (D78/D90/D98).

⚠️ **THE CROSS-BRAND SHORTCUT IS CLOSED, BY OPERATOR RULING.** The first attempt
valued 44 North's visits at **$20 using Heaven's Door's invoiced rate** (D119) on
the grounds that a real client really pays it. Operator: *"This isn't Heaven's
Door, all brands are charged differently."* So a list rate **cannot be derived
from another brand's rate card line**, and taking the maximum across brands is
the same mistake wearing a formula. Every list rate is a pricing decision the
operator makes once, in a table he can edit (D60).

**THE CHARGED HALF IS SOUND, AND THAT IS THE USEFUL HALF OF THE FINDING.**
Re-pricing all 29 July rows line by line off the sheet's own rate table returns
**$535.00**, matching the invoiced commission to the cent ($1,450.00 retainer +
$535.00 + $70.18 expenses = $2,055.18). The row data reproduces the billing. Only
the free half is unpriced.

**TWO OF THE FOUR HEADLINE METRICS CANNOT BE COMPUTED AT ALL.** *Live placements*
and *accounts retained* both need placement STATE — the day a drink list came off
at a menu reprint — and nothing records it. ⚠️ **Do not reach for
`brand_venue_status`**: it is advance-only by design (D86) and can never retreat,
so a count built on it only ever climbs. And do not substitute repeat VISITS for
retention: July shares 5 accounts with June, which would print "5 of 28" on a
client document while measuring the contractor's route rather than the brand's
health. A placements table is the one genuinely new structure in the whole plan.

**`new_doors` IS DEFINED TWICE IN THE SPEC AND THE TWO ANSWERS ARE 2 AND 18.**
The metric card says "accounts placing a first order"; the computed field says
"first ever activity row". Only Phyre Brewery & Tavern and Huck's Oyster Bar
ordered. Eighteen accounts appear for the first time in the sheet — but the sheet
starts in January, so "first ever" is **unanswerable from it**. The portal holds
activity back to June 2025 and can answer it properly. That is one more reason
the portal is the target and the sheet is the stopgap.

**TERRITORY CANNOT BE BACKFILLED THE WAY THE PLAN ASSUMES.** The implementation
plan says territory is *"derivable from the city column"*. The activity log has
**no city column** — its headers are Date, Account, Notes, Qty, Opportunity,
Images. It needs an account-to-territory lookup, which the portal already has and
the sheet does not. ⚠️ **And check whether it is two territories or three**:
Cocoa Beach, Melbourne and Kissimmee accounts are neither Orlando metro nor Palm
Beach. Note also the vocabulary is drifting three ways — the spec says
`orlando_metro`/`palm_beach`, the database enum says
`central_florida`/`palm_beach_county`, and the sheet says neither. Two markets
only; the enum enforces it.

**FOUR PERCENTAGES IN THE MARKET SUMMARY DO NOT MATCH THEIR OWN NUMBERS**, which
the spec suspected and this confirms by recomputation from the TY and LY cells
sitting beside them:

| Cell | Shown | Actual |
|---|---|---|
| Jan — accounts sold | −11% | **−25.8%** |
| Mar — off-premise cases | −64% | **−55.6%** |
| Jun — total cases | −22% | **−11.3%** |
| Jan — accounts sold, Diff | **139** | −27 (it is ADDING 56+83) |

June is the one that costs money in a negotiation: an 11 percent decline was
reported to the brand as 22 percent. **The report was making the year look twice
as bad as it was.** Every percentage must be computed, never typed.

⚠️ **D118's 291 IS UNAGREED ANALYSIS AND IT REACHED A CLIENT-FACING PAGE.** The
first mockup printed *"43 percent of your state volume"* from D118's 291-of-681
cases. D118's own first line reads **"analysed 24 Aug 2026 — nothing agreed,
nothing changed in the portal."** A figure carrying that warning either goes on
the page with the warning attached or does not go on the page. Rescoping the
market summary to serviced accounts is the operator's instruction and is right;
**the cost is the year-over-year comparison**, because 291 exists for Jan–Jul
2026 only and there is no prior-year equivalent at account level.

---

**D161 — A REORDER IS AN OUTCOME, NOT AN ACTIVITY, AND LAST YEAR'S LIVES IN LAST
YEAR'S MASTER.**

Reorders are logged in the activity master as `recurring case` at **$0.00**, one
row per account per month, so cases can be counted without touching billing. The
operator's instinct was right twice over. First: *"reorders aren't activities"* —
an earlier draft wrote a qty-0 July row for accounts nobody had visited, which
invents a visit that did not happen. Second: *"I can't be posting activities from
last year into this year's report"* — the 2026 activity report covers 2026. Last
year's cases go in the **2025 master** as `Case Sale`, and the brand file pulls
them into a `<Month> 2025` tab by IMPORTRANGE.

⚠️ **Net out cases already billed as `Case Sale` before writing reorder rows.**
The flash counts every case that shipped, billed or not. July had 3 already
logged (Phyre 2, Huck's 1); writing them again double counts. The netting must
key on the **flash customer**, not the account name — the master calls it
`Phyre Brewery & Tavern` and the portal calls it `Phyre Saloon`, and a raw string
comparison missed it.

---

**D162 — AN ACCOUNT WITH CASES IN EITHER YEAR GETS A ROW. A LAPSE IS A REAL LOSS.**

Operator: *"it is only counting the venues that ordered in july of this year but
if a venue ordered last year and didnt reorder this year thats a negative
change."* He is right and it was material. Restricting to accounts active in 2026
hid seven accounts that bought in July 2025 and nothing in July 2026, and with
them 9 cases of decline.

The rule is: **every account of ours with cases in either period is logged.** No
qty-0 rows are needed once last year lives in its own master — a lapse is simply
an account with a 2025 row and no 2026 one, and the anti-join finds it.

---

**D163 — THE ACCOUNT MAP IS RULED, NEVER DERIVED. THE CUSTOMER NUMBER IS THE ONLY
DURABLE KEY.**

106 pairs and 2 chains in `Invoicing/flash_match.py`, every one ruled by the
operator, with 17 rejected pairs kept so nothing re-adopts them. Written up in
`docs/FLASH_ACCOUNT_MATCHING.md` with a lookup copy at
`44 North/ACCOUNT_MAP_44North.csv`.

Fuzzy matching proposed **Universal Studios** (58 FYTD cases) for "University
Wine and Spirit", collapsed three Orlando bars onto one NONA SOCIAL, and offered
a panhandle wine shop for a Palm Beach one. It also **failed silently**: six
flash names are shared by several stores and a name-keyed dict kept whichever
came last, scoring our Port St Lucie Maggie McFly off the Boca Raton store.
Ambiguity now raises.

⚠️ **The number moved five times as accounts were found: +33.3% → +12.9% →
-5.4% → -7.9% → -5.1% → -7.3%.** It began as growth and ended as a decline.
Every correction needed the operator's knowledge, not better code.

---

**D164 — ONE SCORECARD TAB, DRIVEN BY A MONTH DROPDOWN, READING THE WORKBOOK
ITSELF.**

`B3` holds the month; every block follows it. This year's activity comes from
`'<MONTH>'`, last year's from `'<Month> 2025'` (`PROPER()` bridges the casing),
billing from SUMMARY's Annual Recap, and Florida from `Market Summary 2026`.
There is no FlashData tab: the flash is a source and a cross-check, not a
dependency.

⚠️ **Market Summary's month label is a DATE.** It displays as "Jul 2026" and is
`7/1/2026`. A wildcard MATCH and an exact-text MATCH both returned `#N/A` before
the operator spotted it. Match `DATEVALUE("1 "&$B$3&" 2026")` instead.

Three more traps, all found by testing rather than reading:
- Matching cases on `"*case*"` also catches **"TAP w/2 cases"**, a tap placement.
  Match `"*case sale*"` and `"recurring case"` explicitly.
- `recurring case` is carded at $0.00, so a naive "services covered by the
  retainer" count swept reorders in and read **58** instead of 23.
- Inlining the last-year total into the change formula produced `-A+B` and `/A+B`
  without brackets. It gave the right answer **only because 2025 has no
  `recurring case` rows yet**, and would have broken silently on backfill. Each
  number is now computed once in a cell and referenced.

A `QUERY` spills into the cells to its right and cannot spill into merged ones,
so it runs off-screen in a hidden column and the visible rows read from it.

---

**D165 - POSTGREST CAPS A RESPONSE AT 1,000 ROWS, AND THE CLIENT CANNOT LIFT IT.**

Four portal pages read a view unbounded and summed it in the browser, so once
the view crossed 1,000 rows they were totalling part of the data with no error
anywhere. `v_activity_money` and `v_brand_activity_log` are at 1,255, so
`business.html`, `pay.html`, `rate-card.html` and `activity.html` were each
working from **1,000 of 1,255 activities**.

Measured, not assumed. A plain select answers `Content-Range: 0-999/1255`, and
it still answers `0-999` with an explicit `limit=2000` and with a
`Range: 0-1999` header. Only `offset=1000` reaches the rest. **The cap is
server-side; a bigger limit is not a fix.**

The admin never had this because it talks to Postgres through psycopg. That is
why the two surfaces disagreed and **the portal was always the low one** - which
reads as a reconciliation gap rather than as a bug, and is how it survived.

`selectAll(build, tiebreak)` in `portal.js` pages until a short page comes back.
It takes a FACTORY because a PostgREST builder is thenable and single-use, so
the same object cannot be re-ranged. The tiebreak is REQUIRED, not optional: a
`.range()` over an unordered result is not a stable page (D122), and forgetting
the order fails silently in the same direction as the bug it fixes.

⚠️ **Three more reads are correct only because they are still small** -
`v_my_activity_pay` (773 for Phil King), and `v_venue_performance` and
`v_brand_venue_counts` (692 each). They break silently at 1,000, and the pay one
under-reports a contractor's own earnings when it does.

---

**D166 - A BILLING ROLL-UP IS NOT AN ACTIVITY, AND IS NOW FLAGGED AS ONE.**

The dashboard read **1,255** activities while the Activity page read **1,246**,
and nothing on either screen explained the gap. The nine rows between them are
Dame Mas `monthly_commission`, Jul 2025 to Mar 2026.

They are not work anybody did. They carry **no HubSpot deal id, no external ref
and no venue**, because they came off the INVOICES: those months had no
venue-level depletion, so the month's commission was booked whole and the
individual case sales in the same window are priced at $0.00 so the money is
counted once (D93/D51).

⚠️ **THE ROWS MUST STAY.** They hold ALL of Dame Mas's revenue for those nine
months, **$3,307.28** of it. Every other Dame Mas activity in that window
charges $0.00 by design, so deleting the roll-ups reads as nine months of $0.
What was wrong was only that they were COUNTED as activities.

`activity_types.is_rollup`, seeded once for `monthly_commission` inside a DO
block so a routine re-apply cannot re-flip what the operator later changes --
the same shape as `is_reorder`, and the trap `rate_card.per_unit` documents. A
FLAG rather than a code hardcoded in the views, per D60: the portal already
hardcodes that string once, in `activity.html`, and the next roll-up type should
be a checkbox on the Activity types page rather than a schema edit.

`v_monthly_summary` and `v_brand_monthly_summary` count only `where not
t.is_rollup`. **Every money view is untouched on purpose.** Verified against
live: all three counts now agree at 1,246, while total charged stays
$38,558.93, contractor cost $24,770.90 and revenue $125,033.93; `depletion_events`
and `units_moved` do not move, because a roll-up was never a depletion.

⚠️ **`venues_touched` and `brands_active` were already immune** - a roll-up has
a NULL venue and `count(distinct)` ignores NULLs, and Dame Mas has other work in
each of those months. Only `count(*)` was ever wrong.

A footnote on method: an ad-hoc check of the same numbers written as
`source_activity_type <> 'monthly commission'` came back one row short, because
one Dame Mas row has a NULL `source_activity_type` and `NULL <> 'x'` is NULL,
not true. The flag test has no such hole. **Prefer a flag to a string
comparison, and never filter on a nullable column with `<>`.**

---

**D167 — FIX IT BEFORE IT LANDS. A CORRECTION SITS BESIDE THE STAGED DEAL, NEVER
INSIDE IT, BECAUSE EDITING HUBSPOT'S ROW DESTROYS THE ZONE IT EDITS.**
Asked for by the operator, 1 Sep 2026, on being shown that the queue was
read-only: *"so I thought the idea was to have a staging and landing area. I
would want to fix it before it gets to the landing not put it in landing with
clean data before it needs fixing."*

**HE WAS READING THE DESIGN'S OWN WORDS BACK AT IT.** Section 8 of `schema.sql`
says the point is to *"separate the LANDING ZONE from the CLEAN ZONE"*, and
`promote.py`'s docstring said the opposite just as plainly: *"WHAT PROMOTION IS
NOT. It does not clean anything… Cleaning is what the operator does in the admin
grid, afterwards."* Staging was built as a faithful mirror of HubSpot with a
yes/no decision, and the cleaning step landed on the other side of the line from
where the name puts it. The gap was between the two documents, not in his head.

**THE OBVIOUS FIX IS A TRAP, AND IT IS THE WHOLE REASON THIS TABLE EXISTS.**
Making the columns of `staging.hubspot_deals` editable is the smaller change and
destroys the zone in three ways at once:

  * `content_hash` is maintained by a BEFORE INSERT OR UPDATE trigger, so an
    edit recomputes the hash **from the edit**. The row then reads `in_sync`
    with a value HubSpot never sent and the change-detection baseline is gone.
  * `apply()` upserts every typed column **unconditionally**, so the next pull
    overwrites the edit.
  * And nothing would ask. `conflict` requires `hand_edited_at`, which lives on
    the ACTIVITY; an unpromoted row has none, so it resolves to `new` again
    carrying HubSpot's values with the correction simply gone.

That is **D64's original bug re-created one table earlier**, and it would
present a month later as "my fix didn't stick", on rows nobody is looking at.

So the ruling lives in `staging.hubspot_deal_correction`, keyed on the deal,
and `promote()` lays it over with `coalesce`. HubSpot's testimony stays
byte-exact and keeps hashing to the same thing. **Same shape as
`venue_hubspot_alias` (D81)**: override an import without editing the import.

**THE VENUE IS A `venue_id`, NOT A NAME**, and getting this wrong would have
been invisible. `_resolve_venue()` prefers the HubSpot company id over the name,
so a correction supplying a NAME while HubSpot still supplied an ID would be
silently ignored — the id would win and the row would land at the venue the
correction was written to move it off. A uuid cannot be reinterpreted. It also
means a correction can only point at a venue that already exists, which is
right: creating one from a name is `_resolve_venue`'s job and guessing is D81's.

**`based_on_hash` RECORDS THE VALUE, NOT THE FACT** — the same rule as
`promoted_hash` and `rejected_hash`. A correction made about facts HubSpot has
since changed is a DISAGREEMENT, so `v_review_queue` raises it as a `conflict`
rather than letting the sync re-apply a ruling somebody made about a different
deal. `promote()` re-bases it, because promoting IS re-affirming the correction
against what is in front of you; without that, a corrected row would ask for
ever and the queue would become noise people scroll past (D64).

**ONLY FIELDS THAT ACTUALLY DIFFER become a correction.** Writing every field
would turn "I changed the type" into a ruling that also pins the date and the
quantity, and a later HubSpot fix to one of those would be overridden for ever
by a value nobody chose.

**NULL MEANS "NO CORRECTION", AND THAT HAS A COST WORTH STATING**: a correction
cannot express "set this to nothing". Clearing a venue stays a human action
taken after promotion — which is what D158 already requires of the sync.

**PROMOTE-THEN-FIX IS NOT WRONG, AND ITS REAL COST IS NOT WHAT IT LOOKS LIKE.**
The brand seeing a wrong row for a few minutes is not the problem.
`sync_brand_venue_status()` is: it fires on insert AND on `activity_type_id`
update, and **only ever advances**. Correcting upward (visit → sale) re-fires
and advances correctly; correcting **downward** hits `else
brand_venue_status.status` and leaves the account permanently `placed`, with
nothing to fix it later (D86/D113). Checked against the 41 waiting deals before
recommending anything: every correction in that batch was upward or neutral, so
nothing was at stake in the queue while the design was decided.

**⚠️ `resolve_activity_type()` IS A WRITER, AND IT LOOKS LIKE A READ.** A query
written to LIST the rate card's vocabulary called it to resolve each string and
**created nine `activity_types` rows** — it creates and flags anything
unrecognised, which is the behaviour `promote()` wants and a report never does.
Nine junk types, nine aliases, zero activities, all removed. Nine rate-card
strings price but do not classify (`well program` $175, `program (custom)` $198,
`hourly labor` $25, `disc case sale`, `case incentive`, `bottle incentive`,
`market favors`, `barrel prep pk`, `promo specialist lead`), which is why they
were resolvable at all — that is D111's shape and still open.

**ALSO FIXED, FOUND BY READING RATHER THAN BY FAILING**: `st.stop()` on an empty
grid halted the WHOLE script run, so any brand/month with nothing promoted lost
the bottle calculator AND "Add a missing activity" — which is exactly what a
person wants when a month is empty. `else:` now. **Same trap as D89**, in the
same file, four days after D89 was written down.

**PROVED IN PRODUCTION THE SAME AFTERNOON, ON THE OPERATOR'S OWN RULING.**
Wildflower Sanford arrived from HubSpot as `market favors n/c` at **$0.00**; he
ruled it **`tap maintenance`** and it landed at **$50.00**. That is the whole
feature in one row — the type was the point and the money followed — and it is
the only kind of proof that counts here, because the ten rolled-back checks
could only ever show the mechanism, never that a person could reach it. He
cleared 41 → 25 of the queue the same afternoon with it, charge $37,963.93 →
$38,558.93.

⚠️ **A CORRECTION RE-APPLIES ON EVERY PROMOTE, WHICH IS THE POINT AND ALSO THE
THING TO REMEMBER.** The Wildflower correction is still on file after promotion.
That is what stops a later re-sync quietly restoring HubSpot's `market favors
n/c` — but it also means a correction is a standing instruction, not a one-time
edit. Removing it is a button on the row.

**AND THE LESSON THAT COST THE MOST TODAY: DO NOT INFER THE OPERATOR'S RULING.**
The Wildflower deal titled *"New 44N Sangria on tap build"* was read as
`tap cocktail` from its title. The operator: *"wildflower is not a tap
placement. It was miscategorized thats what prompted this entire discussion."*
He ruled it **`tap maintenance`** — which is `is_depletion = false`, where all
three tap PLACEMENT strings are depletions and would have advanced the account
to `placed`. Servicing a tap is not product moving. A confident inference from a
deal title is exactly the guess D81 forbids the matcher from making, and the
same rule applies to whoever is holding the keyboard.

**Numbered D167, not D159.** This was written on 1 Sep 2026 and sat unpushed on a local `main` while a session that had branched from before it took D159 for the `closed` lifecycle ruling on 2 Sep, then ran on through D166. Two different decisions carried one number for five days. The work itself shipped regardless: `staging.hubspot_deal_correction` is live and holds a row, and `db/test/12_correction_test.sql` passes. Only the record was missing.

---

**D168 - THE DISTRIBUTOR'S CUSTOMER NUMBER, AND THE FLASH THE PORTAL CAN NOW READ.**

The EOM flash is the ONLY source for reorders: they reach the venue through the
distributor's rep with no iHospitality visit, so there is nothing for a
contractor to log (D118). July 2026 is the size of the gap - the portal held
**4** cases of 44 North and the flash held **38**.

`distributor`, `venue_distributor_account`, `distributor_account_rejection`.
The mapping moves out of a hardcoded dict in `Invoicing/flash_match.py`, which
is a business fact compiled into a script and what D60 forbids. 108 mappings
across 105 venues, plus the 17 rejections, seeded by
`seed_distributor_accounts.py` and idempotent.

**IT HANGS OFF THE DISTRIBUTOR, NOT THE BRAND.** The number is the account's
LIQUOR LICENCE, so one mapping serves every brand: load the Wodka flash and
every 44 North account it mentions already resolves. That is also the
cross-check nobody had before.

⚠️ **MANY-TO-MANY IN BOTH DIRECTIONS, and both are real.** One venue with
several numbers: Hampton bills on and off premise separately, Spirits2U trades
under three. One number with several venues: Aku Aku and Stardust Lounge share
a licence, one customer to the distributor and two places to us. So there is
deliberately **no unique constraint on the customer number**, and reconciliation
compares at the **match group** - a connected component of the venue/number
graph - summing BOTH sides. Comparing per venue reports one of a shared pair
short and the other over. 105 groups today, 103 of them 1:1.

`flash_report.py` parses and reconciles with no database and no Streamlit, so
it is testable without a network. The header is LOCATED rather than assumed,
every read is by RAW column index because compacting a row does not line the
columns up, and `(3)` parses as minus three. The parse is checked against the
file's own stated customer count and refuses to continue if they disagree.

⚠️ **THE MONTH CANNOT BE DERIVED FROM THE FILE.** July's flash was pulled on
8/2 and August's on 8/31, so "Date As Of" records when the report ran, not what
MTD covers. The operator picks it; the page shows both dates so the choice can
be checked rather than trusted.

Idempotency is `external_ref`, unique, shaped
`flash:<distributor>:<brand>:<month>:<customer_no>`. Re-uploading a month
updates rather than duplicating - which is also why an account already recorded
never appears in the add list, and Hurricane Alley could not be double-counted
on the first real run.

July, applied: 20 activities, 34 cases, and the portal now reads 38 against the
flash's 38.

---

**D169 - A RETURN IS A NEGATIVE DEPLETION, AND IT STAYS VISIBLE.**

August 2026 carries `HOLLERBACHS (700405764)` at **(3)**, against +3 in July.
Net zero across the two months.

`activities.quantity` is `CHECK (>= 0)`, so a return cannot be a negative
quantity. **It does not need to be.** The QUANTITY stays positive and the CASE
EQUIVALENT carries the sign: `case_return` is seeded at **-1.0**, so three
cases returned is quantity 3, and `sum(quantity * case_equivalent)` nets to
zero by itself in every view that already computes `units_moved`. No special
case anywhere, and no schema change beyond the new type.

`is_depletion` is TRUE on purpose. A return is a depletion event pointing the
other way, and leaving it false would drop it out of exactly the reports that
need to show it.

⚠️ **NETTING IT AWAY SILENTLY WAS THE ALTERNATIVE, AND THE BRANDS READ THIS
DATA.** Operator, 6 Sep 2026: *"if we reported 3 sold in july then they
returned it in august really we sold a net of 0 and this system we are building
will also be used by the brands so need to be transparent with that."* Both
rows show on the brand's log. Whether a return also credits the commission is a
Rate card decision (D60); `rate_card` has no non-negative constraint, so a
credit is expressible when he wants one.

---

**D170 - RULE IN THE TABLE, NOT IN A PICKER BESIDE IT.**

Operator preference, 6 Sep 2026, on being handed a per-record selectbox:
*"can we just make the table able to be edited? That is so much easier for me
instead of the drop down."*

When a page asks the same decision of many rows, the deciding column belongs IN
the grid with one Save. Thirty unclaimed accounts through a picker is thirty
round trips. **Most of the time, not always** - a single-target action, or one
whose inputs differ per row, is still better as a form.

Two rules survive the change and both are load-bearing:

- **Nothing is pre-selected on a grid that writes.** A blank default means a
  row nobody read writes nothing. On the flash's claim tab that matters more
  than usual: it is the tab where fuzzy matching offered Universal Studios for
  "University Wine and Spirit" (D163).
- **The editor's `key` carries the filter and the row count**, not just the
  page's subject. `st.data_editor` keeps edits by ROW POSITION, so a different
  upload re-projects them onto whatever now sits in that row - the same fault
  D103 records costing a real depletion.
