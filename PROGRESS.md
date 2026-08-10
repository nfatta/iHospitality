# PROGRESS.md

Build log for the brand portal. Phases are from `PORTAL_PLAN.md`.

**Current position:** Phase 1 complete and verified locally. Phase 2 is
**blocked** — see below.

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

**⚠️ OUTSTANDING — operator action.** The token value is unchanged and sat in
plaintext in a synced OneDrive folder for months. Rotate it: HubSpot → Settings →
Integrations → Private Apps → Auth → Rotate, then paste the new value into
`Hubspot/.env`. No code changes needed after.

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

## Blocked

### Phase 2 — Seed from HubSpot CSVs 🟡 in progress, load step blocked

The **load** needs a Supabase project, which requires an account only the operator
can create. Needed in `Hubspot/.env`: `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`.

Everything before the load is unblocked and underway (operator go-ahead 10 Aug):
the loader is written and tested against the local harness, so only the final
write to the real project waits on credentials.

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
