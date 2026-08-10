# PROGRESS.md

Build log for the brand portal. Phases are from `PORTAL_PLAN.md`.

**Current position:** Phases 0–2 complete and **live on Supabase**. 942
activities across 11 brands and 303 venues are loaded. Next up is Phase 3 (the
sync script) or Phase 4 (the portal pages) — Phase 4 is where v1 ships.

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

### Phase 1 — Schema ✅ 10 Aug 2026 (verified locally, not on Supabase)

`portal/schema.sql` — tables, RLS, three dashboard views, triggers, storage
bucket. Heavily commented; it is the SQL learning artifact.

Beyond the plan: an `activity_type_aliases` table (D3), because the live exports
contain 23 spellings of ~15 real activity types.

Bug caught during verification: the photo-count subquery in
`v_brand_monthly_summary` was invalid SQL and would have failed in the Supabase
editor. The fix also avoids a join fan-out that would have silently multiplied
every `sum()` in that view.

**How to see it working:**

```bash
bash portal/test/run.sh
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

**How to see it working:** same `bash portal/test/run.sh`. The taxonomy section
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
| `test_normalize.py` | 30 unit tests, every fixture a real string from the exports. |
| `seed_from_csv.py` | The loader. Dry-run by default. |
| `test_seed_integration.sh` | End-to-end against a throwaway Postgres, twice, checking idempotency. |

A Sonnet subagent audited all 29 CSVs first (`Hubspot/DATA_AUDIT.md`); its three
headline claims were independently re-verified before anything was built on them.

**Results on the real exports:** 25 files, 1,777 raw rows → **942 activities,
303 venues, 11 brands**. 818 duplicate Record IDs collapsed (81% of rows overlap
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
`python -m pytest test_normalize.py -q` (30 tests) and
`bash test_seed_integration.sh` (loads twice, asserts the second run changes
nothing). Last run: all green.

---

### Phase 2 load onto Supabase ✅ 10 Aug 2026

Operator created the project; schema applied (Postgres 17.6, 12 objects, 8 RLS
policies) and the seed run against it. **Live counts: 11 brands, 303 venues, 942
activities, 521 brand/venue status rows.** Identical to the local run. The seed
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
