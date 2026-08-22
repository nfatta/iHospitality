# CLAUDE.md — standing instructions

Read these before doing anything: **`HANDOFF.md` (start here — where we
stopped and the next prompt)**, `PROGRESS.md` (where the build is),
`DECISIONS.md` (judgment calls already made and why), `PORTAL_PLAN.md` (the WHAT
— its locked decisions are final). `BUILD-PLAYBOOK.md` is the HOW.

## Two repos, and why

| Repo | Holds |
|---|---|
| **this one** (`Website/…/ihospitality/`) | The public site and the portal's *servable* files only. Deploys to Netlify from `main`. |
| `Hubspot/portal_seed/` | All Python, `db/schema.sql`, and the SQL test harness. Its own git repo. **Not deployed.** |

**The repo root IS the Netlify publish directory.** Every committed file here is
served at `ihospitality.vip/<path>`. That single fact drives several decisions:
`*.py`, `.env` and `credentials.json` are gitignored here, and the schema plus
test harness live in the other repo entirely. Do not rely on `_redirects` to
hide a file — Netlify's `*` is a trailing splat, not a filename glob, so
`/portal/*.sql` does **not** match (D12). If a file must not be public, it does
not belong in this repo.

## Running the site

```bash
python -m http.server 8123
```

The staff admin has a double-click launcher: **`portal_seed/start-admin.cmd`**.
Its first line is `cd /d "%~dp0"`, which is what keeps D63 true from a Desktop
shortcut. Do not replace it with a direct `streamlit` invocation from elsewhere.

Or the `ihospitality-static` config in `.claude/launch.json` via `preview_start`.
The portal is at `/portal/login.html` — it needs `http://localhost`, not
`file://`, because it uses ES modules.

## The database

Live on Supabase (Postgres 17.6), seeded. Everything reads `DATABASE_URL` from
`Hubspot/.env` — never pass it on a command line.

```bash
cd ../../Hubspot/portal_seed
python -m streamlit run admin/app.py   # THE STAFF ADMIN — analysis, review, cleanup
python verify_live.py                  # read-only health check
python apply_schema.py --apply         # re-apply db/schema.sql (idempotent)
python seed_from_csv.py                # dry run; --apply to load
python create_portal_user.py --list    # who has portal access
python -m pytest test_normalize.py test_sync.py test_admin_sql.py -q  # 103 tests
bash db/test/run.sh                    # schema + RLS + staging suite, no network
python backfill_staging.py             # one-time; already applied 19 Aug
bash test_seed_integration.sh          # end-to-end load, asserts idempotency
```

**The admin binds to loopback, and that is its whole access control (D63).**
It has no login and does not need one — cleanup is the operator's job at his own
machine. But Streamlit resolves `.streamlit/config.toml` against the *working
directory*, so launching from anywhere but `portal_seed/` silently drops the
setting and publishes every brand's rate card to whatever network the laptop is
on. `lib._require_loopback()` refuses to render if that happens; do not treat
that guard as permission to launch from elsewhere.

**Local Postgres is not Supabase.** Anything touching roles, grants or default
privileges must be checked against the real project — Supabase grants `ALL` on
new public objects to `anon`/`authenticated` by default and a stock local
cluster does not. That difference hid a real bug once (D6). The local stub now
reproduces it; keep it that way.

## Conventions that matter

- **No build step, no npm.** Locked decision. Plain static HTML.
- **Shared CSS is in `css/site.css`.** Page-specific CSS stays inline *after*
  the link so pages can override (gallery.html relies on this). Change brand
  colours in `:root` in that file only.
- **Two markets only:** `central_florida`, `palm_beach_county`. Never "South
  Florida" — the database enum enforces it.
- **Internal notes are never brand-facing.** `activities.notes` is internal;
  `activities.brand_visible_summary` is what a client reads. The brand-facing
  views do not select `notes`. Do not add it.
- **Portal queries are written without a brand filter, on purpose.** RLS applies
  the restriction in Postgres. Never "helpfully" add `.eq('brand_id', …)` — it
  implies the security lives in the browser, and it does not.
- **Escape anything from the database before putting it in HTML** (`esc()` in
  `portal.js`). Venue names come from HubSpot and are untrusted.
- The portal is **read-only by construction**: RLS has SELECT policies only, and
  `authenticated` holds no write grants. Writes go through `service_role` in the
  Python tooling. **The staff admin is a separate Streamlit app for this reason**
  — it connects from Python with `DATABASE_URL`, where the credential never
  reaches a browser. Do not add write grants to `authenticated` to save building
  a page; that would dissolve the guarantee for brand logins too (D61).
- **No hardcoded business data** (D60). Rates, classification rules, activity
  aliases and invoice figures live in tables the admin edits at runtime. A rule
  compiled into a script is a rule the operator cannot reach. `load_rate_card.py`
  is retired and its write path deleted — do not revive it.
- **HubSpot lands in staging; a person promotes it** (D64) — **for DEALS only.**
  `apply()` upserts `brands` and `venues` DIRECTLY, before the staging zone is
  reached (D83). Do not assume the staging zone covers anything but deals.
- **The portal is the source of record; HubSpot is an input** (D84). The
  business is moving off HubSpot, which is now a collection tool. A venue edited
  in the admin is stamped `hand_edited_at` and the sync will NOT overwrite its
  city — it files the disagreement into `staging.hubspot_venue_proposal` for the
  Venues page. **This reverses D59 for venue attributes**: do not tell the
  operator to "fix it in HubSpot" for those. Venue city goes through
  `set_venue_city_from_hubspot()`, never a bare UPDATE. `sync_hubspot.py`
  writes to `staging.hubspot_deals`, never to `activities`. Rows nobody has
  edited still take HubSpot's updates automatically — that is what keeps D59
  working — but a row with `hand_edited_at` set stops and asks. Never restore the
  old `on conflict (hubspot_deal_id) do update set …` over `activities`: it
  silently reverts every fix made in the admin. Deleting a duplicate tombstones
  the deal id in `staging.hubspot_suppressed` so a re-sync cannot resurrect it.
  `promote()` has ONE definition (`promote.py`), used by the sync and the admin.
- **Itemised expenses earn nothing, and the view enforces it** (D78). The
  `is_expense` branch is FIRST in both CASE expressions in `v_activity_money`,
  so no rate-card line can make a reimbursement earn. Reimbursements sit BESIDE
  revenue, never in it. Do not simplify that branch away; `04_money_test.sql`
  builds the dangerous case on purpose and will fail.
- **A charge with no pay rate is `uncosted`, not free** (D78). `unpriced`
  understates revenue and someone chases it; a missing pay rate overstates
  margin and nobody notices. Both are surfaced in the admin.
- **In the admin: never a literal `%` in a query that passes params, and never
  two `$` in one Streamlit markdown string** (D79). The first raises in
  psycopg — a COMMENT counts — and the second renders as LaTeX. Both broke real
  pages for a month. `test_admin_sql.py` checks the source for both.
- **Open every admin page in a browser before calling a session done** (D79).
  It is the highest-yield check in this project and nothing else covers it.
- **Merging goes through a FUNCTION, never hand-written UPDATEs** —
  `merge_activity_type()` and `merge_venue()` (D81). The venue merge was five
  lines in the admin and had never once succeeded: it updated `photos.venue_id`,
  a column that does not exist. Photos hang off ACTIVITIES, not venues.
- **The portal does not yet model the retainer**, which is most of what every
  brand pays, so no revenue or margin figure here is complete. See `HANDOFF.md`.
- **The billing is the truth** (D56). Commission comes off the distributor's
  depletion report. Where the portal disagrees, investigate the portal.
  **QuickBooks is more the truth than the workbooks are** — they disagree, and
  the workbooks are the lossy copy.

## Where things are

| Path | What |
|---|---|
| `portal/` | The five portal pages, `portal.css`, `portal.js`. Servable files only. |
| `css/site.css` | Shared tokens, nav, buttons, section base, footer, mobile nav. |
| `PORTAL_PLAN.md` | Architecture doc — phases, locked decisions. |
| `HANDOFF.md` | Where the last session stopped, and the next prompt. |
| `../../Hubspot/portal_seed/admin/` | The staff admin (Streamlit). Analysis, review, cleanup. |
| `../../Hubspot/portal_seed/promote.py` | Promote / reject / suppress a staged deal. One definition, two callers. |
| `../../Hubspot/portal_seed/` | Python tooling + `db/schema.sql`. Separate repo. |
| `../../Hubspot/.env` | HubSpot token, Supabase keys, `DATABASE_URL`. Not in git. |
