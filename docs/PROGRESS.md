# PROGRESS.md

Build log for the brand portal. Phases are from `PORTAL_PLAN.md`.

**Current position:** Phases 0, 1, 2 and 4 are complete; **Phase 5 — the staff
admin — was built on 19 Aug 2026**, and later the same day gained a **staging
zone** so that cleaning data survives a HubSpot re-sync (D64). A brand logs in
and sees only their own activity, venues and dashboard; staff run a separate
Streamlit app to analyse the business, review what HubSpot has sent, and clean
it before it becomes real.

> **Read this before trusting any revenue figure here.** Comparing the portal
> against QuickBooks on 19 Aug showed the portal carries roughly **13%** of what
> the business actually bills — $24,754 against **$194,231** (Jan 2025–Aug 2026,
> 11 customers). Three causes, none of them a billing error: every brand pays a
> **monthly retainer the schema cannot represent**, `invoice_recap` is loaded
> from spreadsheets that disagree with the invoices, and `quantity` was not
> multiplied where it should be. **The third is fixed — D65 applied 21 Aug**,
> taking charge to **$30,294.35** and contractor cost to $17,741.18, so margin
> moved $10,903 → **$12,553**. The other two stand, and the retainer is the big
> one: margin per brand is still not a meaningful number, and the Dame Mas
> account read as *negative* until the retainer was found.

### 2 Sep 2026 — two threads opened, neither built

⚠️ **Ran in a cloud session with no `portal_seed` and no `DATABASE_URL`**, so
nothing was verified against live data and no Python, schema or portal page was
touched. Repo changes are confined to `docs/`.

- **D159 — `closed` accounts.** `venue_grading.lifecycle` gains a fourth value
  alongside `prospect` / `retired` / null. Fresh Market stays `retired`. The
  migration is written and sits in `docs/HANDOFF.md`; **it has not been applied.**
  The Streamlit control is not built.
- **D160 — the brand scorecard.** The spec and implementation plan are now in
  `docs/`. Tested against the real July 2026 44 North billing sheet: the charged
  half re-prices to **$535.00**, matching the invoice to the cent, but
  `uncharged_value` — the spec's strongest figure — computes to **$0.00**,
  because the rate card holds charge rates and a list price is a field that does
  not exist. Rates **do not transfer between brands** (operator ruling). Two of
  the four headline metrics need a placements table nobody has built.
- **Also found:** four percentages in the client-facing market summary do not
  match their own underlying numbers. June reads −22% and is **−11.3%**.

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

## 2 Sep 2026 (local) — the July scorecard, and reconciling every 44 North account

Nothing deployed, no build credit spent. The work is in the operator's Google
Sheets, `Invoicing/`, and these documents.

**Built.** A single `SCORECARD` tab in the 44 North brand workbook, driven by a
month dropdown in `B3`. Cards for cases moved, accounts that bought, services
delivered and amount billed; a table of the account base against Florida; the
month's biggest buyers; and the billing block last. Verified against July and
June by recalculating the workbook, not by reading the formulas (D164).

**Reconciled.** Every 44 North case sale in the 2025 and 2026 masters, against
the distributor's flash: **106 ruled pairs, 2 chains, 17 rejections**, in
`Invoicing/flash_match.py`, written up in `docs/FLASH_ACCOUNT_MATCHING.md` with
a lookup copy at `44 North/ACCOUNT_MAP_44North.csv` (D163).

⚠️ **The July year-over-year moved five times during that reconciliation and
changed sign: +33.3% → +12.9% → -5.4% → -7.9% → -5.1% → -7.3%.** Each move came
from the operator recognising an account the matching had missed. Florida was
-17.9% over the same month, so the accounts beat the market by 10 points — but
"we grew while Florida fell" was never true and nearly shipped three times.

**Changed in the data.** Reorders are now logged as `recurring case` at $0.00 in
the activity master, one row per account per month, netted against cases already
billed as `Case Sale`. Last year's cases live in the 2025 master as `Case Sale`
and reach the brand file through a `<Month> 2025` IMPORTRANGE tab (D161, D162).

**Still fiction.** Only July 2025 is reconciled, so June 2026 reads **+212.5%**.
Every month before July needs the same backfill.

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

- Phase 3 — sync script. **Written and rebuilt around the staging zone (D64),
  but never run against live HubSpot.** That run is the real first test; use
  `--month` on a single month and watch the review queue.
- Phase 6 — field use and HubSpot cutover

(Phases 4 and 5 are done — see the current position at the top of this file.)

## Ahead of Phase 6, from the 19 Aug QuickBooks read

- **Model the retainer.** Every brand is on one; `charge` comes from `rate_card`
  pricing an *activity*, and a retainer is not an activity. ~65% of what Dame Mas
  pays has nowhere to live. **This is now the largest single gap** — D65 closed
  the quantity one on 21 Aug.
- **Load `invoice_recap` from QuickBooks rather than the workbooks**, which are a
  lossy copy: Aug 2025 commission typed `375.75` where the invoice bills
  `354.75`, June 2026 expenses $158 over, Oct 2025 $125 over, and a $455 Dame Mas
  tasting invoice (3203) in neither the workbook nor the portal. Every QuickBooks
  invoice carries an `ACTIVITY DATE` custom field naming the work month, so the
  one-month billing lag needs no inference.
- **Widen `lib.canary()`** — it compares only `invoice_recap.commission`, so it
  reports "4 months tying" truthfully while ignoring most of the invoice.

---

## Session of 21 Aug 2026 — D65 applied

**`quantity` now multiplies everywhere, and the portal's charge is $30,294.35.**
Two changes plus a third the operator ruled on when it was put to him:

1. **`v_activity_money`: `coalesce(a.quantity, 0)` → `coalesce(a.quantity, 1)`**
   on the charge and cost branches both. Schema change, applied first — a
   coalesce of 1 changes nothing while `per_unit` is still false, so this order
   is what kept the $1,065 hole from ever being open.
2. **209 rate-card lines flipped to `per_unit`.** Data, not code (D60), applied
   once against the live card and deliberately *not* added to `schema.sql`,
   which is re-applied routinely and would re-flip a line the operator later
   turns off on purpose. Two of the 211 flat lines are pure-percent and were
   left alone: the view tests `charge_pct` first, so the flag is dead there.
3. **The defaults flipped too** — column default `true`, admin checkbox
   pre-checked. Otherwise the next rate line added would have reproduced the
   very bug being fixed, invisibly. D62's lesson, third application.

**It ties to D65's prediction to the cent** — every brand's delta as tabled,
total charge $24,754.35 → $30,294.35. The apply script asserted the total before
committing, so drift would have rolled back rather than landed quietly.

**What D65 under-stated: cost moves too.** Contractors are paid per case as
well, so contractor cost went $13,851.18 → $17,741.18 (+$3,890) and margin
moved only +$1,650, not +$5,540. Dame Mas is the row that teaches it — charge
untouched (percent basis), cost up $175, because percent on one side does not
mean percent on both.

**Verified:** 73 pytest · offline schema/RLS/staging suite · `verify_live.py`
clean (1,084 activities, 0 anon grants, 0 write grants to `authenticated`) ·
Dame Mas canary unchanged, which is the correct result rather than a lucky one.

---

## Session of 22 Aug 2026 — D67's ruling applied (D78), and four broken pages (D79)

**The ruling half.** D67 recorded the mileage/expenses ruling on 21 Aug and left
it unapplied. Applying it meant finding out where each half actually landed:

- **Itemised expenses were already out of revenue — by luck.** The five
  `is_expense` rows contributed $0 only because no rate-card line matched their
  types. `account visit` has 565 activities and no charge rate; pricing it (which
  the open work list asks for) would have made "Aspen Green Samples" start
  earning, silently. The exclusion is now the FIRST branch of both CASE
  expressions in `v_activity_money`, so no rate-card line can reach it, and
  `db/test/04_money_test.sql` builds that exact dangerous case and asserts $0.
- **Mileage was the opposite** — $1,243.90 charged against no `pay_rate` at all,
  so cost read $0. Chasing it found the general fault: `unpriced` made a missing
  CHARGE visible, nothing made a missing PAY LINE visible, and that is the
  direction that overstates margin. **37 activities across 12 types charge
  $6,568.90 with no cost behind them.** Now `uncosted` / `uncosted_charge`,
  surfaced on Health, Analysis and Rate card.

Reimbursements are carried BESIDE revenue (`reimbursement`, `reimbursements`),
never inside it. Revenue is unchanged at **$116,751.65** — nothing moved, but it
can no longer move by accident.

**The broken-pages half.** Opening all nine admin pages in a browser found four
faults invisible to every other check:

| page | fault | age |
|---|---|---|
| **Health (front page)** | `lib.canary()` raised on a literal `%` in a D73 comment — the app's first screen, before a single row | since D73 |
| **Review and edit** | same fault, in a comment *warning about* literal percent signs | since D74–D77 |
| **Contractors** | `$350.00 … **$700.00 a month**` rendered as LaTeX gibberish, on the page about to be used to enter everyone's pay | — |
| **Retainer** | same LaTeX fault on the QuickBooks reconciliation caption | — |

Plus one from reading rather than opening: the Retainer page compared 15 months
of portal against 14 months of QuickBooks and accused the operator of a data
error — *"$4,425.00 MORE than QuickBooks invoiced"* — when the answer was
"August is not billed yet." Bounded now; it reads **$71,125.00 against $71,125**,
D71's zero restored to the page meant to show it.

**`test_admin_sql.py` (30 checks)** now catches both families at the source, with
no database needed. Each checker was run against the real bug it was written for,
not only synthetic ones.

**Verified:** 103 pytest · offline schema/RLS/staging/retainer/money suite green
through BOTH idempotency passes, and confirmed to FAIL when the D78 guard is
removed · `verify_live.py` clean (1,255 activities, 0 anon grants, 0 write grants
to `authenticated`, 30 SELECT) · all nine admin pages opened in a browser and
checked for exceptions · Dame Mas canary Apr +$0.01 (D48), May/Jun/Jul exact,
Jan–Mar the known hole.

---

## Session of 22 Aug 2026, later — cleanup, and what using the app found

Continued from the D78/D79 entry above. Everything below came from the operator
using the admin and asking why something looked wrong.

**D80** — reconciliation and classification are different axes; an activity type
with 0 activities is a merge that worked; deal notes added to the classification
grid (18 of 93 queued rows carry one).

**D81** — the venue merge had NEVER once succeeded. It updated `photos.venue_id`,
a column that does not exist, and its error handler blamed something else. Now
`merge_venue()` in the schema, with a status-combining rule that cannot lose a
fact. 15 duplicates merged. Plus `start-admin.cmd`, because the existing launch
config pointed Streamlit at an absolute path and so dropped the loopback setting
entirely — a launcher that could never work, next to one that could.

**D82** — merging a venue that carried a `hubspot_company_id` would have been
undone by the next sync, which inserts a venue for any id it does not recognise.
`venue_hubspot_alias` closes it. Last two duplicates merged: **353 → 336 venues,
zero duplicate names.**

**D83** — the staging zone covers DEALS, not venues and brands. That boundary was
written down nowhere, and it is why D82 was possible at all.

**D84** — the operator ruled that the portal is becoming the source of record and
HubSpot an input. `venues.hand_edited_at` now beats the sync, and the refused
change is KEPT in `staging.hubspot_venue_proposal` rather than dropped — the lazy
fix would have traded a silent overwrite for a silent refusal. `venues.city` was
the only field the sync could overwrite; brands never were.

**D85** — the Duplicates page could refuse and could not help. It blocked a delete
over attached photos while offering no way to move a photo, and had no way to say
"these two are different jobs". Both fixed. `move_activity_photos()` handles the
same-image collision, which is the normal case rather than the edge one: 18
duplicate pairs carry photos, and the two on 44 North / Chefs Table are literally
the same photograph uploaded to HubSpot twice.

**D86** — what `pitched` and `placed` mean (one fact: `is_depletion`), why the
Wildflower row was correct all along (two different bars, 40 miles apart), and
two rulings **NOT YET BUILT**: a reorder should read `reordering` (21 pairs), and
a venue quiet 180 days should read `dormant` (360 pairs).

**The website portal.** `business.html` counted unpriced work with
`charge is null`, which since D78 also catches reimbursements; it now uses the
view's own `unpriced` column (158 rows listed as gaps, 153 after). It also gained
the "charged, not costed" figure, so margin is no longer described only as
understated when it is simultaneously overstated by $6,568.90. Nothing else in
the portal needed touching — every page queries live views and holds no hardcoded
counts, so the merges and reclassification flow through on their own.

**Verified at close:** 103 pytest · offline schema suite green through BOTH
idempotency passes, seven files, and every new guard confirmed to FAIL when
deliberately regressed · `verify_live.py` clean · 336 venues, zero duplicate
names, 1,255 activities and $116,751.65 revenue unchanged throughout · every
admin page opened in a browser and checked for exceptions · Dame Mas canary
Apr +$0.01, May/Jun/Jul exact.

**Not verified:** `business.html` is staff-gated and there was no login to hand,
so its rendering was not seen. The inline module parses and the view columns it
reads are confirmed present with the right values.

---

## Session of 23 Aug 2026 — D86 built, and the counters it would have broken

**Both D86 rulings are implemented.** They had been ruled on 22 Aug and left
unbuilt, which meant the account list stopped at `placed` and never moved again:
the portal could not show a brand that they had bought again, and could not show
an account going cold.

**The numbers came out exactly as D86 predicted.** 21 pairs advanced to
`reordering` (20 Wodka, 1 44 North); 360 of 689 pairs read `dormant`. 1,255
activities and $39,201.65 of activity charge unchanged — this moved no money,
only what the account list says.

| | before | after |
|---|---|---|
| stored `pitched` / `placed` / `reordering` | 471 / 218 / 0 | 471 / 197 / **21** |
| what the account list DISPLAYS | 471 / 218 / 0 / 0 dormant | 213 / 95 / 21 / **360 dormant** |
| activities · activity charge | 1,255 · $39,201.65 | unchanged |

**What was built:**

- `activity_types.is_reorder`, a flag the trigger reads exactly as it reads
  `is_depletion`, with a checkbox on the Activity types page. `recurring_case`
  is ticked. **`bottle_reorder` is deliberately NOT** — it is a reorder by every
  plain reading of the word and worth 11 more Dame Mas pairs, and that is the
  operator's tick to make, not a decision to ship inside a migration. Ticking it
  backfills every account already on file.
- The reorder branch **first** in `sync_brand_venue_status()`. Every reorder type
  is also a depletion, so the other order sets `placed` and stops for ever — a
  failure that is invisible in the data, because `placed` looks entirely
  plausible for an account that reordered.
- `account_status_effective(stored, days_since, dormant_after_days default 180)`
  — one function, called by `v_brand_venue_counts` and `v_venue_performance`.
  Dormancy is derived and never stored, so it is self-correcting: walk back into
  the bar and the row comes back to life on the next page load. The 180 lives in
  that default and nowhere else.
- An idempotent backfill for the 21 pairs that had reordered before the trigger
  knew what a reorder was.
- `db/test/08_account_status_test.sql`, wired into `run.sh`. Eleven assertions;
  the one it exists for is that **a dormant account that gets visited comes back
  to life**. A stored implementation passes every other check in the file.

**D87 — and this is the part that was not in the plan.** D86 said the front end
needed no work. True of the pills, **false of the stat cards**, and nothing
about them would have looked broken. Three of the four counted the effective
status, so the moment 360 pairs read `dormant`: "Stocking your brand" would have
fallen 218 → 116, "Pitched" 471 → 213, and — worst — a card labelled **"Quiet
90+ days" would have counted only 91-to-180**, dropping the accounts quiet
longest, the exact ones it exists to surface. It would have gone DOWN as the
situation got worse. Fixed by appending `status_stored` to both views: the list
**displays the effective status and counts the stored one**.

**Verified at close:** 103 pytest · offline suite green through BOTH idempotency
passes, now eight files · `verify_live.py` clean, 0 anon grants and 0 write
grants to `authenticated` · both views agreeing status-for-status on all 689
pairs · **all nine admin pages opened in a browser**, including the new reorder
checkbox on the Activity types edit form.

**Not verified:** the logged-in `venues.html`. It is behind a brand login and
there was no session to hand, so the corrected stat cards were not seen
rendering. The module parses and redirects cleanly with no console errors, and
the view columns it reads are confirmed present with the right values — the same
gap `business.html` had on 22 Aug, and the same one D79 warns is not the same
evidence as opening the page.

**Later the same day — venue grading, and a tab that had never rendered.**

The operator asked for an A/B/C/D grade per venue and an owning contractor,
editable in a grid and loadable from a CSV. Ruled venue-level, staff-only, and
scoped to the columns plus the grid and CSV — HubSpot's deal owner is a later
job, and is **not in this database at all**: `hubspot_owner_id` is not in
`DEAL_PROPERTIES`, so it is not even in the stored payload.

Built as `venue_grading`, its own table rather than two columns on `venues`, and
that is the design rather than a preference — `venues_select` lets a brand read
any venue row it relates to and the grant is table-wide, so a column there is a
column a brand can `select *`. `merge_venue()` now carries the grade across a
merge; the `ON DELETE CASCADE` would otherwise have destroyed it invisibly, the
same trap D85 found with photos. The CSV round trip is keyed on the venue id,
never the name, and refuses bad values rather than coercing them. The tab is an
`st.fragment`, so editing one cell no longer re-runs the whole page.

**And the new tab rendered blank — as did "Edit a venue", on the unmodified
page.** `st.stop()` halts the entire script run, not the tab it sits in. It sat
in the merge tab's "you have not picked two venues yet" branch, which is the
state on every page load, so the run died before `with edit_tab:` was ever
reached. **That tab had been empty since the day it was written.** Clean
console, no exception, and a page that looked completely normal.

Nothing automated found it and nothing automated could have: 103 pytest, the
schema suite, `verify_live.py` and `test_admin_sql.py` all pass on the broken
version, because the fault is control flow rather than SQL. D79 said open every
page. **The rule is now: open every tab.**

**Later still — "the Aspen Green numbers don't make sense" (D90).**

They made perfect sense, which was the problem. Aspen Green's `1st case sale`
and `recurring case` are charged at $5.00 and paid at $5.00, so every case earns
exactly nothing and the margin column reads $0.00 month after month. The one
month that was not flat, June 2026 at $1,154.90, is worse rather than better:
$1,079.90 of it is uncosted.

The $2,676.40 of uncosted charge on the same screen is D78's measurement
filtered to active brands and the last thirteen months. All time it is
$6,568.90 across 37 activities — already open work, not a new fault.

Two things were built. **Clicking a brand-month now opens it**, below the table
rather than in another tab, and says in words which of three things happened —
because `unpriced` understates revenue, `uncosted` overstates margin, and
charge-at-or-below-pay is neither. The money tab became a fragment so a click
re-runs that table alone.

**And the Rate card page now finds work priced at a loss: 51 activities charged
$2,040.00 against $3,335.00 of pay, a margin of minus $1,295.00.** The first
version of that check read `rate_card` rows and was wrong. A charge and a pay
need not live on the same row — Wodka charges $10.00 on a brand line and pays
$25.00 from the shared line — so it found two Aspen Green lines worth $0 and
missed 33 Wodka activities worth minus $1,140: the largest instance, invisible
to the check written to find it. Rewritten against `v_activity_money`, which
already resolves the pairing the way the billing does.

**And the rate card became editable (D91).**

The current-rates table now edits in place, which cuts against this page's own
rule that `effective_from` stops last year's revenue being restated. Both acts
are real: correcting a rate that was always wrong SHOULD reach back, changing a
price from a date forward must not. So the edit is allowed and the difference is
made visible — nothing saves until the money impact is shown, and that impact is
measured by applying the edit and asking `v_activity_money` inside a rolled-back
transaction rather than recomputing pricing in Python. Correcting Aspen Green's
two case lines to $50.00 previews as +$11,520.00 across 14 activities already on
file.

**Mileage now pays out in full**, per the operator: every cent charged goes to
the contractor. Eight rate lines, all charging $0.70 per unit with no pay rate
at all. Charge unchanged at $39,201.65; contractor cost $21,466.18 → $22,710.08;
uncosted charge $6,568.90 → **$5,325.00**, exactly the $1,243.90 that moved.

**And the two `rate_card` one-basis CHECK constraints had never existed on
Supabase.** They are declared inside `create table if not exists`, which does
nothing when the table already exists — so they were real on every fresh install
and in every offline test run, and absent on live. Found by deliberately writing
both a rate and a percentage in one edit to watch it be refused, and watching it
succeed. Restated as a guarded ALTER; zero rows violated them. Seventh instance
of D62.

**And the form nobody could type in (D92).**

Reported as "the cursor turns into a red null sign". The four money fields on
"Add a rate" are disabled until the Basis radio says which basis applies —
correct, and meant to last one click. Inside `st.form` it lasted for ever: a
form does not rerun when a widget inside it changes, so the disabling expression
kept the value it had at the start of the run. Picking "amount" changed nothing
until submit, and submitting with no basis was refused by the form's own
validation. No sequence of actions could enable them.

Fixed by dropping the form — live widgets in a fragment, so the radio enables
its field on the click. Verified in a browser by clicking each basis and typing.

The class is now a test: a widget inside `st.form` whose `disabled=` is not a
constant. Confirmed to fail on the pre-fix file. 103 tests → 118.

It had survived everything, including me opening that exact page twice in the
same session while building the grid directly above it. D79 said open every
page; D89 said open every tab; **D92 says opening a page is not using it.**

**Dame Mas reconciled end to end (D93).**

The canary reads **13 months tying, 0 billed-but-missing, 0 drifted** — it read
4 and 3 that morning.

`parse_invoices.py` reads the 13 Dame Mas invoice PDFs (Jul 2025 – Jul 2026).
$3,307.28 of commission was missing and is now booked one row per month,
carrying the gross as its amount and priced by the existing 10/8 card:
$2,645.82 of contractor cost, $661.46 net. Month-level because the per-venue
route was tested and fails — bottle price runs $123.00 to $210.75 with case
discounting, and October reconstructs to ~$5,000 against $6,533 invoiced.
Apr–Jul 2026 are skipped by a computed guard, not a date range.

The parser refuses to write unless every invoice adds to its own stated
SUBTOTAL, and that check paid for itself immediately: the first version matched
expenses by keyword and read "minimum 80% staff" as $80.00 while missing a
$534.87 line under "C. Nicolas". October's expenses were $123.50; they are
$1,243.95.

`classify_dame_mas.py` reclassified 46 of the 50 `account sold` rows from the
workbook notes — 40 placements, 5 reorders, 1 that was never a sale. It sets
`activity_type_id` and nothing else, so Dame Mas charge and cost are unchanged
to the cent.

**Found and not acted on: 11 sale events are in the workbook and not in the
portal at all**, verified month by month. They carry no money but would change
venue status; several need venues created, which is the operator's call.

**And the Dame Mas pay rate, which was wrong (D94).**

Dame Mas had no brand-specific `1st case sale` line, so the shared `(all
brands)` pay rate of $25.00 reached its six case sales — **$325.00 of contractor
cost against no charge at all**. All Dame Mas sales are paid as a percentage of
commission; there is no per-case rate.

Fixed with two explicit 0.00 / 0.00 lines, which also solves the other half of
the same question: 56 rows that were unpriced BY DESIGN (D51) were being flagged
as a fault, because *unpriced* and *deliberately free* looked identical. They
now read as priced at zero. **Dame Mas unpriced falls 63 → 7; portal-wide
152 → 96.** Charge unchanged at $5,872.43, cost $5,214.40 → $4,889.40.

Nine missing sales created, three venues with them, and three rows deliberately
held back where the venue is too close to an existing one to decide (D81).

Two faults found by running the loader a second time — a shared ratio is not a
shared identity ("Cypress Liquor and Wine" is not "Tony's Liquor and Lounge"),
and the duplicate check ran on the workbook's spelling rather than the resolved
venue, so "Eden Loung" would have been created twice. **A loader that has only
been run once is not known to be idempotent.**

**Close of 23 Aug.** The operator entered two pay rates himself during the
session — `aspen green fresh market incentive` ($100 charge, $100 pay) and
`single barrel sale` (Blue Run $1,000 / $800). Uncosted charge fell $5,125.00 →
**$3,225.00**; contractor cost is $26,890.90 and margin $15,618.03 on $42,508.93
of activity charge.

He also ruled on two venues (D95): **"Mullets" and "Mullets Sprots Bar" are both
Mullets Sports Bar, Clermont**, and **"Fillin Station" is probably its own
venue — unconfirmed, he could not check.** Whether `Mullets Cigar and Bar
(Clermont)` is the same premises as the sports bar is STILL OPEN and must not be
assumed.

Session ended by request with three Dame Mas sale rows deliberately unwritten,
waiting on those venues. Nothing is half-applied: every loader written today is
idempotent and was re-run to prove it — which is how two faults in the loader
were found in the first place.

**One question outstanding:** the fresh market incentive now charges and pays
the same $100.00, so it earns nothing across 9 activities. That is correct if it
is a pass-through like mileage, wrong if the pay was meant to be lower, and
nothing in the data can tell which.

---


## Session of 24 Aug 2026 — the portal corrected against the invoices, four brands deep

**Brand-months tying: 38 → 49 of 83.** Portal $119,983.93 against $112,559.66
invoiced. The headline +$7,424.27 is misleading — **$5,525 of it is August 2026**,
current-month work billed in arrears. **Real gap $1,899.27.**

Refreshed result saved at
`portal_seed/reconciliation/invoice_vs_portal_2026-08-24.csv`, beside the 23 Aug
file kept as the before-picture.

### The method, established and repeated four times

QuickBooks totals → PDF line detail → operator EOM workbook → write
`invoice_recap` only when all three agree → then diff the portal's activity
against the workbook, venue by venue. The operator's framing, and the reason it
works: QuickBooks blanks service lines (D70) but its totals are complete, so it
is the only independent proof that no invoice was missed.

### What each brand needed

**44 North** — finished at 13 of 15. Deleted a synthetic `tap cocktail` that
duplicated real work already on file as `tap w/2 cases`; zeroed two
`tap maintenance` rows that happened but were never billed (4 photos preserved);
added a November-only `drink list 1` rate of $150 and a December row restoring
$160, because a single row would have run November's price forward for ever;
corrected the Sept `invoice_recap` row from 610.00 to 912.10 with its billable,
mileage and expenses.

**Wodka** — from −$2,856.03 to six of eight months tying exactly. The cause was
never a rate (D109): a **$500/month `Expense Spend`** the portal did not model,
now on the retainer at $1,725 from Jan 2026, with `QB_RETAINER_TOTAL` raised to
74,625 from the QuickBooks line items. Then December's phantom 22 cases
(Pourhouse Lounge logged as a 12-case sale when the workbook says Account Visit
qty 1, plus a synthetic 10-case row), ten synthetic rows deleted, and five venue
quantities corrected from the workbook. 8 months loaded to `invoice_recap`.

**Starr Rum** — tied 7 of 7 before and still does, but now on real rows. **63 of
its 84 activities had NO `source_activity_type`**, so the rate card could not
price them and sixteen placeholder rows carried the money (D111). 46 rows
classified, 16 deleted, **brand total unmoved to the cent**. 4 months loaded.

**Blue Run** — 8 of 9. Its single biggest fault was a `tasting event` at
**quantity 6** worth $800. A June tasting event that happened but was never
billed was zeroed. **Its synthetic rows were tested and KEPT** — unlike Wodka's
they stand in for barrels, barrel prep and half cases genuinely absent. 9 months
loaded, taking `invoice_recap` from 26 months to 47.

**Coors pool** — data gathered, **cannot be loaded** (D114). Ties to −$81.09;
four of its nine months differ from the portal by exactly their early-payment
discount.

### Rules established, not just facts

- **D108** — the 63 synthetic `Invoice-derived` rows are a question per brand,
  not a fault; and `parse_invoices.py --apply` duplicates any per-unit brand.
- **D110** — the workbook decides ACTIVITY, QuickBooks decides TOTALS.
- **D112** — `account sold` is decided by what the invoice bills, never the label.
- **D113** — a wrong quantity is wrong money and looks ordinary; four found,
  $1,110.

### Verified

148 tests pass (`test_normalize`, `test_sync`, `test_admin_sql`); `db/test/run.sh`
clean — anon locked out of all three objects, zero `authenticated` write grants,
36 SELECT grants. The admin's front page was opened in a browser and renders
end-to-end; **the running instance predates the `lib.py` change and needs a
rerun to pick it up.** `verify_live.py` was NOT run this session.
## Session of 24 Aug 2026, later — the business analysis (D116–D118)

**No invoice work, no data changed, one page added.** Open items 1–7 from the
morning session are exactly where they were. This session was the operator
asking what the numbers say about fees, capacity and contractor pay.

**What was built: the Cost to serve tab** on the Analysis page (D116). Each
contractor's own monthly base pay, split across the brands they worked that
month by their own share of activities, month by month so a raise or a new hire
lands in the right months. Attribution runs through
`venue_grading.owner_contractor_id`; contractors, rates and brands are all read
from tables, so a new contractor appears with no edit to Python (D60).

**It is an ALLOCATION and it lives in the page, in no view.** D67 ruled base pay
must not go into per-brand margin; the operator has now agreed to one specific
allocation, so `v_month_business` and every stored margin figure are untouched
and every other tab still excludes base pay entirely. D67 describes the
database; D116 describes one screen.

**Two faults were found in the first version of that tab by testing it, not by
reading it.** A caption claimed every contractor column summed to that person's
full pay — over a fourteen-month window **$15,841 of $53,720 had nowhere to
land**, because a contractor-month with no attributed activity has no brand to
sit against. Dropping it silently would understate payroll and flatter every
brand, so the page now measures and reports the gap. And the "activities with no
owner" note contradicted the warning directly above it.

**Verified:** 75 admin tests pass; the page opened in a browser and the tab
rendered against live data; the spread radio recomputed correctly (unallocated
$5,700 → $15,841, retainer warning three brands → one). All three `st.stop()`
calls sit before `st.tabs` and the tab uses `if/else` (D89). The From/To
dropdowns could NOT be driven through the browser automation — the date window
was verified by running the same arithmetic directly instead.

**What was analysed but NOT changed.** D118: matching 44 North's distributor
depletion sheet against the portal found **291 cases moved at accounts we
service Jan–Jul 2026 against 63 billed** — structural, because reorders reach
the venue through the distributor's rep with no visit to log, and `recurring
case` charges $0.00 while paying $5.00. **One reorder exists in 44 North's
entire history.** Also: **51 tap/keg activities logged as $0.00 types** when a
$200 `tap cocktail` line exists, and **Wodka's case sales at −$915** because it
has no pay rate of its own and falls through to the shared `(all brands)` $25.00
line.

**D117 designed the venue grading system and a four-day routed week, and it is
NOT agreed.** The constraint that shapes it: **Phil owns 260 venues, records 61
visits a month, and 260 venues at the cheapest cadence would cost 130.**

**Two documents** are the reference and live in `Ihospitality/`:
`iHospitality_Rate_Talking_Points.docx` and
`iHospitality_Field_Routes_Phil.docx`.

**Not done, and named so it is not mistaken for done:** the Phil conversation
had not happened when this was written, no venue was graded, no route exists,
the Wodka pay rate is still wrong, and `venues.market` is still NULL for 186 of
187 44 North venues.

## 24 Aug 2026, third session — the Coors pool, and the discount that was never a gap

**D119.** Open item 2, "teach `canary()` to pool brands", described in the
handoff as one query change. The query change was real. It was not the finding.

**The Coors pool ties 9 of 9, and portal-wide went 49 → 64 of 83.**

**The finding: an early-payment discount is not work, and neither is a card
fee.** `check_invoice_totals.py` compared the invoice TOTAL, but
`TOTAL = SUBTOTAL − DISCOUNT + TAX`. Molson Coors pays early, so every Coors
invoice carries a discount of $8.99–$31.44 — and those nine discounts were
*exactly* the **−$81.09** D115 had recorded as a reconciliation gap. The mirror
image is a fee: Wodka's 3184 charges $56.44 of processing and discounts $56.44
straight back off. Comparing totals hides the fee; comparing subtotals leaves it
in. Both scripts now compare **`SUBTOTAL − expenses − payment fees`** with the
discount excluded outright. **Seven months fixed, none broken** — including
Wodka's "$106.03 of card fees" and Dame Mas's $112.51, both of which had been
carried as open gaps and were never gaps.

**The pool is loaded** under `Barmen 1873 + Coors Whiskey + Five Trail` by a new
`load_pool_recap.py`, which checks that its five buckets add back to each
invoice's own stated subtotal before writing and refuses if two invoices share a
month. `canary()` derives a pool label and applies it to **both** sides of the
comparison; `verify_live.py` now asserts that each brand resolves to exactly one
label, because the join is on the brand and two labels would double-count
silently.

**How the nine months were closed.** Four tied once the discount came off. The
rest:

- **Sept**: Barmen's `barrel prep` rate was $0.00 while the invoice charged $40 —
  the figure Five Trail and Blue Run already carried. Set to $40.
- **Jan/Feb**: invoice 3187 bills 2× 5L barrel *"For Executive cigar and Copper
  Shaker"* in February; the portal had them in January. Moved, with the old date
  and HubSpot deal recorded in the note. Before that, an `Invoice-derived`
  synthetic row claiming *"the portal held 0"* turned out to duplicate the real
  row in the adjacent month — deleted, D108's test positive.
- **Aug/Oct**: two Hollerbach tap maintenances and a fourth Clermont printed
  feature, all real, none invoiced. **Operator ruling:** *"If it is in the
  workbook it's to be there, but if it isn't on the invoice then it wasn't
  billed."* Set to **quantity 0** — the row, venue, photo and deal survive and
  the money is zero. 44 North already had two such rows; nobody had spotted they
  were the pattern.

**Then the same mistake turned up in three more costumes**, and closing them
took 60 → 64. Each was something on the invoice that is not field work being
compared against field work:

- **A goods invoice is not a month of work.** 3159 (Blue Run, $584.56) and 3178
  (Coors, $720.00) carry no commission, no retainer and SALES TAX — barrels
  shipped to the brand, which the operator confirmed were "done separately".
  Folded into a work month they made $1,304.56 of phantom gaps.
- **But not every one-off is goods**, which is why the tax test earns its keep.
  Invoice 3203 also has no commission and no retainer and is **two tasting
  events, real work, separately invoiced** — *"Dame Mas has us charge for
  activities separately but they are logged."* Untaxed, so it stays in its month.
- **An ACTIVITY DATE equal to the issue date says nothing.** 3203 reads
  "7/8/2026" against an issue date of 07/08/2026. Read literally it put $455 in
  July, where it made a month that ties read −$455 while June — which holds the
  work — read +$455.20. The work is the 25 Jun Festival of Speed tasting at
  $180 and the 11 Jun River & Post trip, whose **$200.20 of mileage and $75.00
  of staff training the invoice bills as one round $275.00 "Tasting Event"**.
  Both months now tie but for that $0.20 of rounding.
- **A balance carried forward is money already counted.** Wodka's 3200 re-bills
  $90 from an earlier invoice.

**Nineteen rows still differ and eleven of them should not move:** August 2026
for four brands (arrears, $5,525), Aspen Green Feb–May (D71, $2,165), Wodka's
±$150 April/May pair — which **invoice 3195 explains in writing** — and Dame
Mas June's $0.20.

**The eight that are open all have their causes found**, led by **Heaven's
Door**: it **bills ACCOUNT VISITS at $20** inside the consulting block, where
every other brand's invoice says "no charge" and the rate card prices them at
$0.00 for all eight brands. Its commission ties exactly in both checked months,
so that and a "Smoke Tops" line are the entire difference — on the brand with
$16,361.08 outstanding. The rest: Blue Run's Black Hawk 10L barrel (three
operator calls first — the venue on file is Black Hawk *Social*, there is no
`cwc 10l barrel` activity type, and the rate disagrees $150 against $205), Dame
Mas's $300 "KPIs" line, 44 North's held June, Aspen Green's 79 cases against 75
billed, and two months carrying work with no invoice at all.

**Two corrections to earlier entries.** **Wodka's $25 case pay is CORRECT** —
handoff item A said to lower it to $5 and would have cut $915 of real contractor
pay; the −$915 is the charge side and the operator's decision (D60). And the
workbook is wrong on two of the Coors pool's nine months: August 2025 records
$0.00 commission against a real $205, and February 2026 is $310 light because
**barrels were never entered in the workbooks** (D110, as predicted).

**Operator ruling: only data back to the portal.** QuickBooks holds 16 Coors
invoices from Dec 2024; the portal's activity starts 2025-06-06. The six older
ones, $17,036.02, are not a gap and are not to be chased.

**Verified:** 148 pytest · offline SQL suite green · 0 anon grants, 0 write
grants to `authenticated` · every other brand's canary unchanged (Dame Mas
13/13, 44 North 13/13, Starr Rum 4/4, Blue Run 8/9, Wodka 6/8) · all nine admin
pages and every tab opened in a browser, and the Health page **driven** to the
pool and read back at 9 tying / 0 missing / 0 drifted, 0 exceptions.

**Not done:** the Phil conversation happened and he agreed, but the specifics
were never written down and they gate D117 and D118 both. No venue is graded, no
route exists, `venues.market` is still NULL for 186 of 187 44 North venues, and
invoice 3178 ($720 of barrels, no work month) is still unplaced.


## Session of 25 Aug 2026 — the admin portal, core pass (D120–D125)

**A build session, not a reconciliation one. Nothing in the database changed,
no invoice work was done, and open items 1–7 are untouched.** The operator asked
for the web portal's admin side — his login and Phil's — and asked to start
there before the contractor role.

**Everything is UNCOMMITTED and the rendering is UNVERIFIED.** The operator was
running remotely from a phone and could not open a browser; he asked to hold
until he is back at the machine. See HANDOFF.

### What was built

Five servable files changed, three created. **No schema change, no new role, no
Python change, no build step.**

| File | Change |
|---|---|
| `portal/portal.js` | Sidebar `renderShell()`; `isStaff()`, `money()`, `param()`, `monthRange()`; `requireAuth()` now preserves the query string |
| `portal/portal.css` | `.portal-sidebar` + drawer breakpoints, per-photo captions, detail-page fact grid, flag callouts, "show more" |
| `portal/brands.html` | **NEW** — every brand over a month range, click through |
| `portal/brand.html` | **NEW** — one brand: stat cards, activity-type breakdown, full activity log |
| `portal/activity-detail.html` | **NEW** — one activity, its pricing, its photos, its flags in words |
| `portal/photos.html` | Bounded paging, grouping toggle, per-tile captions, lightbox links to the activity |
| `portal/login.html` | Allowlist fixed and extended (D124) |
| `portal/activity.html` | Rows open the detail page |
| `css/site.css` | **Untouched** — shared with the public site (D121) |

### The four decisions that shaped it

**No new role (D120).** `is_staff()` tests the literal string `'staff'` and the
enum has two values. An `'admin'` value would return **zero rows with no error**
from every staff table — a page that renders perfectly and shows nothing. Both
admin logins stay `staff`; "Admin" is a label. Salaries are one tier for both,
operator-ruled: *"Phil is also the owner of the company so he is already well
aware."*

**A left rail, portal-only (D121).** Six nav items today, eight once the rate
card and salaries land. `css/site.css` owns the top nav AND the public site uses
it, so the rail is new class names in `portal.css` and the marketing site does
not move.

**The gallery is bounded (D122).** Operator: *"photos will increase as time goes
on."* Postgres orders and slices, filters are applied server-side, and the
dropdowns are built from three small tables rather than from the photo list.

**Analytics stay live (D123).** No push pipeline — everything asked for is
already a view. Cost to serve can be computed in the browser rather than
promoted into one, which keeps D116's page-only rule; deferred, with the
drift risk stated.

### Two live bugs found in existing code

**`business.html` had NEVER been in `login.html`'s allowlist** (D124). A staff
member deep-linking to it while logged out signed in fine and landed on the
dashboard — silently, since the day the page was written. Every new page is now
listed, and so is that one.

**`requireAuth()` dropped the query string**, so `brand.html?slug=44-north` came
back as a bare `brand.html`. Fixed; the allowlist now matches only the filename
half, and the hostile cases were re-checked.

### Verified — all without a login

**RLS by impersonation in Postgres, rolled back (D125).** Better than clicking,
because it probes every staff table at once:

| probe | service_role | test-bluerun | test-wodka | phil |
|---|---|---|---|---|
| activities | 1236 | 119 | 205 | 1236 |
| brands | 12 | 1 | 1 | 12 |
| photos | 412 | 46 | 45 | 412 |
| priced money rows | 1185 | **0** | **0** | 1185 |
| rate_card / contractor_pay / venue_grading / invoice_recap / brand_retainer | 253 / 3 / 339 / 56 / 13 | **0** | **0** | full |

`is_superuser=off` asserted, and impersonated counts asserted to DIFFER from the
baseline — otherwise the check could not fail (D114).

**Numbers tie to the admin to the cent.** 44 North, 2025-09..2026-08: activity
charge **$9,197.10**, contractor cost **$4,992.10**, 330 activities, uncosted
**$315.00**, revenue **$26,597.10**, margin **$21,605.00** — all matching the
SQL the Analysis page runs. All **14 activity types** agree on count, accounts,
units, charge and cost.

**Also:** every column the new pages select exists (8 relations, 53 columns);
the breadcrumb's `slugify()` reproduces all 12 real slugs; gallery paging walks
412 photos over 7 pages with 0 duplicates and 0 dropped; all 9 page modules pass
`node --check`; the public site still renders a 76px horizontal nav with 6 links
and no portal class leaked into `site.css`; the mobile drawer opens, scrims,
locks scroll and closes on tap/link/Escape.

### NOT verified — and it is the check that finds things

**Rendering.** Whether the pages paint correctly, whether tables land in the
right cells, whether the stat cards read properly. D79 is explicit that opening
the page is the highest-yield check in this project and that nothing else covers
it. **Nobody has opened any of these five pages.**

### A change made because a view's own comment demanded it

`v_brand_month_revenue` carries `uncosted_charge` with a comment saying it exists
"so the margin figure can be read with the size of its own blind spot next to
it." Margin was being shown bare. Both new pages now show uncosted beside
margin, with the directions named — **unpriced UNDERSTATES revenue, uncosted
OVERSTATES margin** — and uncosted is shown beside margin rather than subtracted
from it, because the cost is unknown, not zero.

### Surfaced, not caused

**46 activities carrying $9,882.28 have no venue**, and the new brand page shows
them as "Account —". Mostly known and deliberate: Dame Mas's 9 rows at
$3,307.28 are the month-level commission from D93, and about $3,030 is the
synthetic `Invoice-derived` rows of open item 4. Not new damage; newly visible.

| | Dame Mas | Blue Run | Heavens Door | Aspen Green | 44 North | Five Trail | Barmen | Wodka |
|---|---|---|---|---|---|---|---|---|
| rows | 9 | 13 | 5 | 3 | 7 | 5 | 2 | 2 |
| charge | $3,307.28 | $2,240.00 | $1,245.00 | $1,095.00 | $1,010.00 | $800.00 | $145.00 | $40.00 |

### Corrected premises

**The "site is slow" report was from DYNADOT** (first noted as GoDaddy; the
operator corrected it). Dynadot **is** the registrar, so it can probe the public
site from outside — but it cannot have measured the portal, which is behind a
login and `noindex`. So it was measured rather than dismissed: `index.html` is
6 requests / 636 KB with 24 of 26 images lazy; `gallery.html` is 20 / 785 KB
with 33 of 35 lazy. **The structure is sound.** Two real items, neither done:
**`Hero.jpg` at 401 KB is the homepage LCP image** (with `market.jpeg` at 168 KB,
they are 569 KB of 636 KB — WebP/AVIF would cut them 60–70%), and **the Google
Fonts stylesheet is render-blocking from a third-party origin** (self-hosting
`woff2` + `@font-face` removes it with no build step). See D123.

**"Only clean data, not staged" was already true** — the whole `staging` schema
is revoked from `anon` and `authenticated`, so no browser can reach it. The one
exception is venue ATTRIBUTES, which `apply()` writes directly (D83) — which is
why `Crown Lounge` still shows a venue name in its city column.

## Known data problems to resolve before seeding

Found by profiling the six `hubspot-crm-exports-*.csv` files (315 rows):

1. `Dame Mas` (56 rows) and `Dame Mass` (1 row) are the same brand. Merge.
2. 23 activity-type spellings → 15 canonical types. Mapping is seeded in
   `activity_type_aliases`; unseen values must fail loudly, not silently drop.
3. Deal stages exist and are currently unused (D7). Seven values, no mapping to
   `account_status_enum` yet.
4. Venue naming consistency across months is untested — the plan predicts this is
   the real work of Phase 2, and profiling has not yet confirmed the extent.

## Session of 27 Aug 2026 — the contractor role, and adding a user (D137–D142)

Two things asked for, and the second turned out to be the larger one: a way to
add a user from the admin, and a contractor portal — *"a central location of
information and use for the contractor"*.

### Built

- **The contractor role** (D137). `profile_role_enum` gains a third value;
  `is_internal()` gates internal-but-not-financial data while every money table
  stays `is_staff()`. Four new views, two of them SECURITY DEFINER because
  `activities.notes` cannot be column-granted without undoing D134.
- **`admin/pages/10_Users.py`** — create, re-scope, deactivate or delete a login,
  for all three kinds. It stays in Streamlit because creating a login needs the
  service key, and that key in a browser dissolves D61.
- **`backfill_activity_contractor.py`** (D139) — 1,057 rows written from the
  HubSpot deal owner. Alan Merrick created as an INACTIVE contractor.
- **Four portal pages** and a two-way render of `venue.html` / `venues.html`
  (D138), plus a **PWA**: manifest, icons and a service worker scoped to
  `/portal/` that caches the shell and never a Supabase response.

### Corrected mid-session, by the operator

- **Phil and Nicholas are ADMINS; Eric is the only contractor** — and an admin
  must do everything a contractor can, plus what it already could (D140).
- **The two venue surfaces** (D138), and what is withheld on a colleague's
  account is the *judgement*, not the fact.
- **`nicholas@ihospitality.vip` is not his address.** `portal/login.html` had
  offered it as the "Need access?" contact since the day it was written.

### Found by building it

- **A definer VIEW does not change `current_user`,** so it does not lift
  `security_invoker` on a view it reads. The pay views had to become definer
  FUNCTIONS (D137).
- **An enum value cannot be used in the transaction that added it,** and the
  `create type ... exception when duplicate_object` block never reaches a live
  database at all (D142). `apply_schema.py` now applies enum values first.
- **Two rendering bugs only a browser could show** (D79): the rail read
  "Contractor" and a venue read "Owned by: nobody yet", both because
  `contractors` is staff-only and a PostgREST embed came back null.
- **A Users page that can create but not re-scope is half finished** (D141) —
  D136's finding, arrived at again from the other end, within the hour.

### Verified

Live impersonation with the control; `11_contractor_test.sql` proved able to
fail; 153 Python tests; every page opened signed in as both a contractor and an
admin; the phone drawer; the service-worker cache inspected. **Dame Mas still
reads $14,036.78 / $9,000.00 / $5,036.78 — the money did not move.**

## Session of 27 Aug 2026, later — it goes live (D143–D151)

The portal was merged to `main` and deployed. Three people are using it.

### Shipped

- **The merge itself.** 94 commits. Production had been serving `origin/main`
  from **27 July**, so this also deployed the `css/site.css` refactor for the
  first time — checked on a deploy preview before merging.
- **It closed a live exposure**: `ihospitality.vip/GALLERY_PLAN.md` was returning
  **200** that morning.
- **A Log in link** in the public nav (D147), **self-service password reset**
  (D144), **Google sign-in** (D145), **the PWA** with an install control and a
  `_headers` file (D148), and **an editable Users table** in the admin (D146).
- **A verified database backup** — `backup_db.py`, to `~/Backups` outside
  OneDrive, checked row-for-row against live rather than by the file existing.

### Verified by the operator rather than reasoned about

A Google account with no portal login is **refused** — his personal Gmail was
turned away, which confirms pre-created accounts plus `disable_signup` in one
click. Eric signed in and found his 50 venues and 147 activities. The PWA
installs and the icon reads correctly.

### Three faults that were mine

- **`hd` locked the brands out of Google** (D149), and the comment beside it
  called the parameter "a hint, not a control" — right about security, wrong
  about behaviour, and the wrong half mattered.
- **`check_auth_settings.py` reported its own bug as a dashboard fault** (D151).
  The operator changed Supabase settings twice chasing a redirect that was
  already correct.
- **A hardcoded contractor name** in the backfill (D143), found because the
  operator asked directly whether anything had been hardcoded to make the pages
  pass. The rest of that audit came back clean, and was proved rather than
  asserted.

### And one that was not

A phone reported the rail unscrollable and the icon stale. The rail was a real
bug — `100vh` plus a flex item without `min-height: 0` — but the second report,
and the persistence of the first, were **a stale service-worker cache** (D150).


---

## 28 Aug 2026 — three shipped to production, all of them display faults

Nothing in the database changed. **The reconciliation still stands at 64 of 83.**
Every one of the day's faults was the portal misrepresenting data that was
correct underneath, and two of the three were reported by the operator rather
than found by a check.

| | |
|---|---|
| **D154** | `activity-detail.html` threw `ReferenceError: staff is not defined` **for admins only**. Heading and date rendered, then nothing. |
| **D155** | My pay's base was a table saying one thing fifteen times; the range opened on a rolling year; the two month boxes were unlabelled. |
| **D156** | The internal account list was one row per BRAND per venue. Big C Liquors listed five times, four rows dormant, on a bar visited 121 days ago. |

### The pattern, and it is worth naming

**All three were the wrong SLICE of right data.** D154 gated a money panel on a
variable it could not see; D155 showed a per-month row for a figure that only
changes on a raise; D156 showed a per-brand row for a question about a venue.
None of them was a data error, none would have been caught by a row count, and
the impersonation probe (D125) would have passed all three — it proves isolation
and nothing about rendering.

### What actually caught them

**The operator, twice, on his own screen.** D154 came in from a phone at 1:47 am;
D156 came from noticing Big C read dormant when he knew we had been there. That
is the third and fourth time D79's rule — open the page — has been the only thing
that worked.

**And D154 sharpened it**: a guard that says "not you" can only be exercised by
the role it lets through, which is the role nobody re-checks because the feature
was not built for them. D153 was verified as a contractor, correctly and as a
virtue, and that is exactly the branch that skipped the broken line.

⚠️ **`node --check` is not evidence for this class of fault.** It passed on both
the broken and the fixed `activity-detail.html`. What worked was running the page
module against each role with a control that FAILS on the old code — the same
shape as D114's rule for SQL, applied to a page.

### Verified before shipping, not after

D156 was proved against all **693 live rows**: folds to 340 matching the distinct
venue count, activities, sales, reorders and units all conserved, every last-visit
date equal to the venue-wide maximum, and **zero venues left falsely dormant**
against 125 rows before. The status ruling was put to the operator with the number
attached — 23 venues understated, every one of them — and he chose furthest-along.

### One number changed meaning

**"Stocking" went from 220 to 163.** It counted brand-venue relationships and now
counts venues. Both are true; the internal page is asking "how many bars stock
us", and a brand's copy of the page is untouched.

### Process

Netlify build credits are finite and the operator is rationing them. D155 was
proved in node and against a local server rather than by pushing; D156 was
verified by the operator **against production data on `localhost:8123`** and then
merged straight to `main`, one build instead of three. ⚠️ **Retargeting a PR's
base onto a non-production branch stops Netlify building it at all** — that cost
a wasted push and a stale preview. Keep PR bases on `main`.
