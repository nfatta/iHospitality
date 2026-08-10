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

**D4 — `account sold` mapped to `case_sale`.** ⚠️ ASSUMPTION — needs a ruling before Phase 2 seeding

35 rows carry this activity type. Mapped on the assumption it means the first case
moved. If it actually means "account agreed to stock", it is a
`brand_venue_status` transition, not an activity, and 35 rows will be wrong in
every depletion number the dashboard shows. Conservative because it is visible and
reversible — but it must be confirmed, not left.

---

**D5 — No write policies anywhere; the portal is structurally read-only.**

RLS is enabled with `SELECT` policies only, so all writes from the portal's
`anon`/`authenticated` keys are denied by default. Writes happen via the
`service_role` key from the Streamlit admin and the sync script, which bypass RLS.
Alternative: write policies scoped by brand. Rejected as premature — nothing in
Phases 1–5 needs a brand user to write. Phase 6 field entry adds them
deliberately, one at a time.

---

**D6 — Verified on local Postgres 18, not Supabase Postgres 15.** ⚠️ VERIFICATION GAP

`bash portal/test/run.sh` proves the schema applies, is idempotent, and that RLS
isolates brands — on a local cluster with a hand-written stub for `auth.users`,
`auth.uid()`, and `storage.*`. It does **not** prove behaviour on Supabase. The
playbook (Part 5.3) requires verification on the real target. Closing this needs a
Supabase project, which needs an account the operator must create. Until then,
Phase 1 is "verified locally", not "verified".

---

**D7 — Trigger derives `brand_venue_status` from activity type, ignoring deal stage.** ⚠️ partial

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

**D9 — `anon` lockdown placed at the end of `schema.sql`.**

Supabase's default privileges grant `anon` access to newly created objects in
`public`. Revoking mid-file would miss everything defined after that point,
including the three dashboard views. The revoke plus `alter default privileges`
runs last so it catches all of it, and stops future objects reopening the hole.
