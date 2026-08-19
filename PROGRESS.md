# PROGRESS.md

Build log for the brand portal. Phases are from `PORTAL_PLAN.md`.

**Current position:** Phases 0, 1, 2 and 4 are complete, and **Phase 5 — the
staff admin — was built on 19 Aug 2026.** A brand logs in and sees only their
own activity, venues and dashboard; staff run a separate Streamlit app to
analyse the business and clean the data.

| Stage | What | State |
|---|---|---|
| 1 — Everything in | deals, taxonomy, titles, photos, cities, expense exclusion | ✅ done |
| 2 — Analysis | activity mix, venue performance, city summary, money views | ✅ done |
| 3 — Presentation | dashboard, activity, venues, gallery, business page | ✅ done — programme summary dropped by the operator |
| 5 — Staff admin | analysis + data cleanup, 7 pages | ✅ v1 works |

**Live as of end of 19 Aug 2026:** 1,088 activities · 353 venues · 412 photos ·
11 brands (5 active) · 232 rate-card lines · 38 classification rules · 7 months
of invoice recap.

Everything is committed. **`ihospitality.vip` is still untouched** — only merging
[PR #1](https://github.com/nfatta/iHospitality/pull/1) changes that, and the two
newest website commits are not yet pushed.

### Pick this up here

**The next build is the admin / staff back end, and the programme summary is
dropped.** Operator direction, 19 Aug 2026: *"I really want to get the admin/staff
side figured out. The analysis tables but also everything we are doing now, I want
this to be able to be done on the back end. Like when stuff is imported I can
clean up the data myself... Lets get what we have rock solid first."*

So Phase 5 moves ahead of any new brand-facing feature, and its scope is wider
than "a Streamlit admin" — it is **the place data gets cleaned after import**:

| the admin must let staff | today that means |
|---|---|
| edit rate cards | editing eleven dicts in `load_rate_card.py` and re-running it (D60 tier 2) |
| merge duplicate venues | no tool exists; `import_bottle_sales.py` skips unknown names instead |
| resolve flagged activity types | 7 sit at `needs_review`; only SQL touches them |
| classify ambiguous activities | `classify_account_sold.py`, CLI only |
| review duplicate activities | detection exists in that tool; flag-only by D59 |
| fix a venue that holds a brand name | one row known (`Tequila Dame Más`) |

**The standing rule for all of it (D60): no hardcoded business data.** Runtime is
already clean — views read tables. The gap is that the *source of record* for
rates and name mappings is Python in a repo the operator does not deploy from.
Closing that gap IS the admin back end; they are not two jobs.

**The one number to trust as a canary:** Dame Mas commission reconciles to the
operator's invoice recap for all four months of Apr–Jul 2026 (April by a cent,
per-row rounding). Re-checked after every change on 19 Aug and still ties. If it
stops matching, something upstream broke.

**And the rule that outranks it (D56): the distributor's depletion report is the
truth.** Our notes and quantities are what get corrected when they disagree —
never the invoice.

Not yet done: Phase 3 (the HubSpot sync script — the data is currently a one-time
seed), Phase 5 (admin, now next), Phase 6 (field entry and cutover).

**Nothing is on `ihospitality.vip` yet.** The work sits on branch `portal-v1`
with [PR #1](https://github.com/nfatta/iHospitality/pull/1) open, which gives a
Netlify deploy preview at
`https://deploy-preview-1--cool-dusk-e84d8f.netlify.app`. Merging that PR is what
puts the portal on the live domain.

---

## Done

### Phase 0 — Secure the HubSpot token ✅ 10 Aug 2026 (one step outstanding)

- The stray `hubspot_extract.py` copy the plan warned about was already gone from
  the website repo root — nothing to delete.
- Token moved to `Hubspot/.env`, loaded via `python-dotenv` in both
  `Hubspot/Hubspot_Automation/main.py` and
  `Hubspot/automate_hurry/hubspot_extract.py`.
- `.gitignore` in this repo now blocks `*.py`, `.env`, `.env.*`,
  `credentials.json`.

**Verified:** both scripts compile; `.env` resolution works from each script's own
working directory; a grep across the whole `Ihospitality/` tree finds the token
only in `.env`.

**Token rotated by the operator 10 Aug 2026** and confirmed working against the
HubSpot API (deals endpoint, HTTP 200). Phase 0 is fully closed.

### Phase 1 — Schema ✅ 10 Aug 2026 (also verified on Supabase — see Phase 2 load)

`Hubspot/portal_seed/db/schema.sql` — tables, RLS, three dashboard views, triggers, storage
bucket. Heavily commented; it is the SQL learning artifact.

Beyond the plan: an `activity_type_aliases` table (D3), because the live exports
contain 23 spellings of ~15 real activity types.

Bug caught during verification: the photo-count subquery in
`v_brand_monthly_summary` was invalid SQL and would have failed in the Supabase
editor. The fix also avoids a join fan-out that would have silently multiplied
every `sum()` in that view.

**How to see it working:**

```bash
bash db/test/run.sh   # from Hubspot/portal_seed/
```

Expect: two clean applies, then the isolation test — Blue Run sees 1 row per
table and 0 of Starr Rum's under every attack; internal `notes` absent from the
brand-facing view; all four writes refused; `anon` and unauthenticated denied
including on views; staff sees all; all five constraint guards fire; two NULL
HubSpot IDs coexist. Last run: all passing.

---

### Phase 1b — Admin-managed activity taxonomy ✅ 10 Aug 2026

Operator ruling (D4): the activity vocabulary will keep changing, so an admin must
be able to add and adjust types — imports must not depend on us guessing the
mapping. Added `resolve_activity_type()`, `merge_activity_type()`, and the
`v_activity_types_needing_review` queue. An unrecognized activity type now costs
zero rows: it is created, flagged for review, and surfaces in the admin queue.

**How to see it working:** same `bash db/test/run.sh`. The taxonomy section
shows a known alias resolving without creating anything; an unknown value being
created and flagged; the same value twice staying stable; messy punctuation
(`Drink List 3!!  (PK)`) yielding a legal code; blank and NULL both routing to
`unclassified`; a merge moving activities and aliases and retiring rather than
deleting the source; and a brand login refused on both functions.

---

### Phase 2 — Seed from HubSpot CSVs ✅ built and proven on real data 10 Aug 2026

Lives in `../../Hubspot/portal_seed/` (D1 — Python stays out of the deployed repo).

| File | What |
|---|---|
| `normalize.py` | Pure transformation rules. No DB, no filesystem. |
| `normalize.py` / `test_normalize.py` | Pure rules + 35 unit tests, every fixture a real string from the exports. |
| `seed_from_csv.py` | The loader. Dry-run by default. |
| `test_seed_integration.sh` | End-to-end against a throwaway Postgres, twice, checking idempotency. |

A Sonnet subagent audited all 29 CSVs first (`Hubspot/DATA_AUDIT.md`); its three
headline claims were independently re-verified before anything was built on them.

**Results on the real exports:** 25 files, 1,777 raw rows → **942 activities,
297 venues, 11 brands** (303 before the Phase 4 brand-as-venue fix). 818 duplicate Record IDs collapsed (81% of rows overlap
across the monthly exports and their `_with_notes` siblings). 282 venues matched
by HubSpot company ID, 21 by name only. 11 rows skipped, all for an unusable
close date.

**Two bugs the integration test caught that a dry run never would have:**
1. *Not idempotent* — `ON CONFLICT (hubspot_company_id)` never fires when that
   column is NULL, so all 60 name-only venues were re-inserted on every run.
   Fixed by resolving venues through a pre-loaded cache keyed by both ID and
   name, plus a partial unique index in the schema as a database-level guard.
   Side benefit: 39 name-only rows now resolve onto their ID-matched twin
   instead of duplicating it.
2. *A `nan` activity type was created* — a blank cell read with `dtype=str`
   comes back as float NaN, and `str(nan)` is `"nan"`. Blanks now route to
   `unclassified`. Regression test added.

**How to see it working:**

```bash
cd ../../Hubspot/portal_seed && python seed_from_csv.py
```

Dry run — reports every count above and writes nothing. Then
`python -m pytest test_normalize.py -q` (35 tests) and
`bash test_seed_integration.sh` (loads twice, asserts the second run changes
nothing). Last run: all green.

---

### Phase 2 load onto Supabase ✅ 10 Aug 2026

Operator created the project; schema applied (Postgres 17.6, 12 objects, 8 RLS
policies) and the seed run against it. **Live counts at the time: 11 brands, 303 venues, 942
activities.** (Now 297 venues after the brand-as-venue fix in Phase 4.) Identical to the local run. The seed
was then run a second time end-to-end and every count was unchanged — idempotency
proven on the real target, not just locally.

**This is where verifying on the real target paid for itself.** `authenticated`
held 33 INSERT/UPDATE/DELETE grants that no local run had ever shown, because
Supabase grants `ALL` on new public objects by default and our `grant select`
added to that rather than replacing it. RLS was still holding (0 rows affected,
verified live in a rolled-back transaction), but the grants are gone now, and the
local stub was updated to reproduce Supabase's default privileges so the harness
would catch it next time. See D6.

Two connection gotchas worth knowing: the database password contains an `@` and
must be percent-encoded as `%40` in `DATABASE_URL` (D10), and the load takes a
few minutes because it is ~1,900 network round trips — batching is the obvious
optimization if it ever becomes annoying.

**How to see it working:**

```bash
cd ../../Hubspot/portal_seed && python verify_live.py
```

Read-only. Prints row counts, per-brand totals and date ranges, proof the three
dashboard views return data, the derived account list, the full grant/RLS audit,
and your activity-type review queue.

---

### Phase 4 — The brand portal ✅ 10 Aug 2026 — v1 works end to end

**CSS extraction first**, as the plan required. `css/site.css` now holds the
tokens, nav, buttons, section base, footer and mobile nav; page-specific CSS
stays inline after the link so a page can still override (gallery.html relies on
that). Proven a no-op rather than assumed: each page was diffed against its
pre-change version from git, side by side in iframes, comparing 33 computed
style properties plus bounding boxes for every element at 1440/1024/768/375px.
index.html 359 elements, gallery.html 123 — zero differences at every width.

**Five pages** — `login`, `index` (dashboard), `activity`, `venues`, `photos` —
plus `portal.js` (Supabase client, auth guard, shared shell) and `portal.css`.

Every query is deliberately written **without** a brand filter. RLS applies the
restriction in Postgres, so the browser never decides what a user may see.

**Verified in a real browser with two real logins against the live database:**

| | Blue Run | Wodka |
|---|---|---|
| Brands visible | 1 | 1 |
| Activities | 91 | 155 |
| Venues | 44 | 70 |

Neither can reach the other by name or id; naming another brand's id returns 0
rows; insert, update, profile self-escalation and the admin RPCs are all refused
with 42501. Mobile checked at 375px: no horizontal overflow, hamburger toggles,
tables scroll inside their container.

**A data defect this surfaced.** Searching venues for "whiskey" returned *Blue
Run Whiskey* — a brand name sitting in the venues table, shown to that brand as
one of its own accounts. 6 such rows, 27 activities. The venue column sometimes
holds a bare brand name with no venue after it; those now resolve to no venue
rather than inventing one. The first fix missed `iHospitality`, which has a
genuine HubSpot company record of its own, so the name check now runs before the
id check. Re-seeded: 0 brand names in venues, all 942 activities retained, 45
correctly carrying no venue.

**How to see it working:**

```bash
python -m http.server 8123
```

Then open `http://localhost:8123/portal/login.html`. Two test accounts exist
(`test-bluerun@example.com`, `test-wodka@example.com`) — **delete them before
real brands are onboarded**:
`python create_portal_user.py --delete --email test-bluerun@example.com`

---

## Live state as of end of 10 Aug 2026

**Portal accounts** (`python create_portal_user.py --list`):

| Email | Role | Sees |
|---|---|---|
| `phil@ihospitality.vip` | staff | All 11 brands — created for a remote demo |
| `test-bluerun@example.com` | brand_user | Blue Run only |
| `test-wodka@example.com` | brand_user | Wodka only |

**Demo preview:** https://deploy-preview-1--cool-dusk-e84d8f.netlify.app/portal/login.html
(from PR #1; disappears when the PR closes).

**Repos.** Website repo is on branch `portal-v1`, 8 commits ahead of `main`,
pushed. `Hubspot/portal_seed/` is a separate local repo, 2 commits, no remote.

### Stage 3 + the money model ✅ 18 Aug 2026 — the long afternoon

Six pieces, in the order they happened. Full reasoning in D29–D50.

**Presentation.** The staff dashboard showed August as "3 activities" when it
was 29 — one row per (brand, month) with no brand column. `v_monthly_summary`
groups by month alone and serves both audiences through `security_invoker`
(D29). Tables sort, months drill into the activity log, and the gallery was
rebuilt around the activity that produced each photo (D26/D32) — it had been
sorting on `taken_at`, which is NULL for all 412 photos.

**Cities without markets (D33).** The operator's call: *"it shouldn't matter if
in or out of market. We are in the midst of expanding so let's not cap
ourselves."* 317 venues have a city; `market` is NULL everywhere and the enum is
left unused. 64 venues sit in cities the old two-market rule would have thrown
away.

**The taxonomy/billing conflict (D34, D22, source_activity_type).** The rate card
prices distinctions the taxonomy deliberately collapses — "tasting event",
"tasting event N/C" and "Tasting Event Split" are $150, $0 and $100 but all
resolve to `tasting_event`. Solved by storing the raw HubSpot string alongside
the resolved type: analysis groups by the type, billing joins on the string.

**The rate card (D42).** Two rates per line — `charge_rate` and `pay_rate` —
because 44 North reorders bill the brand nothing yet still cost a contractor
payment. Plus `charge_pct`/`pay_pct` for percentage deals. Staff-only, verified:
a brand login sees 0 rows.

**Dame Mas economics (D44).** `amount` is gross sales. iHospitality takes 10%,
the contractor 80% of that (8% of sales), 2% is kept. Verified live at exactly
10.00 / 8.00 / 2.00.

**Bottle sales (D38/D41/D48).** 18 rows, 100 bottles, $16,577.30, imported
through `import_bottle_sales.py` — the first data in the portal that never came
from HubSpot, keyed on the new `activities.external_ref`.

#### Where the money stands

Current brands only:

| brand | activities | unpriced | charged | cost | margin |
|---|---|---|---|---|---|
| 44 North | 344 | 13 | $10,357.10 | $5,470.00 | **$4,887.10** |
| Wodka | 192 | 3 | $2,637.00 | $2,080.00 | **$557.00** |
| Aspen Green | 62 | 5 | $1,185.00 | $385.00 | **$800.00** |
| Dame Mas | 196 | 76 | $1,657.75 | $1,736.18 | **−$78.43** |
| iHospitality | 19 | 3 | $0.00 | $160.00 | −$160.00 |

Dame Mas reads negative only because 76 of its activities are unpriced — 56 of
them `account sold`. It is a data gap, not a loss.

#### Bugs this session, and how each was caught

None came from a failing test. All five came from reading numbers.

1. **The month boundary** — `closedate LTE '2026-06-30'` dropped every deal that
   closed *during* the last day, 91 returned instead of 103. A subagent reported
   it as "live drift"; it was not.
2. **Supabase Storage returns HTTP 400 with the real status in the body** —
   `"statusCode":"403"` for auth, `"409"` for a duplicate. Broke uploads, then
   broke the resume path.
3. **The single rate lookup** discarded every contractor pay rate, so cost read
   $0 for all five brands that had charges and margin equalled revenue.
4. **An upsert missing a column in its UPDATE half** — `source_activity_type`
   stayed NULL through a run reporting "14 updated".
5. **`create or replace view` matches columns by POSITION** — hit three separate
   times; new columns must go at the tail, never mid-list.

---

### Photo backfill ✅ 18 Aug 2026 — 406 photos, 87% smaller

`python sync_photos.py --limit 2000 --apply` over every non-expense activity.

| | |
|---|---|
| activities scanned | 1,065 (1,070 less the 5 expense) |
| attachments found | 425 |
| loaded | **406** |
| bytes before → after | **934 MB → 119 MB (87.3% saved)** |
| duplicate images skipped | 12 |
| undecodable | 6 |

Every attachment is accounted for: 406 + 12 + 6 = 424, plus one duplicate
removed by hand during the content-hash backfill.

**The 6 failures are `.heic` — iPhone photos.** Pillow cannot decode HEIC
without `pillow-heif`. These are real photos that did not import, and the
problem grows as more people shoot on iPhones. Adding that dependency is the
fix; not yet done, awaiting the operator.

Idempotency confirmed after the fact: a full dry run reports 407 already
present and 0 to download.

`sync.py` now wraps both steps into one command — see D31.

---

### Full backfill, June 2025 → August 2026 ✅ 18 Aug 2026 — operator-approved

15 months synced month by month. **942 → 1,070 activities, 297 → 349 venues**,
0 duplicate deal ids, all 508 seed-loaded `notes` intact, brands still 11.

**Every one of HubSpot's 1,076 dated deals is accounted for:**

| | |
|---|---|
| fetched across 15 months | 1,076 — exactly HubSpot's total |
| skipped, no `brand` property | 80 |
| skipped, close date in the future | 1 (dated 2026-08-31; today is the 18th) |
| loaded from the API | 995 |
| CSV-only rows the API cannot maintain | 75 |
| **activities in the database** | **1,070** |

**July and August 2026 were entirely new** — 82 and 29 activities the one-time
seed never had. This is the phase paying for itself: the portal was a snapshot
ending 30 June, and is now current to 13 Aug.

#### The finding: 75 rows are correct but frozen

From 2026-01 onward every row is maintained by the sync. Across Jun–Dec 2025,
**75 are not** — the sync skips them because HubSpot's `brand` property is
**empty** on those deals, while the CSV exports carried a Brand value.

Checked rather than assumed: fetching those deals from HubSpot returns 200 with
`brand` blank, even though the deal *names* plainly identify it
("Intro to Starr follow w/Peter", "HD Whiskey & Bootleg tasting"). So the
structured field was never filled on older deals and the CSV had better data
than the API does.

Those 75 rows are **not wrong** — they carry the right brand and brands see them
correctly. They are frozen: no future sync will ever update them, and a
truncate-and-reload from the API alone would lose them.

Deriving the brand from the deal name was deliberately **not** done. That is
exactly the fuzzy matching `normalize.py` refuses on the grounds that it
eventually merges two real brands.

**The fix is a worklist, not code.** The database already knows the correct brand
for all 75, from the CSV. Written to
`Hubspot/hubspot_missing_brand_worklist.csv` (outside the website repo — it must
never be public): Record ID, deal name, close date, and the brand to set. Filling
those in HubSpot and re-syncing closes the gap permanently.

**5 deals are known to no source at all** — never loaded by CSV or API, because
they have no brand in either. Four read as Starr Rum from their names, one
("Spirits2U introducing") is ambiguous. They are in the worklist marked
`UNKNOWN — needs your judgement`.

---

### Taxonomy cleanup ✅ 18 Aug 2026 — done before Stage 2, deliberately

Five merges run against the live database (D22), and `recurring_case` corrected
rather than merged (D21). Active activity types **26 → 21**; review queue
**11 → 5**; activities unchanged at 942 with 0 orphans.

**The headline number changed.** `recurring_case` is a *reorder*, and its
`is_depletion = false` had been excluding 51 activities from every units figure
the portal shows. `units_moved` across all months: **375 → 466**, of which 89
units are the reorders and 2 the tap merge.

Still flagged, awaiting a ruling: `aspen_green_fresh_market_incentive` (9),
`unclassified` (8), `promo_specialist` (1), `single_barrel_sale` (1),
`5l_barrel` (1). The 8 unclassified are blank Activity Type cells in HubSpot;
the plan is to fill them in HubSpot and re-sync, as a live test that the
HubSpot→portal loop closes.

---

### Stage 1a run against Supabase ✅ 18 Aug 2026 — operator-approved

`python sync_hubspot.py --month 2026-06 --apply` against production.

**Result: 0 inserted, 103 updated.** Every June deal matched an existing row by
`hubspot_deal_id`. Totals before and after are identical — 942 activities, 297
venues, 11 brands, 103 in June — with 0 duplicate deal ids and exactly 103 rows
carrying a new `updated_at`. The 508 seed-loaded `notes` survived untouched,
which is the check that proves a deals-only slice does not clobber the CSV
path's work, and `brand_visible_summary` is still 0 rows (D17).

This is the strongest form of the reconciliation: the API and the CSV export
independently produced the same 103 activities with the same per-brand split.

One visible effect worth knowing: the sync also updates `activity_type_id` from
HubSpot's current value, so one activity moved from `tap_with_labor` to
`tap_cocktail` — a stale CSV value corrected by the live source. That is the
intended direction of authority while HubSpot remains the system of record.

---

### Stage 1a — deal sync ✅ 18 Aug 2026

`Hubspot/portal_seed/sync_hubspot.py` (+ `test_sync.py`, 27 tests). Commit
`27b062a` in the portal_seed repo. Dry run by default; `--month YYYY-MM`
backfills a calendar month, `--since YYYY-MM-DD` picks up anything *edited* on
or after a date (default: the last 7 days) so an edit to an old deal re-syncs,
not just new ones.

Reuses `normalize.py` unchanged and mirrors `seed_from_csv.py`'s venue cache and
upsert on purpose — that cache fixed a real duplicate-venue bug and the two
writers must not drift apart. Writes neither `notes` nor `brand_visible_summary`
(D17). Deals only: notes and photos are later slices.

**Three things the live API taught us that no local test could have.**

1. **The deals-search `associations` request field is a silent no-op.** A search
   with `"associations": ["companies"]` returns 200 with no `associations` key on
   any result, even for deals that demonstrably have a company. Venues must be
   resolved through `POST /crm/v4/associations/deals/companies/batch/read`.
   `Hubspot_Automation/main.py` carries the same dead field, so it never had
   working associations either.
2. **That batch endpoint answers HTTP 207, not 200**, whenever any input in the
   batch has no associations — which is a legitimate no-venue deal, not a fault.
   Treating 207 as failure would drop whole batches.
3. **The month upper bound must be `LT` the first of the next month**, not `LTE`
   the last day of this one — see below.

**The bug worth remembering.** The first version filtered `closedate LTE
'2026-06-30'` and returned 91 deals for June 2026. The database holds 103, and
exactly 12 of them fall on June 30. `closedate` is a full timestamp
(`2026-06-30T16:52:15.459Z`), so `LTE` a bare date compares against midnight and
silently drops everything that closed *during* the last day of every month.
Confirmed directly against the live API — `LTE` the 30th returns 91, `LT` 1 July
returns 103. Now expressed as a half-open interval, which is also immune to month
length and leap years. Regression test asserts both the operator and that the
bound is never the last day, since either mistake alone brings the bug back.

It was reported as "live drift" before being checked. It was not drift. **This is
the case for re-running a subagent's verification rather than reading its
summary** — the numbers were plausible and the explanation was wrong.

Separately this fixes `main.py`'s single-page read, which truncates at 100
results with no warning. June 2026 needs two pages.

**How to see it working:**

```bash
cd ../../Hubspot/portal_seed && python sync_hubspot.py --month 2026-06
```

Dry run, writes nothing. Expect 103 deals over 2 pages, 4 brands, 64 venues,
6 deals with no company.

**Verified:** 62 unit tests pass; the schema + RLS suite is green; June 2026 was
loaded **twice** into a throwaway local cluster — 103 activities both times,
0 inserted / 103 updated on the second run, 0 duplicate `hubspot_deal_id`, and
`notes` / `brand_visible_summary` both untouched at 0 rows. Per-brand counts came
out **identical to the CSV seed already in Supabase** — 44 North 40, Wodka 28,
Aspen Green 25, Dame Mas 10 — which is the plan's "seed accuracy" reconciliation
satisfied for one month by two independent paths. Nothing was run against
production; `load_dotenv` does not override a shell-set `DATABASE_URL`, which is
what keeps the local test local.

**Not yet run against Supabase.** The live database still holds the CSV seed
only. Awaiting the operator's go-ahead.

---

### Stage 2 — analysis views ✅ 18 Aug 2026

`v_activity_mix`, `v_venue_performance`, `v_city_summary` (D34), plus cities
loaded through the sync (D33). Stage 1 is complete.

Real numbers from the live database:

- **Staff trainings: 18 overall** — Blue Run 7 across 6 venues, Barmen 1873 and
  Dame Mas 3 each.
- **Reordering is Wodka's story.** Copper Rocket 9 reorders, The Whiskey 8,
  Vineyard Wine Co 6, Serafina Miami 6.
- **Accounts gone quiet:** a tail of venues placed once and untouched for
  390–413 days.
- **Where the work is:** Orlando 192 activities over 52 venues, Melbourne 101
  over 26, Sanford 68, Boynton Beach 64, Tampa 51.

**How to see it working:**

```sql
select * from v_venue_performance where reorders > 0 order by reorders desc;
```

Not yet surfaced in the portal — these are views, not pages. Stage 3.

---

## Session of 18 Aug 2026 — what a fresh read found

**The Supabase project had paused itself.** Free tier pauses after 7 days idle;
the last activity was 10 Aug. It presents as a DNS failure on both the DB and
API hostnames, which looks like a broken `DATABASE_URL` and is not — see D15 for
how to tell the difference in thirty seconds. The operator restored it; every
count and the full grant/RLS posture came back intact.

**Baseline re-verified before any new work**, all green:
`bash db/test/run.sh` (anon 0 grants, authenticated 0 write grants, 11 SELECT),
`python -m pytest test_normalize.py -q` (35 passed), `python verify_live.py`
(942 activities, 297 venues, 11 brands, 0 photos).

### Bug found: the staff dashboard repeats every month, unlabelled

Reported by the operator from the `phil@ihospitality.vip` login: June appeared
four times, then May four times, with nothing indicating which brand each row
belonged to.

**Cause.** `v_brand_monthly_summary` returns one row per *(brand, month)*.
`renderMonths()` in `portal/index.html` renders one table row per view row with
a Month column and no brand column. Under RLS a brand user sees exactly one
brand, so it looks correct; staff see all 11, so each month repeats once per
brand with activity that month. Four brands had June 2026 activity — hence four
Junes.

**It is not only the missing label.** The stat cards above that table are also
wrong for staff: "Activities in [month]" reads `data[0]`, which is one arbitrary
brand's month rather than the total across brands, and the displayed date range
reads the last row instead of the true minimum.

**Root cause, stated plainly:** the portal was designed as one-user-one-brand,
and the staff role was added later for a remote demo without a matching UI. Fix
belongs in Stage 3 (D19); the operator was offered it earlier and it stays in
Stage 3 unless that changes.

### New data found in `Hubspot/`, dated after the portal was built

- **`hubspot-crm-exports-all-companies-2026-08-13.csv`** — 465 companies, **447
  carrying a City**, 241 a Type. This is the city/market data open item 5 says
  does not exist. It also generalizes something currently hardcoded:
  `Type == 'Brand'` marks 22 companies where `normalize.py` hardcodes 5 brand
  company IDs by hand.
  **Caveat:** the cities do not fit the two-market enum cleanly. Orlando (71),
  Sanford, Winter Park, Oviedo, Clermont and Kissimmee are Central Florida;
  Boynton Beach, Delray Beach, West Palm Beach and Boca Raton are Palm Beach
  County. But Melbourne (38), Cocoa Beach (13), Palm Bay and Satellite Beach are
  Brevard, and Tampa (14), Miami Beach (7), Jacksonville (5) and Port St Lucie
  (5) are neither market. Roughly 90 venues have no legal `market` value;
  `market` stays NULL for those pending a ruling. The City column also has
  whitespace duplicates ("Melbourne" 23 + "Melbourne " 15).

- **`July/July_2026.csv` and `Reference.csv`** are **not** HubSpot exports —
  schema is `Contractor, Date, Brand, Account, City, Buyer, Rep, Backbar, Qty,
  Opportunity, Expense, Images, Notes`, with no `Record ID`. Alongside them,
  `automate_hurry/monthly_invoice.py` (13 Aug). The seed safely ignores all of
  these: `load_rows()` skips any CSV without a `Record ID` column, so nothing has
  drifted. The operator confirmed 18 Aug that **HubSpot is still the source of
  record for now**, so Phase 3 proceeds — but this format is the likely shape of
  the eventual replacement importer.

---

## Open items for the operator

**Ordered by what they cost. The first three block money figures.**

### 1. Dame Mas depletion summaries — 9 months missing, $3,328 of commission

**Resolved 18 Aug: `account sold` is NOT the billing basis (D51).** Tested
across all 13 months of the invoice recaps — 11 do not reconcile, with implied
unit prices up to $2,401 against real bottle prices of $123–$210.75. April
proves it: the depletion summary has 10 venues and 59 bottles where HubSpot has
3 account-sold events and 4 units. They record different things — a placement
versus every bottle depleted that month.

So those 56 activities stay unpriced by design, and **what is actually needed is
the depletion summaries for Jul 2025 – Mar 2026**: $2,307.75 of 2025 commission
plus $1,020.53 across Jan–Mar 2026. `import_bottle_sales.py` already reads that
format; it needs the files and their section-to-month order.

**The operator's matching rule does work, at venue level with a one-month lag
(D52).** Tested month by month: 7 of the 8 in-window `account sold` rows tie to
a depletion, several in the following month — which is the lag the operator
described. **Exactly one does not: 26 May, Star Liquors VII.** That is the row
that was really an account visit.

That rule is a reusable QA tool: as the missing summaries arrive, it separates
real placements from mis-typed visits mechanically across the remaining 48 rows.
`account sold` is being retired, so this is historical cleanup — but the 74 rows
still need classifying before any Dame Mas revenue figure is trustworthy.

**The workbooks the operator supplied at the close of 18 Aug (D53) close most of
this.** `Dame Mas 2026.xlsx` has a sheet per month for **Aug 2025 – Jul 2026**
with venue, quantity and activity type — the detail that was missing. Before
importing, three faults in the file need fixing at source:

- **DECEMBER is an exact copy of NOVEMBER**, so December 2025 is absent while the
  invoice bills $377.65 for it.
- **The 2025 sheets use a different column layout** (8 columns, not 6) with note
  text where the activity type sits in the 2026 sheets.
- **NOVEMBER's type column holds quantities**, not types.

`Dame Mas 2025 Activity Report.xlsx` was locked open in Excel and could not be
read.

**Star Liquors VII is resolved:** its note says the owner *"committed to a case
of each, to be bought tomorrow"* — a commitment logged as a sale before anything
depleted. D52's method found it; the note explains it.

### 1b. Superseded — the original framing of the above

The operator's rule: *"for Dame Mas, any place we don't have case sold but have
account sold, the summary report should show that."* Checked, and the answer
splits by date:

- **Inside the Apr–Jul 2026 summary window there are only 8.** Six are on the
  bottle summary and so are already billed through the 10% commission — pricing
  them again would double-count. **Two are not:** City Dog Cantina (30 Apr,
  "Dame Mas Repo reorder at City Dog Cantina") and Star Liquors VII (26 May).
  Those two are the candidates for being account visits.
- **48 fall outside the window** and cannot be judged from the file at all.

Note also: the summary lists "City Dog Cantina #2" while the account-sold row is
against a plain "City Dog Cantina". Those may be two records for one venue.

### 2. Dame Mas 2025 — $2,307.75 of commission the portal cannot see

The 2025 recap gives monthly commission from July to December; the portal holds
**no venue-level bottle data before April 2026**.

| | Jul | Aug | Sep | Oct | Nov | Dec | total |
|---|---|---|---|---|---|---|---|
| commission | 375.90 | 375.75 | 175.65 | 653.30 | 349.50 | 377.65 | **$2,307.75** |
| implied gross | 3,759 | 3,758 | 1,757 | 6,533 | 3,495 | 3,777 | **$23,077.50** |

The 48 `account sold` rows in that period are almost certainly those same
placements, recorded without the depletion numbers behind them. **The monthly
account-sold summaries for Jul 2025 – Mar 2026 would close this**, and
`import_bottle_sales.py` already reads that format — it needs the files and
their section-to-month order.

### 3. Rates still missing

- **Starr Rum (63 activities)** — no rate card. To be archived, so possibly moot.
- **`account sold` for the other four brands** — 18 activities across 44 North,
  Blue Run, Wodka and Barmen 1873. They look like ordinary case sales.
- **Contractor pay** exists for 7 activity types only. Anything else shows cost
  $0, which understates it.
- **Monthly retainers** ($975–$1,850, and $750 for Dame Mas) stay on the invoice
  by decision — they are the largest revenue line and are absent from every
  figure the portal shows.

### 4. Smaller, and none of them blocking

- **Password reset** (D18) still gates real brand logins. Static HTML, small.
- **The 8 blank activity types** in HubSpot fix themselves on the next sync.
- **The two test logins** — delete before onboarding real brands.
- **`reordering` status** (D21): a reorder currently moves a venue to `placed`;
  `account_status_enum` has had `reordering` unused since Phase 1.
- **Merge PR #1** when the portal should go live.
- **The Rusteak question** — Thornton Park was mapped onto "RusTeak - Managerie"
  on the operator's word; if they are different locations, split them.

### 5. Next build step

The **program summary** — Activity / QTY / Rate / Total per brand per month, in
the shape of the operator's spreadsheet. Deliberately paused: *"I want to ensure
I have the data of everything I want to see."* It is a straightforward read off
`v_activity_money` once the gaps above are settled.

---

## Superseded — resolved during 18 Aug



1. ~~Delete the two test logins.~~ **Deferred 18 Aug** — they are the only way
   to re-verify RLS in a browser, so they stay until Stage 1 is verified. Still
   must go before real brands are onboarded.
   `python create_portal_user.py --delete --email test-bluerun@example.com`
2. **Merge or close PR #1.** Merging puts the portal on `ihospitality.vip`;
   closing takes the demo preview down. Note the preview stayed live and broken
   through the 10–18 Aug database pause (D15).
3. **`All Brands` (20 activities) and `iHospitality` (16)** are loaded as brands.
   Neither looks like a real client — decide whether to retire or merge them.
   There is no brand-merge function yet (the equivalent exists only for activity
   types), so this needs either a decision to build one or a manual fix.
   *Raised again 18 Aug, still unanswered; it will resurface in Stage 2.*
4. **11 activity types are flagged for review** — `recurring_case` (51
   activities) is the big one. `python verify_live.py` lists them.
5. ~~No city or market data exists.~~ **Unblocked 18 Aug** — the 13 Aug companies
   export carries a City for 447 of 465 companies, and the operator approved
   loading it. Scheduled as Stage 1d. **Ruling still needed** on the ~90 venues
   whose city is in neither market (Brevard, Tampa, Miami, Jacksonville,
   Port St Lucie); those keep `market` NULL until then.
6. ~~No password reset flow.~~ **Split out of Phase 5 on 18 Aug (D18)** — ships
   as static HTML using `resetPasswordForEmail()`. Still required before real
   brands get logins.
7. **Photos are entirely empty.** `photos.html` renders its empty state
   correctly, but nothing populates that table until Stage 1c brings the HubSpot
   attachments across, resized per D16.
8. **The staff dashboard is wrong** — months repeat once per brand with no brand
   column, and its stat cards show one arbitrary brand's figures. Detail in the
   18 Aug session notes above. Queued for Stage 3.
9. **Stage 2 needs your questions.** Which three or four analyses would you
   actually look at monthly? Building generic views instead of the ones you use
   is the main way this stage gets wasted.
10. **Consent ruling (D20).** Confirm that `consent_confirmed` gates the public
    gallery rather than viewing inside the private portal, before photos load.

## Not started

- Phase 3 — sync script
- Phase 4 — brand portal pages (v1 ships here)
- Phase 5 — Streamlit admin
- Phase 6 — field use and HubSpot cutover

---

## Known data problems to resolve before seeding

Found by profiling the six `hubspot-crm-exports-*.csv` files (315 rows):

1. `Dame Mas` (56 rows) and `Dame Mass` (1 row) are the same brand. Merge.
2. 23 activity-type spellings → 15 canonical types. Mapping is seeded in
   `activity_type_aliases`; unseen values must fail loudly, not silently drop.
3. Deal stages exist and are currently unused (D7). Seven values, no mapping to
   `account_status_enum` yet.
4. Venue naming consistency across months is untested — the plan predicts this is
   the real work of Phase 2, and profiling has not yet confirmed the extent.
