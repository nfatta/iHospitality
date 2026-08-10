# PROGRESS.md

Build log for the brand portal. Phases are from `PORTAL_PLAN.md`.

**Current position:** Phases 0, 1, 2 and 4 are complete. **v1 of the brand
portal works end to end** against the live Supabase project — a brand logs in
and sees only their own activity, venues and dashboard. 942 activities across 11
brands and 297 venues are loaded.

Not yet done: Phase 3 (the HubSpot sync script — the data is currently a
one-time seed), Phase 5 (Streamlit admin), Phase 6 (field entry and cutover).

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

## Open items for the operator

1. **Delete the two test logins before real brands are onboarded.**
   `python create_portal_user.py --delete --email test-bluerun@example.com`
2. **Merge or close PR #1.** Merging puts the portal on `ihospitality.vip`;
   closing takes the demo preview down.
3. **`All Brands` (20 activities) and `iHospitality` (16)** are loaded as brands.
   Neither looks like a real client — decide whether to retire or merge them.
   There is no brand-merge function yet (the equivalent exists only for activity
   types), so this needs either a decision to build one or a manual fix.
4. **11 activity types are flagged for review** — `recurring_case` (51
   activities) is the big one. `python verify_live.py` lists them.
5. **No city or market data exists** on any venue — the HubSpot exports carry
   neither, so those columns and the market filter stay hidden until something
   fills them in. Populating `venues.market` is also what makes the
   two-market positioning visible to brands.
6. **No password reset flow.** A user who loses their password cannot self-serve;
   an admin must re-create the account or reset it in the Supabase dashboard.
   Build before real brands get logins — belongs with Phase 5.
7. **Photos are entirely empty.** `photos.html` renders its empty state
   correctly, but nothing populates that table until Phase 3 brings the HubSpot
   attachment download across.

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
